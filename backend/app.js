/**
 * FileServer v1.0 — HTTP 应用入口
 *
 * 创建 HTTP 服务器并导出 createApp。
 * 启动逻辑见 src/index.js。
 */
const NODE_MAJOR = parseInt(process.version.slice(1).split('.')[0], 10);
if (NODE_MAJOR < 18) {
  console.error(`[Fatal] 需要 Node.js 18+，当前版本: ${process.version}`);
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { getConfig, updateConfig } = require('./config');
const logger = require('./lib/logger');
const zipUtils = require('./lib/zip-utils');
const { PUBLIC_DIR } = require('./lib/paths');
const { rateLimitMiddleware } = require('./lib/middleware');
const { sendError, parseJsonBody } = require('./lib/file-utils');
const { getLocalIPs } = require('./lib/network');
const { MIME_TYPES } = require('./lib/constants');
const filesRouter = require('./routes/files');
const shareRouter = require('./routes/share');
const clipboardRouter = require('./routes/clipboard');
const { serveThumbnail } = require('./lib/thumbnail');

const config = getConfig();

// ==================== 运行时状态（由 index.js 写入）====================
const appState = { actualPort: 0 };

// ==================== 主页服务 ====================
function serveHomePage(req, res) {
  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(htmlPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('无法加载主页');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

// ==================== 静态文件服务 ====================
function serveStaticFile(req, res, pathname) {
  const filePath = pathname === '/'
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(PUBLIC_DIR, pathname);

  const safePath = path.resolve(filePath);
  const publicPath = path.resolve(PUBLIC_DIR);

  if (!safePath.startsWith(publicPath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('禁止访问');
    return;
  }

  const extname = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('文件未找到');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('服务器错误');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

// ==================== 磁盘状态 ====================
function serveDiskStatus(req, res) {
  try {
    const { SHARED_FOLDER } = require('./lib/paths');
    const stats = fs.statfsSync(SHARED_FOLDER);
    const freeBytes = stats.bfree * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    const { formatFileSize } = require('./lib/file-utils');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      free: formatFileSize(freeBytes),
      total: formatFileSize(totalBytes),
      freeBytes,
      totalBytes,
      usedPercent,
    }));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '无法获取磁盘信息', detail: e.message }));
  }
}

// ==================== 服务器信息 ====================
function serveServerInfo(req, res) {
  const ips = getLocalIPs();
  const port = appState.actualPort || config.port;
  const urls = ips.map(ip => `http://${ip}:${port}`);
  const publicUrl = config.publicUrl || null;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    urls, publicUrl, port,
    uptime: process.uptime(),
  }));
}

// ==================== HTTP 入口 ====================
function createApp() {
  return http.createServer((req, res) => {
    const startTime = Date.now();
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    rateLimitMiddleware(req, res, async () => {
      if (pathname === '/') {
        serveHomePage(req, res);
      }
      else if (pathname === '/api/files') {
        filesRouter.getFileList(req, res);
      } else if (pathname.startsWith('/download/')) {
        filesRouter.downloadFile(req, res, pathname);
      } else if (pathname === '/api/upload') {
        filesRouter.uploadFile(req, res);
      } else if (pathname === '/api/upload-chunk') {
        filesRouter.uploadChunk(req, res);
      } else if (pathname === '/api/merge-chunks') {
        filesRouter.mergeChunks(req, res);
      } else if (pathname.startsWith('/api/delete/')) {
        filesRouter.deleteFile(req, res, pathname);
      } else if (pathname.startsWith('/api/raw/')) {
        filesRouter.serveRawFile(req, res, pathname);
      } else if (pathname.startsWith('/api/files/') && req.method === 'PUT') {
        filesRouter.saveFileContent(req, res, pathname);
      } else if (pathname.startsWith('/api/files/') && req.method === 'PATCH') {
        filesRouter.renameFile(req, res, pathname);
      }
      else if (pathname === '/api/clipboard' && req.method === 'GET') {
        clipboardRouter.getClipboard(req, res);
      } else if (pathname === '/api/clipboard/send') {
        clipboardRouter.sendClipboard(req, res);
      } else if (pathname === '/api/clipboard' && req.method === 'DELETE') {
        clipboardRouter.clearClipboard(req, res);
      } else if (pathname.startsWith('/api/clipboard/')) {
        clipboardRouter.deleteClipItem(req, res, pathname);
      }
      else if (pathname === '/api/share/generate') {
        shareRouter.generateShareToken(req, res);
      } else if (pathname.startsWith('/api/share/')) {
        shareRouter.handleShareDownload(req, res, pathname);
      } else if (pathname === '/api/upload-token/generate') {
        shareRouter.generateUploadToken(req, res);
      } else if (pathname === '/api/upload-token' || pathname === '/api/upload-with-token') {
        shareRouter.handleTokenUpload(req, res);
      }
      else if (pathname === '/api/download-zip') {
        zipUtils.handleDownloadZip(req, res);
      } else if (pathname.startsWith('/api/zip-progress/')) {
        zipUtils.handleZipProgress(req, res, pathname.replace('/api/zip-progress/', ''));
      } else if (pathname.startsWith('/api/zip-download/')) {
        zipUtils.handleZipDownload(req, res, pathname.replace('/api/zip-download/', ''));
      } else if (pathname.startsWith('/api/zip-cancel/')) {
        zipUtils.handleZipCancel(req, res, pathname.replace('/api/zip-cancel/', ''));
      }
      else if (pathname.startsWith('/api/thumbnail/')) {
        await serveThumbnail(req, res, pathname);
      }
      else if (pathname === '/api/disk-status') {
        serveDiskStatus(req, res);
      }
      else if (pathname === '/api/server-info') {
        serveServerInfo(req, res);
      } else if (pathname === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ publicUrl: config.publicUrl || '', logAccess: config.logAccess }));
      } else if (pathname === '/api/config' && req.method === 'PATCH') {
        parseJsonBody(req).then(body => {
          updateConfig(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }).catch(() => sendError(res, 400, '配置格式错误'));
      }
      else {
        serveStaticFile(req, res, pathname);
      }

      const duration = Date.now() - startTime;
      const ip = req.socket?.remoteAddress || '';
      logger.access(req.method, pathname, res.statusCode, duration, ip);
    });
  });
}

module.exports = { createApp, appState };
