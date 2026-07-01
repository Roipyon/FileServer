/**
 * ZIP 打包工具模块 — 批量压缩下载支持
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const crypto = require('crypto');
const logger = require('./logger');
const { SHARED_FOLDER } = require('./paths');

const ZIP_TEMP_DIR = path.join(__dirname, '../../temp-zip');
const MAX_FILES_PER_ZIP = 1000;
const TASK_CLEANUP_MS = 5 * 60 * 1000;

if (!fs.existsSync(ZIP_TEMP_DIR)) {
  fs.mkdirSync(ZIP_TEMP_DIR, { recursive: true });
}

const zipTasks = new Map();

function formatTimestampName() {
  const now = new Date();
  const y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `FileServer_${y}${M}${d}_${h}${m}${s}.zip`;
}

function generateTaskId() {
  return crypto.randomUUID();
}

function createZipTask(files, zipName) {
  const taskId = generateTaskId();
  const safeZipName = sanitizeZipName(zipName);

  const task = {
    id: taskId,
    state: 'pending',
    percent: 0,
    totalFiles: files.length,
    processedFiles: 0,
    skippedFiles: 0,
    currentFile: '',
    zipName: safeZipName,
    outputPath: path.join(ZIP_TEMP_DIR, `${taskId}.zip`),
    createdAt: Date.now(),
    error: null,
    _cancelled: false,
    _fileSize: null,
    _cleanupTimer: null,
  };

  zipTasks.set(taskId, task);
  return task;
}

function sanitizeZipName(name) {
  let safe = (name || formatTimestampName()).trim();
  if (!safe.toLowerCase().endsWith('.zip')) safe += '.zip';
  safe = safe.replace(/[/\\:*?"<>|]/g, '_');
  if (safe.length > 200) safe = safe.substring(0, 196) + '.zip';
  if (!safe || safe === '.zip') safe = formatTimestampName();
  return safe;
}

function cleanupTask(taskId) {
  const task = zipTasks.get(taskId);
  if (!task) return;

  if (task._cleanupTimer) {
    clearTimeout(task._cleanupTimer);
    task._cleanupTimer = null;
  }

  try {
    if (fs.existsSync(task.outputPath)) {
      fs.unlinkSync(task.outputPath);
      logger.debug(`ZIP 临时文件已删除: ${task.outputPath}`);
    }
  } catch (err) {
    logger.debug(`删除 ZIP 临时文件失败: ${err.message}`);
  }

  zipTasks.delete(taskId);
  logger.debug(`ZIP 任务已清理: ${taskId}`);
}

function scheduleCleanup(task) {
  if (task._cleanupTimer) clearTimeout(task._cleanupTimer);
  task._cleanupTimer = setTimeout(() => {
    cleanupTask(task.id);
  }, TASK_CLEANUP_MS);
}

function startZipPack(task, files) {
  task.state = 'processing';

  const output = fs.createWriteStream(task.outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.pipe(output);

  let validCount = 0;
  let skippedCount = 0;

  for (const fileName of files) {
    const filePath = path.join(SHARED_FOLDER, fileName);
    const resolvedPath = path.resolve(filePath);
    const resolvedShared = path.resolve(SHARED_FOLDER);

    if (!resolvedPath.startsWith(resolvedShared)) {
      logger.warn(`[ZIP] 安全拦截（路径遍历）: ${fileName}`);
      skippedCount++;
      task.skippedFiles = skippedCount;
      continue;
    }

    if (!fs.existsSync(filePath)) {
      logger.warn(`[ZIP] 跳过（文件不存在）: ${fileName}`);
      skippedCount++;
      task.skippedFiles = skippedCount;
      continue;
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      logger.warn(`[ZIP] 跳过（非文件）: ${fileName}`);
      skippedCount++;
      task.skippedFiles = skippedCount;
      continue;
    }

    archive.file(filePath, { name: fileName });
    validCount++;
  }

  task.totalFiles = validCount;

  if (validCount === 0) {
    archive.append('', { name: '(empty).txt' });
  }

  archive.on('entry', (entry) => {
    task.currentFile = entry.name;
  });

  archive.on('progress', (data) => {
    task.processedFiles = data.entries.processed || 0;
    if (data.entries.total > 0) {
      task.percent = Math.min(
        Math.round((data.entries.processed / data.entries.total) * 100),
        99
      );
    }
  });

  output.on('close', () => {
    if (!task._cancelled) {
      task.state = 'completed';
      task.percent = 100;
      task.processedFiles = validCount;
      task._fileSize = fs.statSync(task.outputPath).size;
      logger.info(
        `[ZIP] 打包完成: "${task.zipName}" ` +
        `(${validCount} 文件, 共 ${(task._fileSize / (1024*1024)).toFixed(1)} MB` +
        (skippedCount > 0 ? `, ${skippedCount} 跳过)` : ')')
      );
      scheduleCleanup(task);
    }
  });

  archive.on('error', (err) => {
    if (!task._cancelled) {
      task.state = 'error';
      task.error = `ZIP 压缩失败: ${err.message}`;
      logger.error(`[ZIP] 压缩错误:`, err);
      scheduleCleanup(task);
    }
  });

  output.on('error', (err) => {
    if (!task._cancelled) {
      task.state = 'error';
      task.error = `ZIP 写入失败: ${err.message}`;
      logger.error(`[ZIP] 写入错误:`, err);
      scheduleCleanup(task);
    }
  });

  archive.finalize();
}

// ==================== 对外 API ====================

function handleDownloadZip(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '方法不允许' }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const { files, zipName } = JSON.parse(body);
      if (!files || !Array.isArray(files) || files.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请选择至少一个文件' }));
        return;
      }
      if (files.length > MAX_FILES_PER_ZIP) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `一次最多打包 ${MAX_FILES_PER_ZIP} 个文件`, maxFiles: MAX_FILES_PER_ZIP }));
        return;
      }

      const task = createZipTask(files, zipName);
      setImmediate(() => { startZipPack(task, files); });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId: task.id, zipName: task.zipName, totalFiles: files.length }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请求格式错误' }));
    }
  });
}

function handleZipProgress(req, res, taskId) {
  const task = zipTasks.get(taskId);
  if (!task) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '任务不存在或已过期' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    taskId: task.id, state: task.state, percent: task.percent,
    totalFiles: task.totalFiles, processedFiles: task.processedFiles,
    skippedFiles: task.skippedFiles || 0, currentFile: task.currentFile || '',
    zipName: task.zipName, error: task.error || null,
  }));
}

function handleZipDownload(req, res, taskId) {
  const task = zipTasks.get(taskId);
  if (!task) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ZIP 文件未就绪或任务不存在' }));
    return;
  }

  if (task.state !== 'completed') {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ZIP 尚未打包完成', state: task.state, percent: task.percent }));
    return;
  }

  if (!fs.existsSync(task.outputPath)) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ZIP 文件已过期，请重新打包' }));
    return;
  }

  const stats = fs.statSync(task.outputPath);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(task.zipName)}"`,
    'Content-Length': stats.size,
  });

  const readStream = fs.createReadStream(task.outputPath);
  readStream.on('error', (err) => {
    logger.error('[ZIP] 下载读取错误:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '读取 ZIP 文件失败' }));
  });
  readStream.pipe(res);
}

function handleZipCancel(req, res, taskId) {
  if (req.method !== 'DELETE') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '方法不允许' }));
    return;
  }

  const task = zipTasks.get(taskId);
  if (!task) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '任务不存在或已过期' }));
    return;
  }

  task._cancelled = true;
  task.state = 'cancelled';
  cleanupTask(taskId);

  logger.info(`[ZIP] 任务已取消: ${taskId}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, taskId }));
}

module.exports = { handleDownloadZip, handleZipProgress, handleZipDownload, handleZipCancel, zipTasks, cleanupTask };
