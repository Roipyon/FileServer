import { reactive } from 'vue'
import QRCode from 'qrcode'
import { copyToClipboard } from '../utils/clipboard.js'
import { useToast } from './useToast'

const toast = useToast()

/** /api/server-info 返回的版本字段（软件更新卡片用） */
interface ServerInfoData {
  hostname?: string
  urls?: string[]
  publicUrl?: string | null
  port?: number
  version?: string
  webVersion?: string
  webOverride?: boolean
}

const state = reactive({
  hostname: '',
  urls: [] as string[],
  publicUrl: null as string | null,
  port: 0,
  serverVersion: '',
  webVersion: '',
  webOverride: false,
  loading: false,
  error: null as string | null
})

let dataPromise: Promise<ServerInfoData> | null = null  // 缓存解析后的数据 promise

async function fetchInfo(forceRefresh = false): Promise<void> {
  state.loading = true
  state.error = null

  // 如果未缓存或强制刷新，或上一次请求已失败（dataPromise 为 reject 状态）
  if (!dataPromise || forceRefresh) {
    dataPromise = fetch(`${window.location.origin}/api/server-info`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: ServerInfoData = await res.json()  // 只读取一次
        return data
      })
      .catch((err) => {
        // 失败时清空缓存，让下次调用能重新请求
        dataPromise = null
        throw err
      })
  }

  try {
    const data = await dataPromise

    state.hostname = data.hostname || ''
    state.urls = data.urls || []
    state.publicUrl = data.publicUrl || null
    state.port = data.port || 0
    state.serverVersion = data.version || ''
    state.webVersion = data.webVersion || ''
    state.webOverride = !!data.webOverride
  } catch (err) {
    toast.error(`获取服务器信息失败: ${err instanceof Error ? err.message : String(err)}`)
    state.error = (err instanceof Error ? err.message : String(err)) || '获取连接信息失败'
    // 如果 dataPromise 还没被清理（catch 已经清理），再确保一次
    dataPromise = null
  } finally {
    state.loading = false
  }
}

/**
 * 客户端生成二维码 data URL（使用 qrcode 库）
 */
async function generateQR(url: string, width = 200): Promise<string | null> {
  if (!url) return null
  try {
    return await QRCode.toDataURL(url, { width, margin: 1 })
  } catch (err) {
    toast.error(`生成二维码失败: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function collapse(): void {
  // no-op, kept for API compatibility
}

function resetCache(): void {
  dataPromise = null
}

/**
 * 复制文本到剪贴板（委托给公共工具函数）
 */
async function copyUrl(url: string): Promise<boolean> {
  return await copyToClipboard(url)
}

export function useServerInfo() {
  return {
    state,
    fetchInfo,
    generateQR,
    collapse,
    copyUrl,
    resetCache
  }
}
