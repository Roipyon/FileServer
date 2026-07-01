/**
 * FileServer — 启动入口
 * 服务器启动、端口自动降级、关闭、崩溃重启。
 */
const { fork } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 自动打开浏览器（轻量，启动成功后自动打开）
let openBrowser = null;
try {
  const _open = require('open');
  openBrowser = (_open.default || _open);
} catch (e) { openBrowser = null; }

const QRCode = require('qrcode');
const { getConfig } = require('./config/');
const logger = require('./lib/logger');
const { createApp, appState } = require('./app');
const {
  SHARED_FOLDER, CHUNK_TEMP_DIR, THUMBNAIL_CACHE_DIR,
  ensureDataDirectories, cleanOldPreviewDir,
} = require('./lib/paths');
const {
  cleanDirectory, checkDiskSpace, formatFileSize,
} = require('./lib/file-utils');
const { getLocalIPs } = require('./lib/network');

const config = getConfig();

// ==================== 启动辅助函数 ====================

function createTestFiles() {
  const testFiles = [
    { name: '测试文档.txt', content: '这是一个测试文档。' },
    { name: '使用说明.md', content: '# 文件共享系统使用说明\n\n欢迎使用 FileServer 1.0' },
  ];
  testFiles.forEach(testFile => {
    const filePath = path.join(SHARED_FOLDER, testFile.name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, testFile.content, 'utf8');
      logger.debug(`创建测试文件: ${testFile.name}`);
    }
  });
}

function listFiles() {
  try {
    const files = fs.readdirSync(SHARED_FOLDER);
    if (files.length === 0) {
      logger.debug('共享文件夹为空');
    } else {
      logger.debug('共享文件夹中的文件:');
      files.forEach(file => {
        const filePath = path.join(SHARED_FOLDER, file);
        const stats = fs.statSync(filePath);
        logger.debug(`   - ${file} (${formatFileSize(stats.size)})`);
      });
    }
  } catch (error) {
    logger.error('无法读取共享文件夹:', error.message);
  }
}

function printAccessInfo(port) {
  const ips = getLocalIPs();
  const publicUrl = config.publicUrl || null;

  logger.info('============================================');
  logger.info('   FileServer v1.0');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (publicUrl) logger.info(`   公网地址 : ${publicUrl}`);
  logger.info('');

  const qrTarget = publicUrl || (ips[0] ? `http://${ips[0]}:${port}` : '');
  QRCode.toString(qrTarget, { type: 'terminal', small: true }, (err, qr) => {
    if (!err) {
      logger.info('   手机扫码访问:');
      logger.info('');
      qr.split('\n').forEach(line => logger.info('  ' + line));
    }
    logger.info('   备用 IP 地址:');
    if (ips.length === 0) {
      logger.info('    (未检测到有效 IP)');
    } else {
      ips.forEach(ip => logger.info(`    http://${ip}:${port}`));
    }
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('  按 Ctrl+C 停止服务器');
    logger.info('============================================');
  });
}

// ==================== 服务器启动（端口自动降级）========================

function startServer(port, maxRetries = 10) {
  const server = createApp();

  const tryListen = (currentPort, attempt) => {
    if (attempt > maxRetries) {
      logger.error(`尝试了 ${maxRetries} 个端口都无法监听，请检查网络配置`);
      process.exit(1);
      return;
    }

    server.listen(currentPort, '::', () => {});
    server.listen(currentPort, '0.0.0.0', () => {
      const actualPort = server.address().port || currentPort;
      appState.actualPort = actualPort;

      logger.info(`服务器已启动，端口: ${actualPort}`);
      if (actualPort !== config.port) {
        logger.info(`配置端口 ${config.port} 被占用，已自动切换到 ${actualPort}`);
      }

      cleanDirectory(CHUNK_TEMP_DIR, '清理残留分片');
      cleanDirectory(THUMBNAIL_CACHE_DIR, '清理缩略图缓存');

      if (!fs.existsSync(SHARED_FOLDER)) {
        fs.mkdirSync(SHARED_FOLDER, { recursive: true });
        logger.info('已自动创建共享文件夹');
        createTestFiles();
      } else {
        logger.info('共享文件夹已存在');
        listFiles();
      }

      const diskCheck = checkDiskSpace();
      if (!diskCheck.ok) {
        logger.warn(diskCheck.message);
      } else {
        logger.info(`磁盘剩余空间: ${diskCheck.freeGB.toFixed(2)} GB`);
      }

      try {
        execSync('ffmpeg -version', { timeout: 3000, stdio: 'pipe', windowsHide: true });
        logger.info('ffmpeg 已安装，视频缩略图功能可用');
      } catch {
        logger.warn('ffmpeg 未安装，视频缩略图不可用');
      }

      printAccessInfo(actualPort);

      // 自动打开浏览器（支持 NO_OPEN=1 跳过，容器环境跳过）
      try {
        if (openBrowser && !process.env.NO_OPEN && !config.isDocker) {
          const url = `http://localhost:${actualPort}`;
          Promise.resolve(openBrowser(url)).then(() => {
            logger.debug(`已自动打开浏览器: ${url}`);
          }).catch(err => {
            logger.debug(`自动打开浏览器失败: ${err.message}`);
          });
        }
      } catch (e) {
        logger.debug(`自动打开浏览器失败: ${e.message}`);
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`端口 ${currentPort} 被占用，尝试 ${currentPort + 1}...`);
        server.close();
        tryListen(currentPort + 1, attempt + 1);
      } else {
        logger.error('服务器启动错误:', err);
        process.exit(1);
      }
    });
  };

  tryListen(port, 0);
  return server;
}

// ==================== 关闭 ====================

function gracefulShutdown() {
  logger.info('正在关闭服务器...');

  // 清除分享令牌
  try {
    const { shareTokens, uploadTokens } = require('./routes/share');
    const totalTokens = shareTokens.size + uploadTokens.size;
    if (totalTokens > 0) {
      shareTokens.clear();
      uploadTokens.clear();
      logger.info(`已清除 ${totalTokens} 个分享链接`);
      logger.info(`\n[Shutdown] 已清除 ${totalTokens} 个分享链接（${shareTokens.size} 个下载 + ${uploadTokens.size} 个上传）`);
    } else {
      logger.info('无活跃分享链接需要清除');
    }
  } catch (e) {
    logger.debug('清除分享链接时出错:', e.message);
  }

  if (global._server) {
    global._server.close(() => {
      logger.info('服务器已关闭');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(1), 5000);
}

// ==================== 崩溃自动重启 ====================

let crashCount = 0;
const MAX_CRASHES = 3;

process.on('uncaughtException', (err) => {
  crashCount++;
  logger.error('未捕获异常:', { error: err.message, stack: err.stack });

  if (crashCount > MAX_CRASHES) {
    logger.error('连续崩溃 3 次，停止重启');
    process.exit(1);
    return;
  }

  logger.info(`将在 1 秒后自动重启 (${crashCount}/${MAX_CRASHES})...`);

  setTimeout(() => {
    const child = fork(process.argv[1], process.argv.slice(2), {
      stdio: 'inherit',
      env: { ...process.env, CRASH_RESTART: '1' },
    });
    child.on('exit', (code) => process.exit(code || 0));
  }, 1000);
});

process.on('unhandledRejection', (reason) => {
  console.log(reason)
  logger.error('未处理的 Promise 拒绝:', { error: reason?.message || String(reason) });
});

// ==================== 初始化与启动 ====================

ensureDataDirectories();
if (cleanOldPreviewDir()) {
  logger.info('已清理废弃的 temp-previews 目录');
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const START_PORT = parseInt(process.env.PORT, 10) || config.port;
const server = startServer(START_PORT);
global._server = server;
