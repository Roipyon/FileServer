import { ref } from 'vue'

const dialogState = ref({
  visible: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  thirdText: '',        // 可选第三按钮（如"保留两个"）
  checkboxLabel: '',    // 可选复选框（如"应用到全部"）
  checkboxChecked: false,
  variant: 'danger', // 'danger' | 'accent'
})

let resolveCallback = null

export function useConfirmDialog() {
  /**
   * @returns {Promise<boolean|'confirm'|'third'|'cancel'|{action:string,applyAll:boolean}>}
   *  - 无 thirdText：true/false（与旧版一致）
   *  - 有 thirdText：'confirm' | 'third' | 'cancel'
   *  - 有 checkboxLabel：{ action, applyAll }（action 取值同上或 boolean）
   */
  function confirm(message, options = {}) {
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

  function finish(action) {
    if (!resolveCallback) return
    const cb = resolveCallback
    resolveCallback = null
    dialogState.value.visible = false
    const { thirdText, checkboxLabel, checkboxChecked } = dialogState.value
    let result
    if (thirdText) {
      result = action // 'confirm' | 'third' | 'cancel'
    } else {
      result = action === 'confirm'
    }
    if (checkboxLabel) {
      const act = thirdText ? result : result === true ? 'confirm' : 'cancel'
      result = { action: act, applyAll: checkboxChecked }
    }
    cb(result)
  }

  function handleConfirm() {
    finish('confirm')
  }

  function handleThird() {
    finish('third')
  }

  function handleCancel() {
    finish('cancel')
  }

  function reset() {
    dialogState.value.visible = false
    resolveCallback = null
  }

  return { dialogState, confirm, handleConfirm, handleThird, handleCancel, reset }
}

export { dialogState }
