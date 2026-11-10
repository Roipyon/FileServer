/** 剪贴板条目（对应后端 clipboard.go 的 ClipItem） */
export interface ClipItem {
  id: string
  content: string
  deviceName: string
  timestamp: number
  size: number
  /** 客户端标记：新到的条目高亮用，非后端字段 */
  isNew?: boolean
}

const BASE = window.location.origin

async function readError(res: Response, fallback: string): Promise<Error> {
  try {
    const data = await res.json()
    return new Error(data.error || fallback)
  } catch {
    return new Error(fallback)
  }
}

export async function fetchClipboard(): Promise<ClipItem[]> {
  const res = await fetch(`${BASE}/api/clipboard`)
  if (!res.ok) throw await readError(res, `HTTP ${res.status}`)
  return res.json()
}

export async function sendClipboard(content: string, deviceName: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/api/clipboard/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, deviceName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '发送失败')
  return data
}

export async function deleteClipItem(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/api/clipboard/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '删除失败')
  return data
}

export async function clearClipboard(): Promise<{ success: boolean; deletedCount?: number }> {
  const res = await fetch(`${BASE}/api/clipboard`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '清空失败')
  return data
}
