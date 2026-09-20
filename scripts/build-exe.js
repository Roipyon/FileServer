/**
 * build:exe 第二阶段 —— esbuild 预打包 + pkg 打包 Windows 单文件可执行文件
 *
 * 用法：npm run build:exe（先由根脚本执行 vite 构建，再调用本脚本）
 *
 * 步骤：
 *  1. 根 dist/（vite 产物）拷贝到 backend/dist/，作为 pkg 资产随 exe 内嵌
 *  2. esbuild 把 backend 打成单文件 CJS bundle（转换 music-metadata/open 等
 *     纯 ESM 依赖——pkg 对 ESM 依赖链打包不完整）；libarchive-wasm 保持 external，
 *     其 .wasm 资产由 pkg 按原始 __dirname 路径加载
 *  3. 将提升到根 node_modules 的 libarchive-wasm 复制到 backend/node_modules/，
 *     保证 pkg 静态分析能连 JS 带 .wasm 一起打入快照
 *  4. 第一遍 pkg：确保基础二进制已缓存
 *  5. 用 resedit 给基础二进制写入应用图标与版本信息
 *     （不能 rcedit 最终 exe：pkg 的数据载荷以 overlay 附加在 PE 末尾，
 *      rcedit 重写资源段会截断 overlay 导致 exe 无法启动；
 *      rcedit 也不适合改基础二进制——它只替换部分图标条目，Node 原始的
 *      绿色小图标会残留，其余条目会写坏）
 *  6. 第二遍 pkg：通过 PKG_NODE_PATH 指定带图标的基础二进制
 *     （pkg-fetch 会跳过哈希校验，否则改过的缓存会被判定损坏而重新下载）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const SRC_DIST = path.join(ROOT, 'dist');
const DEST_DIST = path.join(BACKEND, 'dist');
const WASM_SRC = path.join(ROOT, 'node_modules', 'libarchive-wasm');
const WASM_DEST = path.join(BACKEND, 'node_modules', 'libarchive-wasm');
const BUILD_DIR = path.join(BACKEND, 'build');
const BUNDLE = path.join(BUILD_DIR, 'index.js');

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function bin(name) {
  const p = path.join(ROOT, 'node_modules', '.bin', name);
  return process.platform === 'win32' ? `${p}.cmd` : p;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (result.status !== 0) {
    throw new Error(`命令失败: ${path.basename(cmd)} ${args.join(' ')}`);
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function locateBaseBinary() {
  const cacheRoot = process.env.PKG_CACHE_PATH || path.join(os.homedir(), '.pkg-cache');
  const hits = [];
  for (const ver of fs.readdirSync(cacheRoot)) {
    const dir = path.join(cacheRoot, ver);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^fetched-v.*-win-x64$/.test(f)) hits.push(path.join(dir, f));
    }
  }
  return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// ---- ICO 生成：32bpp DIB（XOR 面 bottom-up BGRA + 全零 AND 掩码，alpha 通道生效）----
function bmpDib(size, rgba) {
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = y * size * 4;
    const dst = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      xor[dst + x * 4 + 0] = rgba[src + x * 4 + 2]; // B
      xor[dst + x * 4 + 1] = rgba[src + x * 4 + 1]; // G
      xor[dst + x * 4 + 2] = rgba[src + x * 4 + 0]; // R
      xor[dst + x * 4 + 3] = rgba[src + x * 4 + 3]; // A
    }
  }
  const and = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([header, xor, and]);
}

function buildIco(sourcePngPath, iconOutPath) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  return loadImage(sourcePngPath).then((iconSource) => {
    // 先统一缩到 256 再派生小尺寸，避免 512 直降到 16 的锯齿
    const mid = createCanvas(256, 256);
    mid.getContext('2d').drawImage(iconSource, 0, 0, 256, 256);

    const sizes = [256, 128, 64, 48, 32, 16];
    const entries = sizes.map((size) => {
      const canvas = createCanvas(size, size);
      canvas.getContext('2d').drawImage(mid, 0, 0, size, size);
      const rgba = canvas.getContext('2d').getImageData(0, 0, size, size).data;
      return { size, data: bmpDib(size, rgba) };
    });

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    let offset = 6 + entries.length * 16;
    const dirParts = [];
    const bodyParts = [];
    for (const e of entries) {
      const d = Buffer.alloc(16);
      d.writeUInt8(e.size % 256, 0);
      d.writeUInt8(e.size % 256, 1);
      d.writeUInt16LE(1, 4);
      d.writeUInt16LE(32, 6);
      d.writeUInt32LE(e.data.length, 8);
      d.writeUInt32LE(offset, 12);
      offset += e.data.length;
      dirParts.push(d);
      bodyParts.push(e.data);
    }
    fs.writeFileSync(iconOutPath, Buffer.concat([header, ...dirParts, ...bodyParts]));
  });
}

async function main() {
  try {
    // 1. 前端产物 → backend/dist
    if (!fs.existsSync(path.join(SRC_DIST, 'index.html'))) {
      console.error('[build-exe] 根 dist/index.html 不存在，请先执行前端构建（npm run build）');
      process.exit(1);
    }
    rm(DEST_DIST);
    copyDir(SRC_DIST, DEST_DIST);
    const distFiles = (function count(dir) {
      return fs.readdirSync(dir, { withFileTypes: true })
        .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
    })(DEST_DIST);
    console.log(`[build-exe] 前端产物已拷贝: backend/dist (${distFiles} 个文件)`);

    // 2. libarchive-wasm → backend/node_modules（external 依赖，pkg 按解析路径打包，.wasm 必须在快照内）
    if (!fs.existsSync(path.join(WASM_SRC, 'dist', 'libarchive.wasm'))) {
      console.error('[build-exe] 未找到 node_modules/libarchive-wasm，请先 npm install');
      process.exit(1);
    }
    rm(WASM_DEST);
    copyDir(WASM_SRC, WASM_DEST);
    console.log('[build-exe] libarchive-wasm 已复制到 backend/node_modules/');

    // 3. esbuild 预打包：backend → 单文件 CJS bundle（转换纯 ESM 依赖；libarchive-wasm 保持 external）
    if (!fs.existsSync(bin('esbuild'))) {
      console.error('[build-exe] 未找到 esbuild，请先 npm install');
      process.exit(1);
    }
    rm(BUILD_DIR);
    run(bin('esbuild'), [
      'backend/index.js',
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      `--outfile=${path.relative(ROOT, BUNDLE)}`,
      '--external:libarchive-wasm',
      '--log-level=warning',
    ]);
    console.log(`[build-exe] esbuild bundle 完成: backend/build/index.js (${(fs.statSync(BUNDLE).size / 1024 / 1024).toFixed(1)} MB)`);

    // 4. pkg 打包
    if (!fs.existsSync(bin('pkg'))) {
      console.error('[build-exe] 未找到 @yao-pkg/pkg，请先 npm install');
      process.exit(1);
    }

    fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
    const output = path.join(ROOT, 'release', 'FileServer-win.exe');

    console.log('[build-exe] 第一遍打包（确保基础二进制已缓存）...');
    run(bin('pkg'), [path.join('backend', 'package.json'), '--output', output]);

    const baseBinary = locateBaseBinary();
    if (!baseBinary) {
      console.error('[build-exe] 未在 pkg 缓存中找到基础二进制');
      process.exit(1);
    }
    console.log('[build-exe] 基础二进制:', baseBinary);

    // 5. 生成多尺寸应用图标（源图 frontend/public/favicon.ico 实为 PNG，需转真 ICO）
    await buildIco(path.join(ROOT, 'frontend', 'public', 'favicon.ico'), path.join(BUILD_DIR, 'icon.ico'));
    const ICON = path.join(BUILD_DIR, 'icon.ico');

    // 6. 用 resedit 给基础二进制写入图标与版本信息（整体替换图标组与版本资源）
    const version = require(path.join(ROOT, 'package.json')).version;
    const [verMajor = 0, verMinor = 0, verPatch = 0] = version.split('.').map(v => parseInt(v, 10) || 0);

    const { NtExecutable, NtExecutableResource, Data, Resource } = await import('resedit');
    const pe = NtExecutable.from(fs.readFileSync(baseBinary));
    const res = NtExecutableResource.from(pe);

    const iconFile = Data.IconFile.from(fs.readFileSync(ICON));
    Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      iconFile.icons.map(item => item.data)
    );

    const versionInfos = Resource.VersionInfo.fromEntries(res.entries);
    const vi = versionInfos[0] || Resource.VersionInfo.createEmpty();
    vi.fixedInfo.fileVersionMS = (verMajor << 16) | verMinor;
    vi.fixedInfo.fileVersionLS = (verPatch << 16);
    vi.fixedInfo.productVersionMS = (verMajor << 16) | verMinor;
    vi.fixedInfo.productVersionLS = (verPatch << 16);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: 'FileServer',
        FileDescription: 'FileServer - 局域网文件传输与剪贴板同步',
        FileVersion: version,
        ProductVersion: version,
        CompanyName: 'Roipyon',
        LegalCopyright: `Copyright © ${new Date().getFullYear()} Roipyon`,
        OriginalFilename: 'FileServer-win.exe',
      }
    );
    vi.outputToResourceEntries(res.entries);

    res.outputResource(pe);
    fs.writeFileSync(baseBinary, Buffer.from(pe.generate()));

    // 7. 第二遍 pkg：基于已带图标的基础二进制追加载荷
    //    PKG_NODE_PATH 指定基础二进制路径：pkg-fetch 会直接采用它并跳过哈希校验
    //    （否则被 resedit 改过的基础二进制会因哈希不符被判定损坏而重新下载）
    console.log('[build-exe] 第二遍打包（基于已带图标的基础二进制）...');
    run(bin('pkg'), [path.join('backend', 'package.json'), '--output', output], {
      env: { ...process.env, PKG_NODE_PATH: baseBinary },
    });

    const sizeMB = (fs.statSync(output).size / 1024 / 1024).toFixed(1);
    console.log(`[build-exe] 完成: release/FileServer-win.exe (${sizeMB} MB)`);
  } catch (err) {
    console.error('[build-exe]', err.message);
    process.exit(1);
  }
}

main();
