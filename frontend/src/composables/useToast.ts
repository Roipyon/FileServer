import { ref } from 'vue'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  icon?: string
}

export interface ToastOptions {
  type?: ToastType
  duration?: number
  icon?: string
}

// 单例响应式状态
const toasts = ref<ToastItem[]>([])
let nextId = 0

export function useToast() {
  function show(message: string, options: ToastOptions = {}): number {
    const { type = 'info', duration = 5000, icon } = options
    const id = ++nextId
    toasts.value.push({ id, message, type, icon })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function dismiss(id: number): void {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  function dismissAll(): void {
    toasts.value.splice(0)
  }

  // 类型快捷方法
  const success = (msg: string, opts?: ToastOptions) => show(msg, { ...opts, type: 'success', icon: opts?.icon || 'fa-check-circle' })
  const error   = (msg: string, opts?: ToastOptions) => show(msg, { ...opts, type: 'error',   icon: opts?.icon || 'fa-circle-xmark' })
  const warning = (msg: string, opts?: ToastOptions) => show(msg, { ...opts, type: 'warning', icon: opts?.icon || 'fa-triangle-exclamation' })
  const info    = (msg: string, opts?: ToastOptions) => show(msg, { ...opts, type: 'info',    icon: opts?.icon || 'fa-circle-info' })

  return { toasts, show, dismiss, dismissAll, success, error, warning, info }
}

// 方便模板直接引用全局状态
export { toasts }
