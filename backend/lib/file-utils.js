/**
 * 文件工具 — 磁盘检查、文件锁检测、格式化、通用响应
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getConfig } = require('../config');

function checkDiskSpace() {
  try {
    const { SHARED_FOLDER } = require('./paths');
    const stats = fs.statfsSync(SHARED_FOLDER);
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = freeBytes / (1024 * 1024 * 1024);
    const freeMB = freeBytes / (1024 * 1024);
    if (freeMB < 500) {
      logger.warn(`磁盘剩余空间不足 500MB (当前: ${freeGB.toFixed(2)} GB)`);
      return { ok: false, freeMB, freeGB, message: `磁盘剩余空间不足 (${freeGB.toFixed(2)} GB)` };
    }
    return { ok: true, freeMB, freeGB };
  } catch (e) {
    logger.debug('磁盘空间检查失败:', e.message);
    return { ok: true, freeMB: Infinity, freeGB: Infinity };
  }
}

function isFileLocked(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const tmpPath = filePath + '.locktest';
    fs.renameSync(filePath, tmpPath);
    fs.renameSync(tmpPath, filePath);
    return false;
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      return true;
    }
    return false;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cleanDirectory(dir, logMsg = '') {
  try {
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
        count++;
      } catch (e) {}
    }
    if (count > 0 && logMsg) {
      logger.info(`${logMsg}: ${count} 个文件`);
    }
    return count;
  } catch (e) {
    logger.debug(`清理目录 ${dir} 失败:`, e.message);
    return 0;
  }
}

function sendError(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function decodeRoutePath(pathname, prefix) {
  try {
    return decodeURIComponent(pathname.replace(prefix, ''));
  } catch (error) {
    return pathname.replace(prefix, '');
  }
}

function isPathSafe(resolvedPath, baseDir) {
  return path.resolve(resolvedPath).startsWith(path.resolve(baseDir));
}

function getUniquePath(dir, fileName) {
  const targetPath = path.join(dir, fileName);
  if (!fs.existsSync(targetPath)) return targetPath;
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let counter = 1;
  let finalPath;
  do {
    finalPath = path.join(dir, `${baseName}(${counter})${ext}`);
    counter++;
  } while (fs.existsSync(finalPath));
  return finalPath;
}

function parseJsonBody(req, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('请求体过大'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  checkDiskSpace,
  isFileLocked,
  formatFileSize,
  cleanDirectory,
  sendError,
  decodeRoutePath,
  isPathSafe,
  getUniquePath,
  parseJsonBody,
};
