const BASE = window.location.origin

export async function fetchFiles() {
  const res = await fetch(`${BASE}/api/files`)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const data = await res.json(); if (data.error) msg = data.error } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export async function deleteFile(name) {
  const res = await fetch(`${BASE}/api/delete/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `删除失败: ${res.status}`)
  return data
}

export function uploadChunk(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/upload-chunk`, true)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText)
          if (result.success) resolve(result)
          else reject(new Error(result.error || '分片上传失败'))
        } catch {
          reject(new Error('解析响应失败'))
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('网络错误')))
    xhr.addEventListener('abort', () => reject(new Error('上传取消')))
    xhr.send(formData)
  })
}

export async function mergeChunks(fileId, fileName, totalChunks) {
  const res = await fetch(`${BASE}/api/merge-chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, fileName, totalChunks })
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || '合并失败')
  }
  return res.json()
}

/**
 * 传统整文件上传（用于内网直接上传）
 * @param {FormData} formData - 包含 files 字段的 FormData
 * @param {function} onProgress - 进度回调 (loaded, total)
 * @returns {Promise<{message: string, results: Array}>}
 */
export function uploadFile(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/upload`, true)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText)
          resolve(result)
        } catch {
          reject(new Error('解析响应失败'))
        }
      } else {
        let msg = `HTTP ${xhr.status}`
        try {
          const err = JSON.parse(xhr.responseText)
          if (err.error) msg = err.error
        } catch {}
        reject(new Error(msg))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('网络错误')))
    xhr.addEventListener('abort', () => reject(new Error('上传取消')))
    xhr.send(formData)
  })
}

export function getDownloadUrl(name) {
  return `${BASE}/download/${encodeURIComponent(name)}`
}

export function getRawUrl(name) {
  return `${BASE}/api/raw/${encodeURIComponent(name)}`
}

// ==================== ZIP 批量下载 ====================

export async function startZipTask(files, zipName) {
  const res = await fetch(`${BASE}/api/download-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, zipName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '创建打包任务失败')
  return data
}

export async function getZipProgress(taskId) {
  const res = await fetch(`${BASE}/api/zip-progress/${encodeURIComponent(taskId)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '查询进度失败')
  return data
}

export function getZipDownloadUrl(taskId) {
  return `${BASE}/api/zip-download/${encodeURIComponent(taskId)}`
}

export async function cancelZipTask(taskId) {
  const res = await fetch(`${BASE}/api/zip-cancel/${encodeURIComponent(taskId)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '取消失败')
  return data
}

export async function renameFile(oldName, newName) {
  const res = await fetch(`${BASE}/api/files/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `重命名失败: ${res.status}`)
  return data
}

export async function saveFile(name, content) {
  const res = await fetch(`${BASE}/api/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `保存失败: ${res.status}`)
  return data
}

// ==================== 缩略图/摘要 ====================

/**
 * 获取文件的缩略图/摘要信息
 * @param {string} name - 文件名
 * @returns {Promise<{type: string, data: any}>}
 */
export async function fetchThumbnail(name) {
  const res = await fetch(`${BASE}/api/thumbnail/${encodeURIComponent(name)}`)
  if (!res.ok) return null
  return res.json()
}

// ==================== 分享链接 ====================

/**
 * 生成文件分享链接
 * @param {string} file - 文件名
 * @param {'once'|'persistent'} mode - 一次性/持续有效
 * @returns {Promise<{token: string, url: string, file: string, mode: string}>}
 */
export async function generateShareLink(file, mode = 'once') {
  const res = await fetch(`${BASE}/api/share/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, mode })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '生成分享链接失败')
  return data
}

/**
 * 获取分享链接的完整访问 URL
 * @param {string} token
 * @returns {string}
 */
export function getShareUrl(token) {
  return `${BASE}/api/share/${encodeURIComponent(token)}`
}

// ==================== 单向上传链接 ====================

/**
 * 生成单向上传链接（服务端）
 * @returns {Promise<{token: string, url: string, expiresAt: number}>}
 */
export async function generateUploadToken() {
  const res = await fetch(`${BASE}/api/upload-token/generate`, {
    method: 'POST'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '生成上传链接失败')
  return data
}
