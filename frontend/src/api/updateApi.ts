/**
 * 软件自更新 API（方案 B/A/D 公共端点）
 *
 * 更新源：GitHub Releases 最新发布，服务端按资产命名约定映射出各段供比对。
 */

export interface UpdateSection {
  version: string
  url: string
  sha256: string
}

export interface UpdateManifest {
  web?: UpdateSection
  server?: UpdateSection
  android?: UpdateSection
  /** release 说明（发版 body，markdown 纯文本子集），有可用更新时随清单下发 */
  notes?: string
}

export interface ServerVersions {
  urls: string[]
  publicUrl: string | null
  port: number
  uptime: number
  version: string
  webOverride: boolean
}

interface UpdateManifestResponse {
  current: {
    web: { version: string; override: boolean }
    server: { version: string }
  }
  available: UpdateManifest | null
  /** 在线检查不可用时的提示 */
  notice?: string
}

async function readError(res: Response, fallback: string): Promise<Error> {
  try {
    const data = await res.json()
    return new Error(data.error || fallback)
  } catch {
    return new Error(fallback)
  }
}

/** 当前版本与可用更新；无清单时 available 为 null */
export async function fetchUpdateManifest(): Promise<UpdateManifestResponse> {
  const res = await fetch(`${window.location.origin}/api/update/manifest`)
  if (!res.ok) throw await readError(res, `检查更新失败: ${res.status}`)
  return res.json()
}

/** 应用前端热更新（方案 B），成功后刷新页面即生效；段信息来自检查结果 */
export async function applyWebUpdate(sec: UpdateSection): Promise<{ success: boolean; version: string }> {
  const res = await fetch(`${window.location.origin}/api/update/apply/web`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sec)
  })
  if (!res.ok) throw await readError(res, '前端更新失败')
  return res.json()
}

/** 应用桌面端整包更新（方案 D）：服务端自替换并重启，期间会短暂断线 */
export async function applyServerUpdate(sec: UpdateSection): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${window.location.origin}/api/update/apply/server`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sec)
  })
  if (!res.ok) throw await readError(res, '服务端更新失败')
  return res.json()
}

/** 删除磁盘前端层，回到编译期内嵌版本 */
export async function rollbackWebUpdate(): Promise<{ success: boolean; version: string }> {
  const res = await fetch(`${window.location.origin}/api/update/rollback/web`, { method: 'POST' })
  if (!res.ok) throw await readError(res, '回退失败')
  return res.json()
}

/** 等待服务端重启完成并返回新版本号；超时抛错（实际可能已成功） */
export async function waitServerRestart(
  oldVersion: string,
  timeoutMs = 20000,
  intervalMs = 800
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const res = await fetch(`${window.location.origin}/api/server-info`)
      if (res.ok) {
        const data: ServerVersions = await res.json()
        if (data.version !== oldVersion) return data.version
      }
    } catch {
      // 重启窗口期连不上属预期，继续轮询
    }
  }
  throw new Error('等待重启超时，请稍后手动刷新确认')
}
