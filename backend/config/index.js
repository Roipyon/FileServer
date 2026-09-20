/**
 * 配置管理 — 优先级：环境变量 > config.json > 默认值
 */
const fs = require('fs');
const path = require('path');
const { IS_PACKAGED, BASE_DIR } = require('../lib/runtime-base');

// 开发态：项目根（__dirname 上推两级，行为不变）；打包态：exe 同级目录
const CONFIG_PATH = IS_PACKAGED
  ? path.join(BASE_DIR, 'config.json')
  : path.join(__dirname, '../../config.json');

const defaultConfig = {
  port: 3000,
  root: './shared-files',
  cacheTTL: 5,
  publicUrl: '',
  logAccess: false,
  rateLimit: 5000,
  rateLimitWindow: 60000,
  maxUploadSize: 10 * 1024 * 1024 * 1024,
};

let config = { ...defaultConfig };

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    Object.assign(config, fileConfig);
    console.log(`[Config] 已加载 config.json (${CONFIG_PATH})`);
  } else {
    // 首次运行自动生成默认配置，方便用户在 exe 同级直接修改
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
      console.log(`[Config] 已生成默认配置文件 (${CONFIG_PATH})`);
    } catch (writeErr) {
      console.warn(`[Config] 配置文件生成失败（将仅使用默认值）: ${writeErr.message}`);
    }
  }
} catch (err) {
  console.warn(`[Config] config.json 加载失败，使用默认值: ${err.message}`);
}

if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
if (process.env.STORAGE_PATH) config.root = process.env.STORAGE_PATH;
if (process.env.PUBLIC_URL) config.publicUrl = process.env.PUBLIC_URL;
if (process.env.LOG_ACCESS !== undefined) config.logAccess = process.env.LOG_ACCESS === 'true' || process.env.LOG_ACCESS === '1';
if (process.env.CACHE_TTL) config.cacheTTL = parseInt(process.env.CACHE_TTL, 10);

const isDocker = fs.existsSync('/.dockerenv') || (
  fs.existsSync('/proc/self/cgroup') &&
  fs.readFileSync('/proc/self/cgroup', 'utf-8').includes('docker')
);
config.isDocker = isDocker;
if (isDocker) {
  config.logAccess = false;
  console.log('[Config] 检测到容器环境，已调整默认配置');
}

function getConfig() {
  return { ...config };
}

function updateConfig(overrides) {
  const allowed = ['logAccess', 'publicUrl'];
  for (const key of Object.keys(overrides)) {
    if (allowed.includes(key)) {
      config[key] = overrides[key];
    }
  }
}

module.exports = { getConfig, updateConfig, isDocker };
