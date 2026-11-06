/** 文件列表条目（对应后端 handleFileList 输出） */
export interface FileEntry {
  name: string
  /** 后端格式化好的大小文本 */
  size: string
  sizeInBytes: number
  modified: string
  mtimeMs: number
  downloadUrl: string
}

export interface UploadResult {
  message?: string
  results: Array<{ success: boolean; name?: string; error?: string }>
}

export interface MergeChunksResult {
  success: boolean
  name?: string
  error?: string
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

export async function fetchFiles(): Promise<FileEntry[]> {
  const res = await fetch(`${BASE}/api/files`)
  if (!res.ok) throw await readError(res, `HTTP ${res.status}`)
  return res.json()
}

export async function deleteFile(name: string): Promise<{ success?: boolean }> {
  const res = await fetch(`${BASE}/api/delete/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `删除失败: ${res.status}`)
  return data
}

export function uploadChunk(
  formData: FormData,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ success: boolean }> {
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

export async function mergeChunks(
  fileId: string,
  fileName: string,
  totalChunks: number,
  overwrite = false
): Promise<MergeChunksResult> {
  const res = await fetch(`${BASE}/api/merge-chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, fileName, totalChunks, overwrite: !!overwrite })
  })
  if (!res.ok) throw await readError(res, '合并失败')
  return res.json()
}

/**
 * 传统整文件上传（用于内网直接上传）
 */
export function uploadFile(
  formData: FormData,
  onProgress?: (loaded: number, total: number) => void
): Promise<UploadResult> {
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
          const result: UploadResult = JSON.parse(xhr.responseText)
          resolve(result)
        } catch {
          reject(new Error('解析响应失败'))
        }
      } else {
        let msg = `HTTP ${xhr.status}`
        try {
          const err = JSON.parse(xhr.responseText)
          if (err.error) msg = err.error
        } catch {
          // 保留默认 HTTP 状态消息
        }
        reject(new Error(msg))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('网络错误')))
    xhr.addEventListener('abort', () => reject(new Error('上传取消')))
    xhr.send(formData)
  })
}

export function getDownloadUrl(name: string): string {
  return `${BASE}/download/${encodeURIComponent(name)}`
}

export function getRawUrl(name: string): string {
  return `${BASE}/api/raw/${encodeURIComponent(name)}`
}

// ==================== ZIP 批量下载 ====================

export async function startZipTask(files: string[], zipName: string): Promise<{ taskId: string }> {
  const res = await fetch(`${BASE}/api/download-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, zipName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '创建打包任务失败')
  return data
}

export async function getZipProgress(
  taskId: string
): Promise<{ state: string; percent?: number; processedFiles?: number; totalFiles?: number; currentFile?: string; err?: string }> {
  const res = await fetch(`${BASE}/api/zip-progress/${encodeURIComponent(taskId)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '查询进度失败')
  return data
}

export function getZipDownloadUrl(taskId: string): string {
  return `${BASE}/api/zip-download/${encodeURIComponent(taskId)}`
}

export async function cancelZipTask(taskId: string): Promise<{ success?: boolean }> {
  const res = await fetch(`${BASE}/api/zip-cancel/${encodeURIComponent(taskId)}`, {
    method: 'DELETE'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '取消失败')
  return data
}

export async function renameFile(oldName: string, newName: string): Promise<{ success?: boolean }> {
  const res = await fetch(`${BASE}/api/files/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `重命名失败: ${res.status}`)
  return data
}

export async function saveFile(name: string, content: string): Promise<{ success?: boolean }> {
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
 */
export async function fetchThumbnail(
  name: string
): Promise<{ type: string; data: unknown } | null> {
  const res = await fetch(`${BASE}/api/thumbnail/${encodeURIComponent(name)}`)
  if (!res.ok) return null
  return res.json()
}

// ==================== 分享链接 ====================

/**
 * 生成文件分享链接
 */
export async function generateShareLink(
  file: string,
  mode: 'once' | 'persistent' = 'once'
): Promise<{ token: string; url: string; file: string; mode: string }> {
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
 */
export function getShareUrl(token: string): string {
  return `${BASE}/api/share/${encodeURIComponent(token)}`
}

// ==================== 单向上传链接 ====================

/**
 * 生成单向上传链接（服务端）
 */
export async function generateUploadToken(): Promise<{ token: string; url: string; expiresAt: number }> {
  const res = await fetch(`${BASE}/api/upload-token/generate`, {
    method: 'POST'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '生成上传链接失败')
  return data
}
