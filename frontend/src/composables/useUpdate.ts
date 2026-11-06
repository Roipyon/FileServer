import { reactive } from 'vue'
import {
  fetchUpdateManifest,
  applyWebUpdate,
  applyServerUpdate,
  rollbackWebUpdate,
  waitServerRestart,
  type UpdateManifest
} from '../api/updateApi'
import { useToast } from './useToast'

const toast = useToast()

const state = reactive({
  checking: false,
  checked: false,
  /** 正在应用的段名：'' | 'web' | 'server' | 'rollback' */
  applying: '',
  error: '',
  available: null as UpdateManifest | null
})

/**
 * 软件更新面板状态：检查 / 应用（前端热更新、桌面自替换）/ 回退。
 * 安卓整包不走此处的「更新」，由 <a download> 交给壳层安装器。
 */
export function useUpdate() {
  async function check(): Promise<void> {
    state.checking = true
    state.error = ''
    try {
      const data = await fetchUpdateManifest()
      state.available = data.available
      state.checked = true
      if (!data.available) toast.info('共享目录未发现更新清单（update-manifest.json）')
    } catch (err) {
      state.error = err instanceof Error ? err.message : '检查更新失败'
    } finally {
      state.checking = false
    }
  }

  /** 前端热更新：成功后自动刷新页面加载新版静态资源 */
  async function applyWeb(): Promise<void> {
    const sec = state.available?.web
    if (!sec || state.applying) return
    state.applying = 'web'
    state.error = ''
    try {
      await applyWebUpdate(sec.sha256)
      toast.success(`前端已更新到 v${sec.version}，正在刷新…`)
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      state.error = err instanceof Error ? err.message : '前端更新失败'
    } finally {
      state.applying = ''
    }
  }

  /** 桌面端自替换：轮询确认新版本上线后刷新连接信息 */
  async function applyServer(currentVersion: string): Promise<void> {
    const sec = state.available?.server
    if (!sec || state.applying) return
    state.applying = 'server'
    state.error = ''
    try {
      await applyServerUpdate(sec.sha256)
      toast.info(`服务端正在重启，等待 v${sec.version} 上线…`)
      await waitServerRestart(currentVersion)
      toast.success(`服务端已更新到 v${sec.version}`)
      window.location.reload()
    } catch (err) {
      state.error = err instanceof Error ? err.message : '服务端更新失败'
    } finally {
      state.applying = ''
    }
  }

  /** 回退到内嵌前端并刷新 */
  async function rollback(): Promise<void> {
    if (state.applying) return
    state.applying = 'rollback'
    state.error = ''
    try {
      await rollbackWebUpdate()
      toast.info('已恢复内嵌版本，正在刷新…')
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      state.error = err instanceof Error ? err.message : '回退失败'
    } finally {
      state.applying = ''
    }
  }

  return { state, check, applyWeb, applyServer, rollback }
}
