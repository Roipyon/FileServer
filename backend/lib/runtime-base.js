/**
 * 运行时基座目录 — 全部可写数据目录的唯一锚点
 *
 * @yao-pkg/pkg 打包后 __dirname 指向只读快照虚拟路径（如 C:\snapshot\...），
 * shared-files、temp-*、.logs、config.json 等可写数据必须落在 exe 同级的真实磁盘目录；
 * 源码运行时 BASE_DIR 与原 PROJECT_ROOT（__dirname 上推两级）完全一致，行为不变。
 */
const fs = require('fs');
const path = require('path');

/** 是否运行在 pkg 打包产物中 */
const IS_PACKAGED = !!process.pkg;

/**
 * 可写数据基座目录。
 * 优先级：FILESERVER_HOME 环境变量 > 打包态 exe 所在目录 > 开发态项目根
 */
const BASE_DIR = process.env.FILESERVER_HOME
  ? path.resolve(process.env.FILESERVER_HOME)
  : IS_PACKAGED
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, '../..');

// 打包态若 exe 所在目录尚不存在（理论少见），尽力创建；失败不阻断启动
if (IS_PACKAGED && !fs.existsSync(BASE_DIR)) {
  try { fs.mkdirSync(BASE_DIR, { recursive: true }); } catch (e) { /* 后续写操作再报错 */ }
}

/**
 * ffmpeg 可执行文件路径。
 * 默认从 PATH 探测，可通过 FFMPEG_PATH 环境变量指定完整路径（支持含空格目录）。
 */
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

module.exports = { IS_PACKAGED, BASE_DIR, FFMPEG_BIN };
