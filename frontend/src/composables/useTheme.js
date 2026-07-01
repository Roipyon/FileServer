/**
 * useTheme — 白天/暗色主题切换
 *
 * 持久化到 localStorage（key: fileserver-theme）。
 * 通过 <html data-theme="dark|light"> 控制样式切换。
 */
import { ref, watch } from 'vue'

const STORAGE_KEY = 'fileserver-theme'

const THEME = {
  DARK: 'dark',
  LIGHT: 'light',
}

// 全局单例
const currentTheme = ref(THEME.DARK)
let ready = false

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  currentTheme.value = theme
}

function loadPersistedTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === THEME.DARK || stored === THEME.LIGHT) {
      return stored
    }
  } catch {
    // localStorage 不可用时降级
  }
  return THEME.DARK // 默认暗色
}

function persistTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 静默失败
  }
}

function setTheme(theme) {
  if (theme !== THEME.DARK && theme !== THEME.LIGHT) return
  applyTheme(theme)
  persistTheme(theme)
}

function toggleTheme() {
  setTheme(currentTheme.value === THEME.DARK ? THEME.LIGHT : THEME.DARK)
}

function initTheme() {
  if (ready) return
  const theme = loadPersistedTheme()
  applyTheme(theme)
  ready = true
}

export function useTheme() {
  // 确保在首次调用时初始化
  if (!ready) {
    initTheme()
  }

  return {
    /** 当前主题名: 'dark' | 'light' */
    theme: currentTheme,
    /** 主题常量集 */
    THEME,
    /** 切换到指定主题 */
    setTheme,
    /** 切换白天/暗色 */
    toggleTheme,
    /** 初始化（从 localStorage 恢复）；如已初始化则无操作 */
    initTheme,
  }
}
