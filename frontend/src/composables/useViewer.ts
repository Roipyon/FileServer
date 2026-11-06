import { reactive } from 'vue'

/** 文件条目的最小查看器视图（来自文件列表项） */
export interface ViewerFile {
  name: string
  size: number
  modified: string
  [key: string]: unknown
}

interface ViewerState {
  visible: boolean
  file: ViewerFile | null
  mode: 'preview' | 'edit'
  saving: boolean
  saved: boolean
}

const viewerState = reactive<ViewerState>({
  visible: false,
  file: null,
  mode: 'preview',
  saving: false,
  saved: true
})

/**
 * 打开文件预览
 */
function openPreview(file: ViewerFile): void {
  viewerState.file = file
  viewerState.mode = 'preview'
  viewerState.visible = true
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 打开文件编辑
 */
function openEditor(file: ViewerFile): void {
  viewerState.file = file
  viewerState.mode = 'edit'
  viewerState.visible = true
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 关闭查看器（有未保存修改时由调用方先确认）
 */
function closeViewer(): void {
  viewerState.visible = false
  viewerState.file = null
  viewerState.mode = 'preview'
  viewerState.saving = false
  viewerState.saved = true
}

/**
 * 切换编辑/预览模式
 */
function toggleEditMode(): void {
  viewerState.mode = viewerState.mode === 'preview' ? 'edit' : 'preview'
}

/**
 * 标记为已修改（未保存）
 */
function markDirty(): void {
  viewerState.saved = false
}

/**
 * 标记为已保存
 */
function markSaved(): void {
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
