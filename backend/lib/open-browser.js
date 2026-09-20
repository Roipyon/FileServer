/**
 * 系统默认浏览器打开 URL — 平台原生实现
 *
 * 替代 open 包：pkg 打包场景下 open（纯 ESM）存在互操作与挂起风险，
 * 本实现仅覆盖"打开 URL"这一用途，行为与 open 一致。
 */
const { spawn } = require('child_process');

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      // start 的第一个引号参数为窗口标题，URL 作为第二个参数
      child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { openBrowser };
