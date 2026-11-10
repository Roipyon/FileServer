import { onUnmounted } from 'vue'
import { useFileManager } from './useFileManager'

const LONG_PRESS_MS = 500   // 长按判定时长
const MOVE_TOLERANCE = 10   // 判定取消的移动容差(px)

/**
 * 长按触发批量选择（移动端触摸）：
 * 长按 500ms 后进入选择模式并选中该文件；移动超过容差或抬手取消。
 * 长按触发后屏蔽紧随其后的 click（用 wasLongPress() 在 click 处理器里守卫）。
 */
export function useLongPressSelect() {
  const { toggleSelect } = useFileManager()
  let timer: ReturnType<typeof setTimeout> | null = null
  let triggered = false
  let cleanupDoc: (() => void) | null = null

  function startPress(filename: string, event: TouchEvent): void {
    clearPress()
    if (!event.touches || event.touches.length !== 1) return
    const x = event.touches[0].clientX
    const y = event.touches[0].clientY
    triggered = false

    timer = setTimeout(() => {
      triggered = true
      try { navigator.vibrate && navigator.vibrate(30) } catch {
        // 部分环境不支持振动
      }
      // toggleSelect 会在选中首个文件时自动进入选择模式
      toggleSelect(filename)
    }, LONG_PRESS_MS)

    const onMove = (e: TouchEvent) => {
      const t = e.touches && e.touches[0]
      if (!t) return
      if (Math.abs(t.clientX - x) > MOVE_TOLERANCE || Math.abs(t.clientY - y) > MOVE_TOLERANCE) {
        clearPress()
      }
    }
    const onEnd = () => clearPress()
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    cleanupDoc = () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }

  function clearPress(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (cleanupDoc) {
      cleanupDoc()
      cleanupDoc = null
    }
  }

  /** click 处理器中调用：若刚触发了长按则返回 true 并延迟复位 */
  function wasLongPress(): boolean {
    if (!triggered) return false
    setTimeout(() => { triggered = false }, 350)
    return true
  }

  onUnmounted(clearPress)

  return { startPress, clearPress, wasLongPress }
}
