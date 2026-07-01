import { ref, nextTick } from 'vue'

const dialogState = ref({
  visible: false,
  title: '',
  message: '',
  defaultValue: '',
  placeholder: '',
  confirmText: '确定',
  cancelText: '取消',
})

let resolveCallback = null

export function usePromptDialog() {
  function prompt(message, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      dialogState.value = {
        visible: true,
        message,
        defaultValue,
        placeholder: options.placeholder || '',
        title: options.title || '输入',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
      }
      resolveCallback = resolve
    })
  }

  function handleConfirm(value) {
    if (resolveCallback) {
      resolveCallback(value)
      reset()
    }
  }

  function handleCancel() {
    if (resolveCallback) {
      resolveCallback(null)
      reset()
    }
  }

  function reset() {
    dialogState.value.visible = false
    resolveCallback = null
  }

  return { dialogState, prompt, handleConfirm, handleCancel, reset }
}
