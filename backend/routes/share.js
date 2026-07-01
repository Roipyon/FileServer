/**
 * 分享路由 — 分享链接 + 单向上传令牌
 * ==============================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const logger = require('../lib/logger');
const { SHARED_FOLDER, INCOMING_DIR } = require('../lib/paths');
const { sendError, checkDiskSpace, parseJsonBody } = require('../lib/file-utils');
const { invalidateFileCache } = require('../lib/middleware');

const shareTokens = new Map();
const uploadTokens = new Map();

// ==================== 生成分享链接 ====================

function generateShareToken(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  parseJsonBody(req).then(body => {
    const { file, mode } = body;
    if (!file) {
      sendError(res, 400, '缺少文件名');
      return;
    }

    const filePath = path.join(SHARED_FOLDER, file);
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, '文件不存在');
      return;
    }

    const token = crypto.randomUUID();
    const entry = {
      token,
      file,
      mode: mode === 'persistent' ? 'persistent' : 'once',
      used: false,
      createdAt: Date.now(),
    };

    shareTokens.set(token, entry);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      token,
      url: `/api/share/${token}`,
      file: entry.file,
      mode: entry.mode,
    }));
  }).catch(() => {
    sendError(res, 400, '请求格式错误');
  });
}

// ==================== 处理分享链接下载 ====================

function handleShareDownload(req, res, pathname) {
  const token = pathname.replace('/api/share/', '');

  const entry = shareTokens.get(token);
  if (!entry) {
    sendError(res, 404, '分享链接无效或已过期');
    return;
  }

  if (entry.mode === 'once' && entry.used) {
    shareTokens.delete(token);
    sendError(res, 410, '此分享链接已被使用（阅后即焚）');
    return;
  }

  if (entry.mode === 'once') {
    entry.used = true;
  }

  const filePath = path.join(SHARED_FOLDER, entry.file);
  const resolvedPath = path.resolve(filePath);
  const resolvedShared = path.resolve(SHARED_FOLDER);

  if (!resolvedPath.startsWith(resolvedShared) || !fs.existsSync(filePath)) {
    shareTokens.delete(token);
    sendError(res, 404, '分享文件不存在');
    return;
  }

  const stats = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(entry.file)}"`,
    'Content-Length': stats.size,
  });

  const fileStream = fs.createReadStream(filePath);
  fileStream.on('error', (e) => {
    logger.error('分享文件读取错误:', e);
    if (!res.headersSent) sendError(res, 500, '文件读取失败');
  });
  fileStream.pipe(res);

  if (entry.mode === 'once') {
    setTimeout(() => shareTokens.delete(token), 1000);
  }
}

// ==================== 校验上传令牌 ====================

function validateUploadToken(res, token) {
  if (!token) {
    sendError(res, 400, '缺少上传令牌');
    return null;
  }
  const entry = uploadTokens.get(token);
  if (!entry) {
    sendError(res, 403, '上传令牌无效');
    return null;
  }
  if (entry.used) {
    sendError(res, 410, '此上传链接已被使用');
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    uploadTokens.delete(token);
    sendError(res, 410, '上传链接已过期');
    return null;
  }
  return entry;
}

// ==================== 生成上传令牌 ====================

function generateUploadToken(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const token = crypto.randomUUID();
  const entry = {
    token,
    used: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };

  uploadTokens.set(token, entry);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    token,
    url: `/upload?token=${token}`,
    expiresAt: entry.expiresAt,
  }));
}

// ==================== 处理令牌上传 ====================

function handleTokenUpload(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const token = parsedUrl.query.token;

  const entry = validateUploadToken(res, token);
  if (!entry) return;

  const diskCheck = checkDiskSpace();
  if (!diskCheck.ok) {
    res.writeHead(507, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: diskCheck.message }));
    return;
  }

  const { IncomingForm } = require('formidable');
  const form = new IncomingForm({
    uploadDir: INCOMING_DIR,
    keepExtensions: true,
    maxFileSize: 10 * 1024 * 1024 * 1024,
    multiples: true,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      logger.error('单向上传解析错误:', err);
      sendError(res, 500, '文件解析失败');
      return;
    }

    let uploadedFiles = [];
    if (files.files) {
      uploadedFiles = Array.isArray(files.files) ? files.files : [files.files];
    } else if (files.file) {
      uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];
    } else {
      const fileKeys = Object.keys(files).filter(key => files[key].filepath);
      if (fileKeys.length > 0) {
        uploadedFiles = fileKeys.map(key => files[key]);
      }
    }

    if (uploadedFiles.length > 10) {
      sendError(res, 400, '每次最多上传 10 个文件');
      return;
    }

    const results = [];
    for (const file of uploadedFiles) {
      try {
        const originalName = file.originalFilename || 'unknown';
        const tempPath = file.filepath;
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);
        let finalPath = path.join(INCOMING_DIR, originalName);
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          finalPath = path.join(INCOMING_DIR, `${baseName}(${counter})${ext}`);
          counter++;
        }
        fs.renameSync(tempPath, finalPath);
        results.push({ name: path.basename(finalPath), success: true });
      } catch (error) {
        logger.error(`单向上传保存失败:`, error);
        if (fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
        results.push({ name: file.originalFilename || 'unknown', success: false });
      }
    }

    entry.used = true;
    setTimeout(() => uploadTokens.delete(token), 5000);

    invalidateFileCache();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: `成功上传 ${results.filter(r => r.success).length} 个文件`,
      results,
    }));
  });
}

module.exports = {
  generateShareToken,
  handleShareDownload,
  generateUploadToken,
  handleTokenUpload,
  validateUploadToken,
  shareTokens,
  uploadTokens,
};
