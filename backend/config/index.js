/**
 * 配置管理 — 优先级：环境变量 > config.json > 默认值
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

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
