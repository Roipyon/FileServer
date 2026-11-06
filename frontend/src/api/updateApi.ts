/**
 * 软件自更新 API（方案 B/A/D 公共端点）
 *
 * 更新源约定：把 update-manifest.json 与更新包当普通文件上传到共享目录根部，
 * 服务端读取清单供各端比对；url 支持本机 /download/<文件名> 相对路径与 http(s) 外链。
 */

export interface UpdateSection {
  version: string
  url: string
  sha256: string
  versionCode?: number
  notes?: string
}

export interface UpdateManifest {
  web?: UpdateSection
  server?: UpdateSection
  android?: UpdateSection
}

export interface ServerVersions {
  urls: string[]
  publicUrl: string | null
  port: number
  uptime: number
  version: string
  webVersion: string
  webOverride: boolean
}

interface UpdateManifestResponse {
  current: {
    web: { version: string; override: boolean }
    server: { version: string }
  }
  available: UpdateManifest | null
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

/** 应用前端热更新（方案 B），成功后刷新页面即生效 */
export async function applyWebUpdate(sha256: string): Promise<{ success: boolean; version: string }> {
  const res = await fetch(`${window.location.origin}/api/update/apply/web`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256 })
  })
  if (!res.ok) throw await readError(res, '前端更新失败')
  return res.json()
}

/** 应用桌面端整包更新（方案 D）：服务端自替换并重启，期间会短暂断线 */
export async function applyServerUpdate(sha256: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${window.location.origin}/api/update/apply/server`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256 })
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
