/**
 * FileServer — 启动入口
 * 服务器启动、端口自动降级、关闭、崩溃重启。
 */
const { fork, spawn, execFileSync } = require('child_process');
const { IS_PACKAGED, FFMPEG_BIN } = require('./lib/runtime-base');
const fs = require('fs');
const path = require('path');

// 自动打开浏览器（平台原生实现，启动成功后自动打开）
const { openBrowser } = require('./lib/open-browser');

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

  let currentPort = port;
  let attempt = 0;
  let retrying = false; // 同一端口的 '::' 与 '0.0.0.0' 两次 listen 各报一次 EADDRINUSE，只需处理一次
  let started = false;  // 双 listen 均成功时保证启动逻辑只执行一次

  const onListening = () => {
    if (started) return;
    started = true;

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
      execFileSync(FFMPEG_BIN, ['-version'], { timeout: 3000, stdio: 'pipe', windowsHide: true });
      logger.info('ffmpeg 已安装，视频缩略图功能可用');
    } catch {
      logger.warn('ffmpeg 未安装，视频缩略图不可用（可通过 FFMPEG_PATH 环境变量指定路径）');
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
  };

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      logger.error('服务器启动错误:', err);
      process.exit(1);
      return;
    }

    if (retrying) return;
    retrying = true;

    attempt += 1;
    if (attempt > maxRetries) {
      logger.error(`尝试了 ${maxRetries} 个端口都无法监听，请检查网络配置`);
      process.exit(1);
      return;
    }

    logger.warn(`端口 ${currentPort} 被占用，尝试 ${currentPort + 1}...`);
    server.close(() => {
      retrying = false;
      currentPort += 1;
      listen();
    });
  });

  function listen() {
    // 先 IPv6 双栈，再显式 IPv4：两个回调都指向 onListening，由 started 去重
    server.listen(currentPort, '::', () => {});
    server.listen(currentPort, '0.0.0.0', onListening);
  }

  listen();
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
let lastCrashAt = 0;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60 * 1000; // 距上次崩溃超过该窗口则重新计数，避免长期运行累计误判

process.on('uncaughtException', (err) => {
  const now = Date.now();
  if (now - lastCrashAt > CRASH_WINDOW_MS) {
    crashCount = 0;
  }
  lastCrashAt = now;
  crashCount++;
  logger.error('未捕获异常:', { error: err.message, stack: err.stack });

  if (crashCount > MAX_CRASHES) {
    logger.error(`连续崩溃 ${MAX_CRASHES} 次，停止重启`);
    process.exit(1);
    return;
  }

  logger.info(`将在 1 秒后自动重启 (${crashCount}/${MAX_CRASHES})...`);

  setTimeout(() => {
    // 打包态：process.execPath 即 exe 本身，自拉起；开发态：fork 入口脚本
    const child = IS_PACKAGED
      ? spawn(process.execPath, process.argv.slice(2), {
          stdio: 'inherit',
          env: { ...process.env, CRASH_RESTART: '1' },
        })
      : fork(process.argv[1], process.argv.slice(2), {
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

if (process.env.CRASH_RESTART === '1') {
  logger.info('本次运行为崩溃自动重启后的实例');
}

ensureDataDirectories();
if (cleanOldPreviewDir()) {
  logger.info('已清理废弃的 temp-previews 目录');
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const START_PORT = parseInt(process.env.PORT, 10) || config.port;
const server = startServer(START_PORT);
global._server = server;
