/**
 * 服务器日志工具
 */
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

const LOG_DIR = path.join(__dirname, '../../.logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_DAYS = 30;

const isDocker = fs.existsSync('/.dockerenv') || (
  fs.existsSync('/proc/self/cgroup') &&
  fs.readFileSync('/proc/self/cgroup', 'utf-8').includes('docker')
);

if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_LOG_SIZE) return;

    const baseName = path.basename(filePath, '.log');
    const dateStr = new Date().toISOString().slice(0, 10);
    let target = path.join(LOG_DIR, `${baseName}.log.${dateStr}`);

    if (fs.existsSync(target)) {
      const timeStr = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
      target = path.join(LOG_DIR, `${baseName}.log.${dateStr}_${timeStr}`);
      let counter = 1;
      while (fs.existsSync(target)) {
        target = path.join(LOG_DIR, `${baseName}.log.${dateStr}_${timeStr}_${counter}`);
        counter++;
      }
    }
    fs.renameSync(filePath, target);
    cleanupOldLogs();
  } catch (e) {}
}

function cleanupOldLogs() {
  try {
    const cutoff = new Date(Date.now() - MAX_LOG_DAYS * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      const match = file.match(/^(access|error)\.log\.(\d{4}-\d{2}-\d{2})(?:_\d{2}-\d{2}-\d{2}(?:_\d+)?)?$/);
      if (match) {
        const fileDate = new Date(match[2]);
        if (!isNaN(fileDate) && fileDate < cutoff) {
          fs.unlinkSync(path.join(LOG_DIR, file));
        }
      }
    }
  } catch (e) {}
}

let accessStream = null;
let errorStream = null;

function getAccessStream() {
  if (isDocker) return null;
  if (!getConfig().logAccess) return null;
  if (accessStream) return accessStream;
  rotateIfNeeded(path.join(LOG_DIR, 'access.log'));
  try {
    accessStream = fs.createWriteStream(path.join(LOG_DIR, 'access.log'), { flags: 'a' });
    accessStream.on('error', (e) => console.error('[Logger] access stream error:', e));
  } catch (e) {
    accessStream = null;
  }
  return accessStream;
}

function getErrorStream() {
  if (isDocker) return null;
  if (errorStream) return errorStream;
  rotateIfNeeded(path.join(LOG_DIR, 'error.log'));
  try {
    errorStream = fs.createWriteStream(path.join(LOG_DIR, 'error.log'), { flags: 'a' });
    errorStream.on('error', (e) => console.error('[Logger] error stream error:', e));
  } catch (e) {
    errorStream = null;
  }
  return errorStream;
}

function timestamp() {
  return new Date().toISOString();
}

function format(level, msg, data) {
  const prefix = `[${timestamp()}] [${level}]`;
  if (data !== undefined) {
    const payload = data instanceof Error ? { error: data.message, stack: data.stack } : data;
    return `${prefix} ${msg} ${JSON.stringify(payload)}`;
  }
  return `${prefix} ${msg}`;
}

module.exports = {
  debug(msg, data) {
    if (currentLevel <= LOG_LEVELS.debug) console.debug(format('DEBUG', msg, data));
  },
  info(msg, data) {
    if (currentLevel <= LOG_LEVELS.info) console.log(format('INFO', msg, data));
  },
  warn(msg, data) {
    if (currentLevel <= LOG_LEVELS.warn) console.warn(format('WARN', msg, data));
  },
  error(msg, data) {
    if (currentLevel > LOG_LEVELS.error) return;
    const line = format('ERROR', msg, data);
    console.error(line);
    const stream = getErrorStream();
    if (stream) {
      rotateIfNeeded(path.join(LOG_DIR, 'error.log'));
      stream.write(line + '\n');
    }
  },
  access(method, url, status, duration, ip) {
    if (isDocker) return;
    if (!getConfig().logAccess) return;
    const stream = getAccessStream();
    if (!stream) return;
    rotateIfNeeded(path.join(LOG_DIR, 'access.log'));
    const line = `[${timestamp()}] ${ip || '-'} ${method} ${url} ${status} ${duration}ms\n`;
    stream.write(line);
  },
  close() {
    [accessStream, errorStream].forEach(stream => {
      if (stream) { try { stream.end(); } catch (e) {} }
    });
    accessStream = null;
    errorStream = null;
  },
};
