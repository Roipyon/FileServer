/**
 * 中间件 — 请求频率限制、文件列表内存缓存
 */
const logger = require('./logger');
const { getConfig } = require('../config');

const rateMap = new Map();

const TYPE_LIMITS = {
  upload:    2000,
  download:  2000,
  list:      300,
  thumbnail: 500,
  share:     120,
  other:     300,
};

function getRateLimitType(url) {
  if (url.startsWith('/api/upload') || url.startsWith('/api/merge-chunks')) return 'upload';
  if (url.startsWith('/api/upload-with-token') || url.startsWith('/api/upload-token')) return 'upload';
  if (url.startsWith('/download/') || url.startsWith('/api/zip-download/')) return 'download';
  if (url.startsWith('/api/files') || url.startsWith('/api/server-info')) return 'list';
  if (url.startsWith('/api/thumbnail/')) return 'thumbnail';
  if (url.startsWith('/api/share/')) return 'share';
  return 'other';
}

function rateLimitMiddleware(req, res, next) {
  const cfg = getConfig();
  if (!cfg.rateLimit || cfg.rateLimit <= 0) return next();

  const ip = req.socket?.remoteAddress || 'unknown';
  const type = getRateLimitType(req.url);
  const limit = TYPE_LIMITS[type] || cfg.rateLimit;
  const key = `${ip}:${type}`;
  const now = Date.now();
  const windowStart = now - cfg.rateLimitWindow;

  if (!rateMap.has(key)) rateMap.set(key, []);
  const entries = rateMap.get(key).filter(t => t > windowStart);
  entries.push(now);
  rateMap.set(key, entries);

  if (entries.length > limit) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求过于频繁，请稍后重试' }));
    return;
  }

  next();
}

setInterval(() => {
  const now = Date.now();
  const windowStart = now - 60000;
  for (const [key, entries] of rateMap.entries()) {
    const filtered = entries.filter(t => t > windowStart);
    if (filtered.length === 0) rateMap.delete(key);
    else rateMap.set(key, filtered);
  }
}, 30000);

const fileListCache = { data: null, timestamp: 0 };

function invalidateFileCache() {
  fileListCache.data = null;
  fileListCache.timestamp = 0;
}

function getCachedFileList() {
  const cfg = getConfig();
  if (fileListCache.data && (Date.now() - fileListCache.timestamp) < cfg.cacheTTL * 1000) {
    return fileListCache.data;
  }
  return null;
}

function setFileListCache(data) {
  fileListCache.data = data;
  fileListCache.timestamp = Date.now();
}

module.exports = {
  rateLimitMiddleware,
  invalidateFileCache,
  getCachedFileList,
  setFileListCache,
};
