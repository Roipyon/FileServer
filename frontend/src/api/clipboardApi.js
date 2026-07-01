const BASE = window.location.origin

export async function fetchClipboard() {
  const res = await fetch(`${BASE}/api/clipboard`)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const data = await res.json(); if (data.error) msg = data.error } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export async function sendClipboard(content, deviceName) {
  const res = await fetch(`${BASE}/api/clipboard/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, deviceName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '发送失败')
  return data
}

export async function deleteClipItem(id) {
  const res = await fetch(`${BASE}/api/clipboard/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '删除失败')
  return data
}

export async function clearClipboard() {
  const res = await fetch(`${BASE}/api/clipboard`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '清空失败')
  return data
}
