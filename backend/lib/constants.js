/**
 * 常量定义 — MIME 类型、文件扩展名集合、通用判断函数
 */
const path = require('path');

// ==================== MIME 类型映射 ====================
const MIME_TYPES = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.mts': 'text/javascript; charset=utf-8',
  '.ctx': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.c': 'text/x-c; charset=utf-8',
  '.cpp': 'text/x-c++src; charset=utf-8',
  '.h': 'text/x-c; charset=utf-8',
  '.java': 'text/x-java; charset=utf-8',
  '.go': 'text/x-go; charset=utf-8',
  '.rs': 'text/x-rust; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.scss': 'text/x-scss; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/x-yaml; charset=utf-8',
  '.yml': 'text/x-yaml; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.sh': 'text/x-sh; charset=utf-8',
  '.bat': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.cfg': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.vue': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

const TEXT_PREVIEW_EXTS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'c', 'cpp', 'h',
  'java', 'go', 'rs', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml',
  'toml', 'sh', 'bat', 'ini', 'cfg', 'log', 'vue', 'csv', 'rb', 'php',
  'swift', 'kt', 'lua', 'r', 'sql', 'env', 'gitignore', 'dockerfile',
  'cmake', 'makefile', 'gradle', 'mjs', 'cjs', 'mts', 'ctx',
]);

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);
const INLINE_TYPE_PREFIXES = ['text/', 'image/', 'video/', 'audio/', 'application/pdf'];

function getExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function isInlineType(mime) {
  return INLINE_TYPE_PREFIXES.some(t => mime.startsWith(t));
}

module.exports = {
  MIME_TYPES,
  TEXT_PREVIEW_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
  ARCHIVE_EXTS,
  INLINE_TYPE_PREFIXES,
  getExt,
  getMimeType,
  isInlineType,
};
