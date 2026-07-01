import { reactive } from 'vue'
import {
  fetchClipboard,
  sendClipboard as apiSendClipboard,
  deleteClipItem as apiDeleteClipItem,
  clearClipboard as apiClearClipboard
} from '../api/clipboardApi.js'
import { copyToClipboard } from '../utils/clipboard.js'
import { useToast } from './useToast.js'

const toast = useToast()

const state = reactive({
  items: [],
  loading: false,
  connected: false,
  deviceName: '',
  polling: false,
  lastFetch: null
})

let pollTimer = null
let visibilityHandler = null

// 已有的条目 ID 集合，用于检测新增项
let knownIds = new Set()

function getStoredDeviceName() {
  try {
    const stored = localStorage.getItem('clipboard_deviceName')
    if (stored) return stored
  } catch (e) { /* localStorage 不可用 */ }
  return ''
}

function generateDeviceName() {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'Windows 电脑'
  if (ua.includes('Mac OS')) return 'Mac 电脑'
  if (ua.includes('Linux')) return 'Linux 电脑'
  if (ua.includes('Android')) return 'Android 设备'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS 设备'
  return '未知设备'
}

async function loadItems() {
  try {
    const items = await fetchClipboard()

    // 检测新增项（首次加载不标记为新）
    const isFirstLoad = knownIds.size === 0
    const currentIds = new Set(items.map(i => i.id))
    items.forEach(item => {
      item.isNew = !isFirstLoad && !knownIds.has(item.id)
    })
    knownIds = currentIds

    state.items = items
    state.connected = true
    state.lastFetch = Date.now()
  } catch (err) {
    toast.error('加载剪贴板失败:', err)
    state.connected = false
  }
}

async function sendContent(text) {
  if (!text || !text.trim()) return false
  try {
    await apiSendClipboard(text.trim(), state.deviceName)
    // 立即刷新列表
    await loadItems()
    return true
  } catch (err) {
    toast.error('发送剪贴板内容失败:', err)
    throw err
  }
}

async function copyToSystem(item) {
  return await copyToClipboard(item.content)
}

async function deleteItem(id) {
  if (!id) return
  try {
    await apiDeleteClipItem(id)
    knownIds.delete(id)
    state.items = state.items.filter(item => item.id !== id)
  } catch (err) {
    toast.error('删除剪贴板条目失败:', err)
    throw err
  }
}

async function clearAll() {
  try {
    await apiClearClipboard()
    knownIds.clear()
    state.items = []
  } catch (err) {
    toast.error('清空剪贴板失败:', err)
    throw err
  }
}

function setDeviceName(name) {
  const trimmed = name.trim()
  if (!trimmed) return
  state.deviceName = trimmed
  try {
    localStorage.setItem('clipboard_deviceName', trimmed)
  } catch (e) { /* localStorage 不可用 */ }
}

function getDeviceName() {
  if (!state.deviceName) {
    state.deviceName = getStoredDeviceName() || generateDeviceName()
  }
  return state.deviceName
}

function startPolling() {
  if (state.polling) return

  // 初始化设备名
  getDeviceName()

  // 立即加载一次
  state.loading = true
  loadItems().finally(() => {
    state.loading = false
  })

  // 每 3 秒轮询
  pollTimer = setInterval(() => {
    loadItems()
  }, 3000)

  // 页面可见性变化时暂停/恢复轮询
  visibilityHandler = () => {
    if (document.hidden) {
      // 页面隐藏时延长轮询间隔
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = setInterval(() => loadItems(), 10000)
      }
    } else {
      // 页面可见时恢复 3 秒轮询并立即刷新
      if (pollTimer) clearInterval(pollTimer)
      loadItems()
      pollTimer = setInterval(() => loadItems(), 3000)
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  state.polling = true
}

function stopPolling() {
  state.polling = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  // 不清理 knownIds：保留已知条目，下次打开时不会全部标记为"新"
}

export function useClipboard() {
  return {
    state,
    loadItems,
    sendContent,
    copyToSystem,
    deleteItem,
    clearAll,
    setDeviceName,
    getDeviceName,
    startPolling,
    stopPolling
  }
}
