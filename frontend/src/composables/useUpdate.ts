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
import { isAndroidUA } from '../utils/helpers.js'

const toast = useToast()

const state = reactive({
  /** 一键更新进行中的阶段：'' | 'check' | 'web' | 'server' | 'apk' | 'rollback' */
  phase: '',
  error: '',
  /** 在线检查不可用时的提示 */
  notice: '',
  available: null as UpdateManifest | null
})

/** 安卓壳层 WebView：整包走系统安装器，不做服务端自替换 */
const isAndroid = isAndroidUA()

/**
 * 软件更新：检查与应用分两步，中间让用户看过「更新内容」再决定。
 * 桌面 = 前端热更新 + 服务端自替换重启；安卓 = 前端热更新 + 拉起 APK 安装。
 */
export function useUpdate() {
  /** 第一步·检查：结果写入 state.available（含 release notes），有更新返回 true */
  async function checkUpdate(): Promise<boolean> {
    if (state.phase) return false
    state.phase = 'check'
    state.error = ''
    state.notice = ''
    try {
      const data = await fetchUpdateManifest()
      state.available = data.available
      state.notice = data.notice || ''
      if (!data.available) {
        toast.info(data.notice || '已是最新版本')
        return false
      }
      return true
    } catch (err) {
      state.error = err instanceof Error ? err.message : '检查更新失败'
      return false
    } finally {
      state.phase = ''
    }
  }

  /** 第二步·应用：消费 state.available 中已检查到的段（调用前应已获用户确认） */
  async function applyUpdate(currentVersion: string): Promise<void> {
    if (state.phase) return
    const a = state.available
    if (!a) return
    state.error = ''
    try {
      // 前端热更新：桌面与安卓通用
      if (a.web) {
        state.phase = 'web'
        await applyWebUpdate(a.web)
        toast.success(`前端已更新到 v${a.web.version}`)
      }

      // 桌面服务端：自替换并等待新版上线后刷新
      if (a.server && !isAndroid) {
        state.phase = 'server'
        toast.info(`服务端正在更新到 v${a.server.version}，等待重启…`)
        await applyServerUpdate(a.server)
        await waitServerRestart(currentVersion)
        toast.success(`服务端已更新到 v${a.server.version}`)
        window.location.reload()
        return
      }

      // 安卓整包：交给壳层下载并拉起系统安装器（安装需用户确认）
      if (a.android && isAndroid) {
        state.phase = 'apk'
        toast.info('安装包开始下载，请在系统安装器中确认')
        window.location.href = a.android.url
        return
      }

      // 仅前端更新：稍候刷新加载新版
      if (a.web) setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      state.error = err instanceof Error ? err.message : '更新失败'
    } finally {
      state.phase = ''
    }
  }

  /** 回退到内嵌前端并刷新 */
  async function rollback(): Promise<void> {
    if (state.phase) return
    state.phase = 'rollback'
    state.error = ''
    try {
      await rollbackWebUpdate()
      toast.info('已恢复内嵌版本，正在刷新…')
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      state.error = err instanceof Error ? err.message : '回退失败'
    } finally {
      state.phase = ''
    }
  }

  return { state, checkUpdate, applyUpdate, rollback }
}
