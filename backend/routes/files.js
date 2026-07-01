/**
 * 文件路由 — 文件 CRUD 操作
 */
const fs = require('fs');
const path = require('path');
const url = require('url');
const logger = require('../lib/logger');
const { SHARED_FOLDER, CHUNK_TEMP_DIR } = require('../lib/paths');
const { getConfig } = require('../config');
const { getMimeType, isInlineType } = require('../lib/constants');
const {
  checkDiskSpace,
  isFileLocked,
  formatFileSize,
  sendError,
  decodeRoutePath,
  isPathSafe,
  getUniquePath,
  parseJsonBody,
} = require('../lib/file-utils');
const { invalidateFileCache, getCachedFileList, setFileListCache } = require('../lib/middleware');
const { validateUploadToken, uploadTokens } = require('./share');

// ==================== 文件列表（带 mtime 和缓存） ====================

function getFileList(req, res) {
  if (req.method !== 'GET') {
    sendError(res, 405, '方法不允许');
    return;
  }

  if (!fs.existsSync(SHARED_FOLDER)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  const cached = getCachedFileList();
  if (cached) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cached));
    return;
  }

  fs.readdir(SHARED_FOLDER, { withFileTypes: true }, (err, items) => {
    if (err) {
      logger.error('读取文件夹错误:', err);
      sendError(res, 500, '无法读取文件夹');
      return;
    }

    const files = items
      .filter(item => item.isFile() && !item.name.startsWith('.'))
      .map(item => {
        try {
          const filePath = path.join(SHARED_FOLDER, item.name);
          const stats = fs.statSync(filePath);
          return {
            name: item.name,
            size: formatFileSize(stats.size),
            sizeInBytes: stats.size,
            modified: stats.mtime.toLocaleString('zh-CN'),
            mtimeMs: stats.mtimeMs,
            downloadUrl: `/download/${encodeURIComponent(item.name)}`,
          };
        } catch (error) {
          logger.error(`获取文件信息失败 ${item.name}:`, error);
          return null;
        }
      })
      .filter(file => file !== null);

    setFileListCache(files);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
  });
}

// ==================== 下载文件 ====================

function downloadFile(req, res, pathname) {
  const filename = decodeRoutePath(pathname, '/download/');
  const filePath = path.join(SHARED_FOLDER, filename);

  if (!isPathSafe(filePath, SHARED_FOLDER)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('禁止访问');
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`文件不存在: ${filename}`);
    return;
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('请求的路径不是文件');
    return;
  }

  try {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': stats.size,
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      logger.error('文件读取错误:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('服务器错误');
      }
    });
    fileStream.pipe(res);
  } catch (error) {
    logger.error('下载处理错误:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('服务器错误');
    }
  }
}

// ==================== 原始上传（保留兼容） ====================

function uploadFile(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const diskCheck = checkDiskSpace();
  if (!diskCheck.ok) {
    res.writeHead(507, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: diskCheck.message }));
    return;
  }

  logger.debug('开始处理文件上传...');

  try {
    const { IncomingForm } = require('formidable');
    const form = new IncomingForm({
      uploadDir: SHARED_FOLDER,
      keepExtensions: true,
      maxFileSize: getConfig().maxUploadSize,
      multiples: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        logger.error('文件解析错误:', err);
        sendError(res, 500, '文件解析失败: ' + err.message);
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

      if (uploadedFiles.length === 0) {
        sendError(res, 400, '没有接收到文件');
        return;
      }

      const results = [];
      uploadedFiles.forEach((file) => {
        try {
          const originalName = file.originalFilename || 'unknown';
          const tempPath = file.filepath;
          const targetPath = getUniquePath(SHARED_FOLDER, originalName);
          fs.renameSync(tempPath, targetPath);
          results.push({
            name: path.basename(targetPath),
            success: true,
            message: '文件上传成功',
          });
        } catch (error) {
          logger.error(`文件保存失败:`, error);
          if (fs.existsSync(file.filepath)) {
            fs.unlinkSync(file.filepath);
          }
          results.push({
            name: file.originalFilename || 'unknown',
            success: false,
            error: '文件保存失败: ' + error.message,
          });
        }
      });

      invalidateFileCache();

      const allSuccess = results.every(r => r.success);
      res.writeHead(allSuccess ? 200 : 207, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: allSuccess ? `成功上传 ${results.length} 个文件` : '部分文件上传失败',
        results,
      }));
    });

    form.on('error', (err) => {
      logger.error('Formidable 错误:', err);
      if (!res.headersSent) {
        sendError(res, 500, '文件上传处理错误: ' + err.message);
      }
    });
  } catch (error) {
    logger.error('上传处理异常:', error);
    sendError(res, 500, '服务器内部错误: ' + error.message);
  }
}

// ==================== 分片上传（支持可选 token 鉴权） ====================

function uploadChunk(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const token = parsedUrl.query.token;

  if (token) {
    const entry = validateUploadToken(res, token);
    if (!entry) return;
  }

  const { IncomingForm } = require('formidable');
  const form = new IncomingForm({
    uploadDir: CHUNK_TEMP_DIR,
    keepExtensions: false,
    maxFileSize: 100 * 1024 * 1024,
    multiples: false,
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      logger.error('分片解析错误:', err);
      if (!res.headersSent) sendError(res, 500, '分片解析失败');
      return;
    }

    const fileId = Array.isArray(fields.fileId) ? fields.fileId[0] : fields.fileId;
    const chunkIndex = Array.isArray(fields.chunkIndex) ? fields.chunkIndex[0] : fields.chunkIndex;
    const fileName = Array.isArray(fields.fileName) ? fields.fileName[0] : fields.fileName;
    const totalChunks = Array.isArray(fields.totalChunks) ? fields.totalChunks[0] : fields.totalChunks;
    const chunkFile = Array.isArray(files.chunk) ? files.chunk[0] : files.chunk;

    if (!fileId || chunkIndex === undefined || !fileName || !totalChunks || !chunkFile) {
      sendError(res, 400, '缺少必要参数');
      return;
    }

    const chunkFileName = `${fileId}_${chunkIndex}`;
    const chunkPath = path.join(CHUNK_TEMP_DIR, chunkFileName);

    try {
      fs.renameSync(chunkFile.filepath, chunkPath);
      logger.debug(`分片 ${chunkIndex}/${totalChunks} 保存成功: ${chunkFileName}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      logger.error(`分片保存失败:`, error);
      if (fs.existsSync(chunkFile.filepath)) fs.unlinkSync(chunkFile.filepath);
      if (!res.headersSent) sendError(res, 500, '分片保存失败');
    }
  });

  form.on('error', (err) => {
    logger.error('分片上传 Formidable 错误:', err);
    if (!res.headersSent) sendError(res, 500, '分片上传处理错误: ' + err.message);
  });
}

// ==================== 合并分片 ====================

function mergeChunks(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  parseJsonBody(req, 1024 * 1024).then(body => {
    const { fileId, fileName, totalChunks, token } = body;
    if (!fileId || !fileName || totalChunks === undefined) {
      sendError(res, 400, '缺少必要参数');
      return;
    }

    if (token) {
      if (!validateUploadToken(res, token)) return;
    }

    const chunkCount = Number(totalChunks);
    if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 20000) {
      sendError(res, 400, 'totalChunks 参数无效（范围 1-20000）');
      return;
    }

    let finalFilePath = getUniquePath(SHARED_FOLDER, fileName);
    const writeStream = fs.createWriteStream(finalFilePath);

    function writeChunk(index) {
      if (index >= chunkCount) {
        writeStream.end();
        if (token) {
          const entry = uploadTokens.get(token);
          if (entry) {
            entry.used = true;
            setTimeout(() => uploadTokens.delete(token), 5000);
          }
        }
        invalidateFileCache();
        logger.debug(`文件合并成功: ${path.basename(finalFilePath)}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          name: path.basename(finalFilePath),
          message: '文件合并成功',
        }));
        return;
      }

      const chunkFileName = `${fileId}_${index}`;
      const chunkPath = path.join(CHUNK_TEMP_DIR, chunkFileName);

      if (!fs.existsSync(chunkPath)) {
        writeStream.end();
        try { fs.unlinkSync(finalFilePath); } catch {}
        sendError(res, 400, `缺少分片 ${index}`);
        return;
      }

      const readStream = fs.createReadStream(chunkPath);
      readStream.pipe(writeStream, { end: false });

      readStream.on('end', () => {
        try { fs.unlinkSync(chunkPath); } catch {}
        writeChunk(index + 1);
      });

      readStream.on('error', (err) => {
        logger.error(`读取分片 ${index} 失败:`, err);
        writeStream.end();
        try { fs.unlinkSync(finalFilePath); } catch {}
        sendError(res, 500, `读取分片 ${index} 失败`);
      });
    }

    writeStream.on('error', (err) => {
      logger.error('写入目标文件失败:', err);
      try { fs.unlinkSync(finalFilePath); } catch {}
      if (!res.headersSent) sendError(res, 500, '写入文件失败');
    });

    writeChunk(0);
  }).catch(err => {
    if (!res.headersSent) sendError(res, 400, '合并分片失败: ' + err.message);
  });
}

// ==================== 删除文件（带锁检测） ====================

function deleteFile(req, res, pathname) {
  if (req.method !== 'DELETE') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const filename = decodeRoutePath(pathname, '/api/delete/');
  const filePath = path.join(SHARED_FOLDER, filename);

  if (!isPathSafe(filePath, SHARED_FOLDER)) {
    sendError(res, 403, '禁止访问');
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendError(res, 404, '文件不存在');
    return;
  }

  if (isFileLocked(filePath)) {
    sendError(res, 409, '文件正在被使用（预览/编辑中），无法删除');
    return;
  }

  try {
    fs.unlinkSync(filePath);
    invalidateFileCache();
    logger.debug(`文件删除成功: ${filename}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: '文件删除成功' }));
  } catch (error) {
    logger.error(`文件删除失败 ${filename}:`, error);
    sendError(res, 500, '文件删除失败: ' + error.message);
  }
}

// ==================== 原始文件服务 ====================

// 辅助函数：判断是否为可预览/可编辑的文件类型
function isPreviewableFile(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  // 文本类
  const textExts = new Set([
    'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'c', 'cpp', 'h',
    'java', 'go', 'rs', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml',
    'toml', 'sh', 'bat', 'ini', 'cfg', 'log', 'vue', 'csv', 'rb', 'php',
    'swift', 'kt', 'lua', 'r', 'sql', 'env', 'gitignore', 'dockerfile'
  ]);
  const imageExts = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','ico']);
  const videoExts = new Set(['mp4','webm','mov','avi','mkv','flv','wmv']);
  const audioExts = new Set(['mp3','wav','flac','aac','ogg','wma','m4a']);
  const archiveExts = new Set(['zip','rar','7z','tar','gz','bz2','xz']);
  
  return textExts.has(ext) || imageExts.has(ext) || videoExts.has(ext) ||
         audioExts.has(ext) || archiveExts.has(ext);
}

/**
 * 发送完整文件（200 OK），支持 HEAD 请求，支持 ETag 304 缓存
 */
function sendFullFile(req, res, filePath, mimeType, totalSize, filename, isHead = false, stats) {
  const isPreview = isPreviewableFile(filename);
  
  // 生成 ETag（使用修改时间毫秒 + 文件大小，保证唯一且随修改而变化）
  const etag = `W/"${stats.mtimeMs}-${stats.size}"`;

  // 如果是 HEAD 请求，只返回头信息（不处理 304，因为 HEAD 通常用于探测）
  if (isHead) {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
      'ETag': etag,
      'Cache-Control': isPreview ? 'no-cache, must-revalidate' : 'public, max-age=86400',
    });
    res.end();
    return;
  }

  // 核心：处理 If-None-Match（浏览器缓存验证）
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === etag) {
    // 文件未修改 -> 返回 304 Not Modified（无响应体，极速返回）
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': isPreview ? 'no-cache, must-revalidate' : 'public, max-age=86400',
    });
    res.end();
    return;
  }

  // 文件已修改（或首次请求）-> 返回 200 文件流
  const headers = {
    'Content-Type': mimeType,
    'Content-Length': totalSize,
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Cache-Control': isPreview ? 'no-cache, must-revalidate' : 'public, max-age=86400',
    'Content-Disposition': isInlineType(mimeType)
      ? `inline; filename="${encodeURIComponent(filename)}"`
      : `attachment; filename="${encodeURIComponent(filename)}"`,
  };

  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    logger.error(`文件流读取失败 (完整文件): ${filename}`, err);
    if (!res.headersSent) sendError(res, 500, '文件读取失败');
    else res.destroy();
  });
  stream.pipe(res);
}

/**
 * 提供原始文件内容，支持 HTTP Range 请求（视频拖拽、断点续传）
 */
function serveRawFile(req, res, pathname) {
  const filename = decodeRoutePath(pathname, '/api/raw/');
  const filePath = path.join(SHARED_FOLDER, filename);

  if (!isPathSafe(filePath, SHARED_FOLDER)) {
    sendError(res, 403, '禁止访问');
    return;
  }
  if (!fs.existsSync(filePath)) {
    sendError(res, 404, '文件不存在');
    return;
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    sendError(res, 400, '请求的路径不是文件');
    return;
  }

  const totalSize = stats.size;
  const mimeType = getMimeType(filename);
  const rangeHeader = req.headers.range;
  const isHead = req.method === 'HEAD';

  // ---------- 处理 HEAD 请求（浏览器探测是否支持 Range） ----------
  if (isHead) {
    sendFullFile(req, res, filePath, mimeType, totalSize, filename, true, stats);
    return;
  }

  // ---------- 处理 Range 请求 ----------
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      let start = parseInt(match[1], 10);
      let end = parseInt(match[2], 10);
      const hasStart = !isNaN(start);
      const hasEnd = !isNaN(end);

      // 处理 bytes=-suffix（请求最后 N 字节）
      if (!hasStart && hasEnd) {
        start = Math.max(0, totalSize - end);
        end = totalSize - 1;
      }
      // 处理 bytes=start-（请求从 start 到末尾）
      else if (hasStart && !hasEnd) {
        end = totalSize - 1;
      }
      // 处理 bytes=start-end（常规情况）
      else if (hasStart && hasEnd) {
        // 正常解析，无需额外处理
      } else {
        // 格式错误，返回完整文件
        return sendFullFile(req, res, filePath, mimeType, totalSize, filename, false, stats);
      }

      // 边界校验
      if (start < 0) start = 0;
      if (end >= totalSize) end = totalSize - 1;
      if (start > end || start >= totalSize) {
        // 416 Range Not Satisfiable
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
          'Content-Type': mimeType,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;

      // 处理 If-Range（如果文件修改时间与请求不符，则返回完整文件）
      const ifRange = req.headers['if-range'];
      if (ifRange) {
        const ifDate = new Date(ifRange);
        if (!isNaN(ifDate.getTime())) {
          const fileMtime = new Date(stats.mtime);
          if (fileMtime > ifDate) {
            // 文件已被修改，忽略 Range，返回完整文件
            return sendFullFile(req, res, filePath, mimeType, totalSize, filename, false, stats);
          }
        }
      }

      // ---------- 返回 206 Partial Content ----------
      const isPreview = isPreviewableFile(filename);
      const headers = {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': isPreview
          ? 'no-cache, must-revalidate'   // 可预览文件 → 不缓存
          : 'public, max-age=86400',                // 其他文件 → 缓存 24 小时
        'ETag': `W/"${stats.mtimeMs}-${stats.size}"`,
        'Content-Disposition': isInlineType(mimeType)
          ? `inline; filename="${encodeURIComponent(filename)}"`
          : `attachment; filename="${encodeURIComponent(filename)}"`,
      };

      res.writeHead(206, headers);
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', (err) => {
        logger.error(`文件流读取失败 (Range): ${filename}`, err);
        if (!res.headersSent) sendError(res, 500, '文件读取失败');
        else res.destroy();
      });
      stream.pipe(res);
      return;
    }
  }

  // ---------- 无 Range 或解析失败 → 返回完整文件 ----------
  sendFullFile(req, res, filePath, mimeType, totalSize, filename, false, stats);
}

// ==================== 重命名文件 ====================

function renameFile(req, res, pathname) {
  if (req.method !== 'PATCH') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const filename = decodeRoutePath(pathname, '/api/files/');
  const oldPath = path.join(SHARED_FOLDER, filename);

  if (!isPathSafe(oldPath, SHARED_FOLDER)) {
    sendError(res, 403, '禁止访问');
    return;
  }

  if (!fs.existsSync(oldPath)) {
    sendError(res, 404, '文件不存在');
    return;
  }

  parseJsonBody(req).then(body => {
    const { newName } = body;
    if (!newName || !newName.trim()) {
      sendError(res, 400, '新文件名不能为空');
      return;
    }

    const cleaned = newName.trim();
    const illegalChars = /[\/\\:*?"<>|]/;
    if (illegalChars.test(cleaned)) {
      sendError(res, 400, '文件名包含非法字符（/ \\ : * ? " < > |）');
      return;
    }

    const newPath = path.join(SHARED_FOLDER, cleaned);
    if (!isPathSafe(newPath, SHARED_FOLDER)) {
      sendError(res, 403, '禁止访问');
      return;
    }

    if (fs.existsSync(newPath)) {
      sendError(res, 409, `文件 "${cleaned}" 已存在`);
      return;
    }

    fs.renameSync(oldPath, newPath);
    invalidateFileCache();
    logger.debug(`文件重命名成功: ${filename} → ${cleaned}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, oldName: filename, newName: cleaned }));
  }).catch(err => {
    if (!res.headersSent) sendError(res, 400, '文件重命名失败: ' + err.message);
  });
}

// ==================== 保存文件内容 ====================

function saveFileContent(req, res, pathname) {
  if (req.method !== 'PUT') {
    sendError(res, 405, '方法不允许');
    return;
  }

  const filename = decodeRoutePath(pathname, '/api/files/');
  const filePath = path.join(SHARED_FOLDER, filename);

  if (!isPathSafe(filePath, SHARED_FOLDER)) {
    sendError(res, 403, '禁止访问');
    return;
  }

  parseJsonBody(req).then(body => {
    const { content } = body;
    if (content === undefined) {
      sendError(res, 400, '缺少 content 字段');
      return;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    invalidateFileCache();
    logger.debug(`文件保存成功: ${filename}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, name: filename }));
  }).catch(err => {
    if (!res.headersSent) sendError(res, 400, '文件保存失败: ' + err.message);
  });
}

module.exports = {
  getFileList,
  downloadFile,
  uploadFile,
  uploadChunk,
  mergeChunks,
  deleteFile,
  serveRawFile,
  renameFile,
  saveFileContent,
};
