import { ref } from 'vue'

const dialogState = ref({
  visible: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  variant: 'danger', // 'danger' | 'accent'
})

let resolveCallback = null

export function useConfirmDialog() {
  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      dialogState.value = {
        visible: true,
        message,
        title: options.title || '确认操作',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        variant: options.variant || 'danger',
      }
      resolveCallback = resolve
    })
  }

  function handleConfirm() {
    if (resolveCallback) {
      resolveCallback(true)
      reset()
    }
  }

  function handleCancel() {
    if (resolveCallback) {
      resolveCallback(false)
      reset()
    }
  }

  function reset() {
    dialogState.value.visible = false
    resolveCallback = null
  }

  return { dialogState, confirm, handleConfirm, handleCancel, reset }
}

export { dialogState }
