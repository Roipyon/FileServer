import { ref } from 'vue'

export type ConfirmAction = 'confirm' | 'third' | 'cancel'
export type ConfirmVariant = 'danger' | 'accent' | 'warning'

export interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  /** 可选第三按钮（如"保留两个"） */
  thirdText?: string
  /** 可选复选框（如"应用到全部"） */
  checkboxLabel?: string
  variant?: ConfirmVariant
}

export type ConfirmResult = boolean | ConfirmAction | { action: ConfirmAction; applyAll: boolean }

interface ConfirmDialogState {
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  thirdText: string
  checkboxLabel: string
  checkboxChecked: boolean
  variant: ConfirmVariant
}

const dialogState = ref<ConfirmDialogState>({
  visible: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  thirdText: '',
  checkboxLabel: '',
  checkboxChecked: false,
  variant: 'danger',
})

let resolveCallback: ((result: ConfirmResult) => void) | null = null

export function useConfirmDialog() {
  /**
   * 返回值语义：
   *  - 无 thirdText：true/false（与旧版一致）
   *  - 有 thirdText：'confirm' | 'third' | 'cancel'
   *  - 有 checkboxLabel：{ action, applyAll }（action 取值同上或 boolean）
   */
  function confirm(message: string, options: ConfirmOptions = {}): Promise<ConfirmResult> {
    return new Promise((resolve) => {
      dialogState.value = {
        visible: true,
        message,
        title: options.title || '确认操作',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        thirdText: options.thirdText || '',
        checkboxLabel: options.checkboxLabel || '',
        checkboxChecked: false,
        variant: options.variant || 'danger',
      }
      resolveCallback = resolve
    })
  }

  function finish(action: ConfirmAction): void {
    if (!resolveCallback) return
    const cb = resolveCallback
    resolveCallback = null
    dialogState.value.visible = false
    const { thirdText, checkboxLabel, checkboxChecked } = dialogState.value
    let result: ConfirmResult
    if (thirdText) {
      result = action // 'confirm' | 'third' | 'cancel'
    } else {
      result = action === 'confirm'
    }
    if (checkboxLabel) {
      const act: ConfirmAction = thirdText ? (result as ConfirmAction) : result === true ? 'confirm' : 'cancel'
      result = { action: act, applyAll: checkboxChecked }
    }
    cb(result)
  }

  function handleConfirm(): void {
    finish('confirm')
  }

  function handleThird(): void {
    finish('third')
  }

  function handleCancel(): void {
    finish('cancel')
  }

  function reset(): void {
    dialogState.value.visible = false
    resolveCallback = null
  }

  return { dialogState, confirm, handleConfirm, handleThird, handleCancel, reset }
}

export { dialogState }
