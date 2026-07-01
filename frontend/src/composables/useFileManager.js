import { reactive, computed, ref, onMounted, onUnmounted } from 'vue'
import {
  fetchFiles, deleteFile as apiDeleteFile, getDownloadUrl, renameFile as apiRenameFile
} from '../api/fileApi.js'
import { formatFileSize, parseFileSize, debounce } from '../utils/helpers.js'
import { useToast } from './useToast.js'
import { useConfirmDialog } from './useConfirmDialog.js'

// 模块级 ref（用于滑动选择跨组件同步）
const slideSelecting = ref(false)
const slideStartFile = ref(null)

const { confirm } = useConfirmDialog()
const toast = useToast()

const state = reactive({
  files: [],
  filteredFiles: [],
  currentView: 'grid',
  sortField: 'name',
  sortDirection: 'asc',
  searchQuery: '',
  currentSection: 'files',
  loading: false,
  connected: false,
  serverInfo: '等待连接...',
  selectionMode: false,
  selectedFiles: new Set(),
  highlightedFiles: new Set()
})

const SORT_OPTIONS = [
  { field: 'name', label: '名称' },
  { field: 'size', label: '大小' },
  { field: 'modified', label: '修改时间' },
  { field: 'mtime', label: '修改时间（精确）' },
]

let lastFileHash = ''
let version = 0

function filterAndSort() {
  let list = [...state.files]

  const term = state.searchQuery.toLowerCase().trim()
  if (term) {
    list = list.filter((f) => f.name.toLowerCase().includes(term))
  }

  list.sort((a, b) => {
    let cmp = 0
    if (state.sortField === 'size') {
      const aVal = a.sizeInBytes || parseFileSize(a.size)
      const bVal = b.sizeInBytes || parseFileSize(b.size)
      cmp = aVal - bVal
    } else if (state.sortField === 'modified' || state.sortField === 'mtime') {
      // mtimeMs 优先，降级到 modified 字符串
      const aVal = a.mtimeMs != null ? a.mtimeMs : new Date(a.modified).getTime()
      const bVal = b.mtimeMs != null ? b.mtimeMs : new Date(b.modified).getTime()
      cmp = aVal - bVal
    } else {
      const aVal = (a.name || '').toLowerCase()
      const bVal = (b.name || '').toLowerCase()
      cmp = aVal.localeCompare(bVal, 'zh-CN')
    }
    return state.sortDirection === 'asc' ? cmp : -cmp
  })

  // 标记高亮文件（新上传的）
  if (state.highlightedFiles.size > 0) {
    list = list.map(f => ({
      ...f,
      isNew: state.highlightedFiles.has(f.name)
    }))
  } else {
    list = list.map(f => ({ ...f, isNew: false }))
  }

  state.filteredFiles = list
}

const totalFiles = computed(() => state.filteredFiles.length)
const totalSize = computed(() => {
  return formatFileSize(
    state.filteredFiles.reduce((sum, f) => sum + (f.sizeInBytes || parseFileSize(f.size)), 0)
  )
})
const lastUpdate = computed(() => {
  if (state.filteredFiles.length === 0) return '-'
  const latest = state.filteredFiles.reduce((a, b) =>
    new Date(a.modified) > new Date(b.modified) ? a : b
  )
  return new Date(latest.modified).toLocaleDateString('zh-CN')
})
const fileTypes = computed(() => {
  const types = {}
  state.files.forEach((f) => {
    const ext = f.name.split('.').pop().toLowerCase()
    types[ext] = (types[ext] || 0) + 1
  })
  return types
})
const topFileTypes = computed(() => {
  return Object.entries(fileTypes.value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
})
const recentFiles = computed(() => {
  return [...state.files]
    .sort((a, b) => {
      const aVal = a.mtimeMs != null ? a.mtimeMs : new Date(a.modified).getTime()
      const bVal = b.mtimeMs != null ? b.mtimeMs : new Date(b.modified).getTime()
      return bVal - aVal
    })
    .slice(0, 10)
})

function setSort(field) {
  if (state.sortField === field) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc'
  } else {
    state.sortField = field
    state.sortDirection = field === 'mtime' ? 'desc' : 'asc' // mtime 默认倒序
  }
  filterAndSort()
}

// 计算文件列表哈希
function getFileHash(files) {
  return files.map(f => `${f.name}|${f.size}|${f.mtime}`).join('|')
}

// 轮询专用静默更新
async function updateFilesSilently() {
  try {
    const data = await fetchFiles()
    const newHash = getFileHash(data)
    if (newHash !== lastFileHash) {
      state.files = data
      filterAndSort()
      lastFileHash = newHash
    }
    state.connected = true
  } catch (err) {
    state.connected = false
    // 静默失败，不弹 toast
  }
}

async function loadFiles() {
  version++
  const currentVersion = version
  state.loading = true
  try {
    const data = await fetchFiles()
    if (currentVersion !== version) {
      // 有新请求，丢弃旧结果
      state.loading = false
      return
    }
    state.files = data
    lastFileHash = getFileHash(data)
    state.connected = true
    state.serverInfo = `已连接 - ${new Date().toLocaleTimeString('zh-CN')}`
    filterAndSort()
  } catch (err) {
    if (currentVersion === version) {
      state.connected = false
      state.serverInfo = '连接服务器失败'
      toast.error('加载文件失败:', err)
    }
  } finally {
    if (currentVersion === version) {
      state.loading = false
    }
  }
}

function setSearch(query) {
  state.searchQuery = query
  filterAndSort()
}

function setView(view) {
  state.currentView = view
}

function setSection(section) {
  if (section !== 'files' && state.selectionMode) {
    clearSelection()
  }
  state.currentSection = section
}

async function deleteFile(filename) {
  if (!filename) return
  const ok = await confirm(`确定要删除文件\n"${filename}"\n吗？此操作不可撤销。`, {
    title: '确认删除',
    confirmText: '删除',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await apiDeleteFile(filename)
    await loadFiles()
  } catch (err) {
    toast.error(`删除失败: ${err.message}`)
  }
}

let refreshTimer = null
let isPollingActive = false

function startAutoRefresh(interval = 5000) {
  if (refreshTimer) return

  // 首次加载用 loadFiles（有 loading）
  loadFiles()

  refreshTimer = setInterval(() => {
    if (state.currentSection === 'files' && !document.hidden) {
      updateFilesSilently()  // 静默更新
    }
  }, interval)

  isPollingActive = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    // 页面隐藏，停止轮询
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  } else {
    // 页面切回，立即刷新并重新启动轮询
    if (isPollingActive && state.currentSection === 'files') {
      updateFilesSilently()
      refreshTimer = setInterval(() => {
        if (state.currentSection === 'files' && !document.hidden) {
          updateFilesSilently()
        }
      }, 5000)
    }
  }
}

function refreshAndResetTimer() {
  loadFiles()  // 操作后刷新，有 loading 反馈
  if (!refreshTimer) {
    // 轮询没启动，启动它
    startAutoRefresh(5000)
    return
  }
  clearInterval(refreshTimer)
  refreshTimer = setInterval(() => {
    if (state.currentSection === 'files' && !document.hidden) {
      updateFilesSilently()
    }
  }, 5000)
}

const debouncedSearch = debounce((q) => {
  state.searchQuery = q
  filterAndSort()
}, 250)

// ==================== 批量选择 ====================
function toggleSelect(filename) {
  if (state.selectedFiles.has(filename)) {
    state.selectedFiles.delete(filename)
    if (state.selectedFiles.size === 0) state.selectionMode = false
  } else {
    state.selectedFiles.add(filename)
    state.selectionMode = true
  }
}

/**
 * 点击文件卡片主体区域选择/取消（忽略按钮区域）
 * 在选择模式下使用，非选择模式跳过
 */
function cardClickSelect(filename, event) {
  if (!state.selectionMode) return
  // 忽略按钮区域
  const actionArea = event.target.closest(
    '.card-action-btn, .row-action-btn, .card-expand-wrap, .list-expand-wrap, ' +
    '.file-card-actions, .cell-actions, .file-card-check, .card-action-dl'
  )
  if (actionArea) return
  toggleSelect(filename)
}

// ==================== 滑动批量选择 ====================

/**
 * 开始滑动选择
 */
function startSlideSelect(filename, event) {
  if (!state.selectionMode) return
  // 忽略按钮区域
  const actionArea = event.target.closest(
    '.card-action-btn, .row-action-btn, .card-expand-wrap, .list-expand-wrap, ' +
    '.file-card-actions, .cell-actions, .file-card-check'
  )
  if (actionArea) return

  slideSelecting.value = true
  slideStartFile.value = filename

  // 初始点击切换当前文件选择状态
  // 如果已选中则取消，否则选中
  if (state.selectedFiles.has(filename)) {
    state.selectedFiles.delete(filename)
  } else {
    state.selectedFiles.add(filename)
  }
  state.selectionMode = true
}

/**
 * 滑动过程中选择经过的文件
 */
function updateSlideSelect(filename, event) {
  if (!slideSelecting.value || !state.selectionMode) return
  if (!filename) return

  // 忽略按钮区域，但只在 mousedown 时检查
  // 滑动过程中不检查，让滑动手感流畅

  // 如果当前文件还未被选中，则选中它
  if (!state.selectedFiles.has(filename)) {
    state.selectedFiles.add(filename)
  }
}

/**
 * 结束滑动选择
 */
function endSlideSelect() {
  if (!slideSelecting.value) return
  slideSelecting.value = false
  slideStartFile.value = null
}

function toggleSelectionMode() {
  if (state.selectionMode) {
    clearSelection()
  } else {
    state.selectionMode = true
  }
}

function selectAll() {
  state.filteredFiles.forEach(f => state.selectedFiles.add(f.name))
  state.selectionMode = true
}

function clearSelection() {
  state.selectedFiles.clear()
  state.selectionMode = false
}

async function batchDelete() {
  const files = [...state.selectedFiles]
  if (files.length === 0) return
  const ok = await confirm(`确定要删除选中的 ${files.length} 个文件吗？此操作不可撤销。`, {
    title: '确认批量删除',
    confirmText: '全部删除',
    variant: 'danger'
  })
  if (!ok) return

  let successCount = 0
  let failCount = 0
  const failedNames = []

  for (const name of files) {
    try {
      await apiDeleteFile(name)
      successCount++
    } catch (err) {
      toast.error(`删除 ${name} 失败:`, err)
      failCount++
      failedNames.push(name)
    }
  }

  clearSelection()
  await loadFiles()

  if (failCount > 0) {
    toast.warning(`删除完成：${successCount} 个成功，${failCount} 个失败`)
    failedNames.forEach(name => toast.error(`删除失败: ${name}`, { duration: 4000 }))
  }
}

// ==================== 高亮新文件 ====================
let highlightTimer = null

function highlightFile(names) {
  names.forEach(n => state.highlightedFiles.add(n))
  filterAndSort()

  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    clearHighlights()
  }, 1500)
}

function clearHighlights() {
  state.highlightedFiles.clear()
  filterAndSort()
  highlightTimer = null
}

// ==================== 文件重命名 ====================
async function renameFile(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return null
  try {
    const result = await apiRenameFile(oldName, newName)
    await loadFiles()
    highlightFile([newName])
    return result
  } catch (err) {
    toast.error('重命名失败:', err)
    throw err
  }
}

export function useFileManager() {
  return {
    state,
    totalFiles,
    totalSize,
    lastUpdate,
    fileTypes,
    topFileTypes,
    recentFiles,
    SORT_OPTIONS,
    loadFiles,
    setSearch,
    setSort,
    setView,
    setSection,
    deleteFile,
    getDownloadUrl,
    debouncedSearch,
    startAutoRefresh,
    stopAutoRefresh,
    refreshAndResetTimer,
    toggleSelectionMode,
    toggleSelect,
    selectAll,
    clearSelection,
    batchDelete,
    highlightFile,
    clearHighlights,
    renameFile,
    // 批量选择增强
    cardClickSelect,
    startSlideSelect,
    updateSlideSelect,
    endSlideSelect,
    slideSelecting,
  }
}
