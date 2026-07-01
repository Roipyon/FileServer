/**
 * 剪贴板同步路由
 */
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const { CLIPBOARD_DIR } = require('../lib/paths');
const { sendError, parseJsonBody } = require('../lib/file-utils');

const CLIPBOARD_MAX_ITEMS = 100;

// ==================== 获取剪贴板列表 ====================

function getClipboard(req, res) {
  if (req.method !== 'GET') {
    sendError(res, 405, '方法不允许');
    return;
  }

  if (!fs.existsSync(CLIPBOARD_DIR)) {
    fs.mkdirSync(CLIPBOARD_DIR, { recursive: true });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  fs.readdir(CLIPBOARD_DIR, { withFileTypes: true }, (err, items) => {
    if (err) {
      logger.error('读取剪贴板目录错误:', err);
      sendError(res, 500, '无法读取剪贴板');
      return;
    }

    const clips = items
      .filter(item => item.isFile() && item.name.endsWith('.txt'))
      .map(item => {
        try {
          const filePath = path.join(CLIPBOARD_DIR, item.name);
          const stats = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf8');

          const baseName = item.name.replace(/\.txt$/, '');
          const firstUnderscore = baseName.indexOf('_');
          let timestamp, deviceName;
          if (firstUnderscore > 0) {
            timestamp = parseInt(baseName.substring(0, firstUnderscore), 10);
            deviceName = baseName.substring(firstUnderscore + 1);
          } else {
            timestamp = stats.mtimeMs;
            deviceName = '未知设备';
          }

          return { id: item.name, content, deviceName, timestamp, size: stats.size };
        } catch (error) {
          logger.error(`读取剪贴板条目失败 ${item.name}:`, error);
          return null;
        }
      })
      .filter(clip => clip !== null)
      .sort((a, b) => b.timestamp - a.timestamp);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(clips));
  });
}

// ==================== 保存剪贴板 ====================

function sendClipboard(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, '方法不允许');
    return;
  }

  parseJsonBody(req).then(body => {
    const { content, deviceName } = body;

    if (!content || !content.trim()) {
      sendError(res, 400, '剪贴板内容不能为空');
      return;
    }

    const safeName = (deviceName || '未知设备').replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50);
    const timestamp = Date.now();
    const fileName = `${timestamp}_${safeName}.txt`;
    const filePath = path.join(CLIPBOARD_DIR, fileName);

    if (!fs.existsSync(CLIPBOARD_DIR)) {
      fs.mkdirSync(CLIPBOARD_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf8');
    logger.debug(`剪贴板内容已保存: ${fileName}`);
    pruneClipboard();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: fileName }));
  }).catch(error => {
    logger.error('保存剪贴板失败:', error);
    sendError(res, 500, '保存剪贴板失败: ' + error.message);
  });
}

// ==================== 删除单条剪贴板 ====================

function deleteClipItem(req, res, pathname) {
  if (req.method !== 'DELETE') {
    sendError(res, 405, '方法不允许');
    return;
  }

  let filename;
  try {
    filename = decodeURIComponent(pathname.replace('/api/clipboard/', ''));
  } catch (error) {
    filename = pathname.replace('/api/clipboard/', '');
  }

  const filePath = path.join(CLIPBOARD_DIR, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedClipboard = path.resolve(CLIPBOARD_DIR);

  if (!resolvedPath.startsWith(resolvedClipboard)) {
    sendError(res, 403, '禁止访问');
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendError(res, 404, '剪贴板条目不存在');
    return;
  }

  try {
    fs.unlinkSync(filePath);
    logger.debug(`剪贴板条目已删除: ${filename}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    logger.error(`删除剪贴板条目失败 ${filename}:`, error);
    sendError(res, 500, '删除失败: ' + error.message);
  }
}

// ==================== 清空剪贴板 ====================

function clearClipboard(req, res) {
  if (req.method !== 'DELETE') {
    sendError(res, 405, '方法不允许');
    return;
  }

  if (!fs.existsSync(CLIPBOARD_DIR)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deletedCount: 0 }));
    return;
  }

  try {
    const files = fs.readdirSync(CLIPBOARD_DIR).filter(f => f.endsWith('.txt'));
    let deletedCount = 0;
    files.forEach(file => {
      try { fs.unlinkSync(path.join(CLIPBOARD_DIR, file)); deletedCount++; } catch {}
    });
    logger.info(`已清空剪贴板，删除 ${deletedCount} 条`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deletedCount }));
  } catch (error) {
    logger.error('清空剪贴板失败:', error);
    sendError(res, 500, '清空失败: ' + error.message);
  }
}

// ==================== 自动裁剪 ====================

function pruneClipboard() {
  if (!fs.existsSync(CLIPBOARD_DIR)) return;
  try {
    const files = fs.readdirSync(CLIPBOARD_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => ({ name: f, time: fs.statSync(path.join(CLIPBOARD_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(CLIPBOARD_MAX_ITEMS);
    toDelete.forEach(f => {
      try { fs.unlinkSync(path.join(CLIPBOARD_DIR, f.name)); } catch {}
    });
  } catch (error) {
    logger.error('自动清理出错:', error);
  }
}

module.exports = { getClipboard, sendClipboard, deleteClipItem, clearClipboard };
