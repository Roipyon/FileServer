/**
 * 路径常量 — 集中管理所有数据目录路径
 *
 * 可写目录锚定 runtime-base 的 BASE_DIR（开发态=项目根，打包态=exe 所在目录）；
 * PUBLIC_DIR 在打包态读快照内嵌的 dist，开发态保持 dist > frontend/public 探测顺序。
 */
const path = require('path');
const fs = require('fs');
const { getConfig } = require('../config');
const { IS_PACKAGED, BASE_DIR } = require('./runtime-base');

const PROJECT_ROOT = BASE_DIR;
const config = getConfig();

const SHARED_FOLDER = path.resolve(PROJECT_ROOT, config.root || './shared-files');
const CHUNK_TEMP_DIR = path.join(PROJECT_ROOT, 'temp-chunks');
const CLIPBOARD_DIR = path.join(SHARED_FOLDER, '.clipboard');
const THUMBNAIL_CACHE_DIR = path.join(PROJECT_ROOT, 'temp-thumbnails');
const INCOMING_DIR = path.join(SHARED_FOLDER, 'incoming');

function resolvePublicDir() {
  if (IS_PACKAGED) {
    // 快照内嵌的前端产物（构建时由根 dist/ 拷贝到 backend/dist/ 后打包）
    return path.resolve(__dirname, '../dist');
  }
  const root = path.resolve(__dirname, '../..');
  const distDir = path.join(root, 'dist');
  if (fs.existsSync(distDir)) {
    return distDir;
  }
  return path.join(root, 'frontend', 'public');
}

const PUBLIC_DIR = resolvePublicDir();

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
