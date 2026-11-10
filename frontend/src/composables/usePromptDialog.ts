import { ref, nextTick } from 'vue'

export interface PromptOptions {
  title?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  /** 为 true 时输入为空则禁用确定 */
  required?: boolean
}

interface PromptDialogState {
  visible: boolean
  title: string
  message: string
  defaultValue: string
  placeholder: string
  confirmText: string
  cancelText: string
  required: boolean
}

const dialogState = ref<PromptDialogState>({
  visible: false,
  title: '',
  message: '',
  defaultValue: '',
  placeholder: '',
  confirmText: '确定',
  cancelText: '取消',
  required: false,
})

let resolveCallback: ((value: string | null) => void) | null = null

export function usePromptDialog() {
  function prompt(message: string, defaultValue = '', options: PromptOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
      dialogState.value = {
        visible: true,
        message,
        defaultValue,
        placeholder: options.placeholder || '',
        title: options.title || '输入',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        required: options.required || false,
      }
      resolveCallback = resolve
    })
  }

  function handleConfirm(value: string): void {
    if (resolveCallback) {
      resolveCallback(value)
      reset()
    }
  }

  function handleCancel(): void {
    if (resolveCallback) {
      resolveCallback(null)
      reset()
    }
  }

  function reset(): void {
    dialogState.value.visible = false
    resolveCallback = null
  }

  return { dialogState, prompt, handleConfirm, handleCancel, reset }
}
