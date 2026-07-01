/**
 * 路径常量 — 集中管理所有数据目录路径
 */
const path = require('path');
const fs = require('fs');
const { getConfig } = require('../config');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const config = getConfig();

const SHARED_FOLDER = path.resolve(PROJECT_ROOT, config.root || './shared-files');
const CHUNK_TEMP_DIR = path.join(PROJECT_ROOT, 'temp-chunks');
const CLIPBOARD_DIR = path.join(SHARED_FOLDER, '.clipboard');
const THUMBNAIL_CACHE_DIR = path.join(PROJECT_ROOT, 'temp-thumbnails');
const INCOMING_DIR = path.join(SHARED_FOLDER, 'incoming');

const PUBLIC_DIR = fs.existsSync(path.join(PROJECT_ROOT, 'dist'))
  ? path.join(PROJECT_ROOT, 'dist')
  : path.join(PROJECT_ROOT, 'frontend', 'public');

const ALL_DIRS = [
  SHARED_FOLDER,
  CHUNK_TEMP_DIR,
  CLIPBOARD_DIR,
  THUMBNAIL_CACHE_DIR,
  INCOMING_DIR,
];

function ensureDataDirectories() {
  ALL_DIRS.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function cleanOldPreviewDir() {
  const OLD_PREVIEW_DIR = path.join(PROJECT_ROOT, 'temp-previews');
  if (fs.existsSync(OLD_PREVIEW_DIR)) {
    try {
      fs.rmSync(OLD_PREVIEW_DIR, { recursive: true, force: true });
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

module.exports = {
  PROJECT_ROOT,
  SHARED_FOLDER,
  CHUNK_TEMP_DIR,
  CLIPBOARD_DIR,
  THUMBNAIL_CACHE_DIR,
  INCOMING_DIR,
  PUBLIC_DIR,
  ensureDataDirectories,
  cleanOldPreviewDir,
};
