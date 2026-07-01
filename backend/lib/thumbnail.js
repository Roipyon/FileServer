/**
 * 缩略图 / 摘要生成
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');
const { SHARED_FOLDER, THUMBNAIL_CACHE_DIR } = require('./paths');
const { TEXT_PREVIEW_EXTS, IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, ARCHIVE_EXTS, getExt, getMimeType } = require('./constants');
const { sendError } = require('./file-utils');

let admZip = null;
let musicMetadata = null;
let ArchiveReader = null;
let libarchiveWasm = null;

function lazyLoadAdmZip() {
  if (!admZip) {
    try { admZip = require('adm-zip'); } catch (e) { admZip = null; }
  }
  return admZip;
}

function lazyLoadMusicMetadata() {
  if (!musicMetadata) {
    try { musicMetadata = require('music-metadata'); } catch (e) { musicMetadata = null; }
  }
  return musicMetadata;
}

function lazyLoadLibarchive() {
  if (!ArchiveReader) {
    try {
      const la = require('libarchive-wasm');
      ArchiveReader = la.ArchiveReader;
      libarchiveWasm = la.libarchiveWasm;
    } catch (e) {
      ArchiveReader = null;
      libarchiveWasm = null;
    }
  }
  return { ArchiveReader, libarchiveWasm };
}

// 压缩包类型检测

/**
 * 识别压缩包具体类型
 */
function getArchiveType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2') || lower.endsWith('.tbz')) return 'tarbz2';
  if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) return 'tarxz';
  if (lower.endsWith('.tar.zst') || lower.endsWith('.tzst')) return 'tarzst';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.zip')) return 'zip';
  return null;
}

/**
 * 检查文件名是否属于可预览的压缩包格式
 */
function isArchiveFile(filename) {
  return getArchiveType(filename) !== null;
}

// 压缩包内容读取

/**
 * 使用 adm-zip 读取 ZIP 文件列表
 */
function readZipEntries(filePath, maxEntries = 50) {
  const az = lazyLoadAdmZip();
  if (!az) return null;
  const zip = new az(filePath);
  const allEntries = zip.getEntries();
  return {
    entries: allEntries.slice(0, maxEntries).map(e => ({
      name: e.entryName,
      size: e.header.size,
      isDirectory: e.isDirectory,
    })),
    total: allEntries.length,
  };
}

/**
 * 使用 libarchive-wasm 读取各类压缩包文件列表
 */
async function readArchiveEntries(filePath, maxEntries = 50) {
  const { ArchiveReader, libarchiveWasm } = lazyLoadLibarchive();
  if (!ArchiveReader || !libarchiveWasm) return null;

  let reader = null;
  try {
    const libarchive = await libarchiveWasm();
    const fileBuffer = fs.readFileSync(filePath);
    const data = new Int8Array(fileBuffer);
    reader = new ArchiveReader(libarchive, data);

    // 检查是否加密
    if (reader.hasEncryptedData()) {
      return { encrypted: true, entries: [], total: 0 };
    }

    const entries = [];
    for (const entry of reader.entries()) {
      const pathname = entry.getPathname();
      // 跳过前两层路径（有些归档包含根目录条目或 '.'）
      if (pathname === '.' || pathname === '') continue;

      if (entries.length < maxEntries) {
        entries.push({
          name: pathname,
          size: entry.getSize(),
          isDirectory: entry.getFiletype() === 'Directory',
        });
      }
      entry.free();
      if (entries.length >= maxEntries) break;
    }

    // 获取总条目数（遍历剩余条目）
    let total = entries.length;
    if (total >= maxEntries) {
      // 需要继续遍历计数
      for (const entry of reader.entries()) {
        const pn = entry.getPathname();
        if (pn !== '.' && pn !== '') total++;
        entry.free();
      }
    }

    return { entries, total, encrypted: false };
  } catch (e) {
    logger.debug(`libarchive 读取失败:`, e.message);
    return null;
  } finally {
    if (reader) {
      try { reader.free(); } catch (e) { /* ignore */ }
    }
  }
}

// 缩略图服务

async function serveThumbnail(req, res, pathname) {
  const filename = decodeURIComponent(
    pathname.replace('/api/thumbnail/', '')
  ).replace(/^\/+/, '');

  const filePath = path.join(SHARED_FOLDER, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedShared = path.resolve(SHARED_FOLDER);

  if (!resolvedPath.startsWith(resolvedShared)) {
    sendError(res, 403, '禁止访问');
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendError(res, 404, '文件不存在');
    return;
  }

  const stats = fs.statSync(filePath);
  const cacheKey = `${filename}_${stats.mtimeMs}`;
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const cachePath = path.join(THUMBNAIL_CACHE_DIR, safeKey);

  if (fs.existsSync(cachePath)) {
    const cachedData = fs.readFileSync(cachePath, 'utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(cachedData);
    return;
  }

  const ext = getExt(filename);
  let result = null;

  try {
    if (IMAGE_EXTS.has(ext)) {
      const imageData = fs.readFileSync(filePath);
      const mime = getMimeType(filename);
      const base64 = imageData.toString('base64');
      result = { type: 'image', data: `data:${mime};base64,${base64}` };
    } else if (TEXT_PREVIEW_EXTS.has(ext) || ext === 'md') {
      const content = fs.readFileSync(filePath, 'utf-8').slice(0, 200);
      result = { type: 'text', data: content };
    } else if (VIDEO_EXTS.has(ext)) {
      const framePath = path.join(THUMBNAIL_CACHE_DIR, `${safeKey}_frame.jpg`);
      if (!fs.existsSync(framePath)) {
        try {
          execSync(
            `ffmpeg -i "${filePath}" -ss 3 -vframes 1 -q:v 2 "${framePath}" -y`,
            { timeout: 10000, stdio: 'pipe', windowsHide: true }
          );
        } catch (e) {
          logger.debug(`视频截帧失败 ${filename}:`, e.message);
        }
      }
      if (fs.existsSync(framePath)) {
        const imgData = fs.readFileSync(framePath);
        const base64 = imgData.toString('base64');
        result = { type: 'image', data: `data:image/jpeg;base64,${base64}` };
      } else {
        result = { type: 'fallback', data: 'video' };
      }
    } else if (AUDIO_EXTS.has(ext)) {
      try {
        const mm = lazyLoadMusicMetadata();
        if (mm) {
          const metadata = await mm.parseFile(filePath, { skipCovers: false });
          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            const base64 = Buffer.from(pic.data).toString('base64');
            result = { type: 'image', data: `data:${pic.format};base64,${base64}` };
          }
        }
      } catch (e) {
        logger.debug(`音频封面提取失败 ${filename}:`, e.message);
      }
      if (!result) {
        result = { type: 'fallback', data: 'audio' };
      }
    } else if (ARCHIVE_EXTS.has(ext) || isArchiveFile(filename)) {
      const archiveType = getArchiveType(filename);
      if (!archiveType) {
        result = { type: 'fallback', data: 'archive' };
      } else if (archiveType === 'zip') {
        // ZIP → 使用 adm-zip（现有逻辑）
        try {
          const zipData = readZipEntries(filePath, 50);
          if (zipData) {
            result = { type: 'archive', data: zipData.entries, total: zipData.total, format: 'zip' };
          } else {
            result = { type: 'fallback', data: 'archive' };
          }
        } catch (e) {
          logger.debug(`ZIP 读取失败 ${filename}:`, e.message);
          result = { type: 'fallback', data: 'archive' };
        }
      } else {
        // RAR / 7z / Tar → 使用 libarchive-wasm
        try {
          const archiveData = await readArchiveEntries(filePath, 50);
          if (archiveData === null) {
            result = { type: 'fallback', data: 'archive' };
          } else if (archiveData.encrypted) {
            result = { type: 'fallback', data: 'archive', encrypted: true };
          } else if (archiveData.entries.length === 0) {
            result = { type: 'fallback', data: 'archive' };
          } else {
            result = {
              type: 'archive',
              data: archiveData.entries,
              total: archiveData.total,
              format: archiveType,
            };
          }
        } catch (e) {
          logger.debug(`压缩包读取失败 ${filename}:`, e.message);
          result = { type: 'fallback', data: 'archive' };
        }
      }
    } else {
      result = { type: 'fallback', data: 'file' };
    }
  } catch (err) {
    logger.error(`生成缩略图失败 ${filename}:`, err);
    result = { type: 'fallback', data: 'file' };
  }

  if (!result) {
    result = { type: 'fallback', data: 'file' };
  }

  try {
    fs.writeFileSync(cachePath, JSON.stringify(result), 'utf-8');
  } catch (e) {
    logger.debug('缩略图缓存写入失败:', e.message);
  }

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

module.exports = { serveThumbnail };
