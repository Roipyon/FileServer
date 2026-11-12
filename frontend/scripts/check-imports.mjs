// 严格导入审查：捕获「调用了本地模块导出的函数，但本文件未 import」的引用错误。
// 背景：vue-tsc 对纯 JS 的 <script setup> 不做未定义名检查，rollup 又把未解析
// 标识符静默当作全局变量打包，曾导致 ReferenceError 只在运行时暴露（手机端）。
// 规则：源码中出现「已知本地导出符号」的调用，而当前文件既未导入也未声明 → 报错。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const SRC = join(ROOT, 'src')
const EXT_MODULES = /\.(js|ts)$/
const EXT_ALL = /\.(vue|js|ts)$/

// —— 收集源码文件 ——
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT_ALL.test(name)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const rel = (p) => relative(SRC, p).replace(/\\/g, '/')

// —— 各模块的导出名 ——
const exportsByModule = new Map()
for (const f of files) {
  if (!EXT_MODULES.test(f)) continue
  const s = readFileSync(f, 'utf8')
  const names = new Set()
  for (const m of s.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of s.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const n = piece.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
  }
  exportsByModule.set(f, names)
}
const allExports = new Set([...exportsByModule.values()].flatMap((s) => [...s]))

// —— 浏览器 / JS / Vue 全局白名单 ——
const GLOBALS = new Set(
  (
    'window document navigator location history localStorage sessionStorage console ' +
    'alert confirm prompt fetch XMLHttpRequest FormData Blob File URL URLSearchParams ' +
    'Notification Image DataTransfer ClipboardEvent DragEvent Event CustomEvent KeyboardEvent ' +
    'Date Math JSON Object Array String Number Boolean Promise Map Set RegExp Error TypeError ' +
    'parseInt parseFloat isNaN encodeURIComponent decodeURIComponent structuredClone ' +
    'requestAnimationFrame cancelAnimationFrame getComputedStyle matchMedia crypto ' +
    'FileReader Audio ImageBitmap IntersectionObserver MutationObserver ResizeObserver ' +
    'defineProps defineEmits defineExpose withDefaults ' +
    'ref reactive computed watch watchEffect nextTick toRefs toRaw onMounted onUnmounted ' +
    'onBeforeMount onBeforeUnmount onActivated onDeactivated provide inject useAttrs useSlots'
  ).split(/\s+/)
)

let errors = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  const scripts = [...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const code = scripts.length ? scripts.join('\n') : EXT_MODULES.test(f) ? s : ''
  if (!code) continue

  // 本文件已知名字：导入 + 声明 + 解构
  const known = new Set(GLOBALS)
  for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const n = piece.trim().split(/\s+as\s+/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n)
    }
  }
  for (const m of code.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1])
  for (const m of code.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from/g)) known.add(m[1])
  for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1])
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const piece of m[1].split(',')) {
      const n = piece.trim().split(/\s*[:=]/)[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n)
    }
  }
  // 对象方法简写 foo() {} 也算本地声明
  for (const m of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) known.add(m[1])

  // 调用点扫描：非成员调用（排除 .foo() 与 new 前缀由白名单兜底）
  const lines = code.split('\n')
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const id = m[1]
    if (known.has(id) || !allExports.has(id)) continue
    const upto = code.slice(0, m.index)
    const line = upto.split('\n').length
    const text = lines[line - 1]?.trim() ?? ''
    console.error(`✗ ${rel(f)}:${line}  调用了本地导出 «${id}» 但未导入/未声明`)
    console.error(`    ${text.slice(0, 100)}`)
    errors++
  }
}

if (errors) {
  console.error(`\n导入审查失败：${errors} 处未导入引用`)
  process.exit(1)
}
console.log('导入审查通过')
