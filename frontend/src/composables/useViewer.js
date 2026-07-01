import { reactive } from 'vue'

const viewerState = reactive({
  visible: false,
  file: null,       // { name, size, modified, ... }
  mode: 'preview',  // 'preview' | 'edit'
  saving: false,    // 保存中标志
  saved: true       // 是否有未保存的修改
})

/**
 * 打开文件预览
 */
function openPreview(file) {
  viewerState.file = file
  viewerState.mode = 'preview'
  viewerState.visible = true
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 打开文件编辑
 */
function openEditor(file) {
  viewerState.file = file
  viewerState.mode = 'edit'
  viewerState.visible = true
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 关闭查看器
 * @returns {boolean} 是否可以关闭（有未保存修改时会返回 false，由调用方确认）
 */
function closeViewer() {
  viewerState.visible = false
  viewerState.file = null
  viewerState.mode = 'preview'
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 切换编辑/预览模式
 */
function toggleEditMode() {
  if (viewerState.mode === 'preview') {
    viewerState.mode = 'edit'
  } else {
    viewerState.mode = 'preview'
  }
}

/**
 * 标记为已修改（未保存）
 */
function markDirty() {
  viewerState.saved = false
}

/**
 * 标记为已保存
 */
function markSaved() {
  viewerState.saved = true
}

export function useViewer() {
  return {
    viewerState,
    openPreview,
    openEditor,
    closeViewer,
    toggleEditMode,
    markDirty,
    markSaved
  }
}
