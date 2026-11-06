/**
 * useTheme — 白天/暗色主题切换
 *
 * 持久化到 localStorage（key: fileserver-theme）。
 * 通过 <html data-theme="dark|light"> 控制样式切换。
 */
import { ref } from 'vue'

const STORAGE_KEY = 'fileserver-theme'

export type ThemeName = 'dark' | 'light'

const THEME = {
  DARK: 'dark',
  LIGHT: 'light',
} as const

// 全局单例
const currentTheme = ref<ThemeName>(THEME.DARK)
let ready = false

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme)
  currentTheme.value = theme
}

function loadPersistedTheme(): ThemeName {
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

function persistTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 静默失败
  }
}

function setTheme(theme: ThemeName): void {
  if (theme !== THEME.DARK && theme !== THEME.LIGHT) return
  applyTheme(theme)
  persistTheme(theme)
}

function toggleTheme(): void {
  setTheme(currentTheme.value === THEME.DARK ? THEME.LIGHT : THEME.DARK)
}

function initTheme(): void {
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
