export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function parseFileSize(sizeStr) {
  if (typeof sizeStr === 'number') return sizeStr
  const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }
  const match = String(sizeStr).match(/^([\d.]+)\s*([KMG]?B)$/i)
  if (match) {
    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    return value * (units[unit] || 1)
  }
  return 0
}

export function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const iconMap = {
    pdf: 'fas fa-file-pdf',
    doc: 'fas fa-file-word',
    docx: 'fas fa-file-word',
    xls: 'fas fa-file-excel',
    xlsx: 'fas fa-file-excel',
    ppt: 'fas fa-file-powerpoint',
    pptx: 'fas fa-file-powerpoint',
    zip: 'fas fa-file-archive',
    rar: 'fas fa-file-archive',
    '7z': 'fas fa-file-archive',
    jpg: 'fas fa-file-image',
    jpeg: 'fas fa-file-image',
    png: 'fas fa-file-image',
    gif: 'fas fa-file-image',
    bmp: 'fas fa-file-image',
    svg: 'fas fa-file-image',
    mp4: 'fas fa-file-video',
    avi: 'fas fa-file-video',
    mkv: 'fas fa-file-video',
    mp3: 'fas fa-file-audio',
    wav: 'fas fa-file-audio',
    flac: 'fas fa-file-audio',
    txt: 'fas fa-file-alt',
    csv: 'fas fa-file-csv',
    exe: 'fa-brands fa-windows',
    msi: 'fa-brands fa-windows',
    apk: 'fa-brands fa-android',
    md: 'fa-brands fa-markdown',
    app: 'fa-brands fa-apple',
    ipa: 'fa-brands fa-apple',
    out: 'fa-brands fa-linux',
    iso: 'fa-solid fa-compact-disc',
    img: 'fa-solid fa-compact-disc',
  }
  return iconMap[ext] || 'fas fa-file'
}

export function formatRelativeTime(timestamp) {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

export function debounce(fn, delay = 300) {
  let timer
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

/**
 * 剪贴板条目时间线分组
 * 分组层级：今天 → 昨天 → 本周 → 上周 → 更早（或按月拆分）
 * @param {Array<{timestamp: number}>} items
 * @returns {Array<{key: string, label: string, items: Array}>}
 */
export function groupItemsByTime(items) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const date = now.getDate()

  const todayStart = new Date(year, month, date, 0, 0, 0, 0).getTime()
  const yesterdayEnd = todayStart - 1
  const yesterdayStart = todayStart - 86400000

  // 本周一 00:00
  const dayOfWeek = now.getDay()
  // 将周日（0）视为 7，周一为 1
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const thisMonday = new Date(year, month, date - mondayOffset, 0, 0, 0, 0).getTime()

  // 上周一 00:00
  const lastMonday = thisMonday - 7 * 86400000
  // 上周日 23:59:59.999
  const lastSunday = thisMonday - 1

  const groups = {
    today: { key: 'today', label: '今天', items: [] },
    yesterday: { key: 'yesterday', label: '昨天', items: [] },
    thisWeek: { key: 'thisWeek', label: '本周', items: [] },
    lastWeek: { key: 'lastWeek', label: '上周', items: [] },
    earlier: { key: 'earlier', label: '更早', items: [] }
  }

  const earlierItems = []

  for (const item of items) {
    const ts = item.timestamp
    if (ts >= todayStart) {
      groups.today.items.push(item)
    } else if (ts >= yesterdayStart && ts <= yesterdayEnd) {
      groups.yesterday.items.push(item)
    } else if (ts >= thisMonday) {
      groups.thisWeek.items.push(item)
    } else if (ts >= lastMonday && ts <= lastSunday) {
      groups.lastWeek.items.push(item)
    } else {
      earlierItems.push(item)
    }
  }

  // 构建结果：保证顺序
  const result = []
  if (groups.today.items.length) result.push(groups.today)
  if (groups.yesterday.items.length) result.push(groups.yesterday)
  if (groups.thisWeek.items.length) result.push(groups.thisWeek)
  if (groups.lastWeek.items.length) result.push(groups.lastWeek)

  // 处理"更早"分组：超过 20 条则按月拆分
  if (earlierItems.length > 20) {
    const monthMap = new Map()
    for (const item of earlierItems) {
      const d = new Date(item.timestamp)
      const key = `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!monthMap.has(key)) {
        monthMap.set(key, {
          key,
          label: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`,
          items: []
        })
      }
      monthMap.get(key).items.push(item)
    }
    // 按月倒序排列
    const sortedMonths = Array.from(monthMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([_, g]) => g)
    result.push(...sortedMonths)
  } else if (earlierItems.length > 0) {
    groups.earlier.items = earlierItems
    result.push(groups.earlier)
  }

  return result
}

/**
 * 文件列表按修改时间分组
 * 分组层级：今天 → 昨天 → 本周 → 上周 → 更早
 * @param {Array<{mtimeMs: number}>} files - 文件列表
 * @returns {Array<{key: string, label: string, items: Array}>}
 */
export function groupFilesByTime(files) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const date = now.getDate()

  const todayStart = new Date(year, month, date, 0, 0, 0, 0).getTime()

  // 昨天 00:00 - 23:59
  const yesterdayStart = todayStart - 86400000
  const yesterdayEnd = todayStart - 1

  // 本周一 00:00
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const thisMonday = new Date(year, month, date - mondayOffset, 0, 0, 0, 0).getTime()

  // 上周一 00:00 → 上周日 23:59:59.999
  const lastMonday = thisMonday - 7 * 86400000
  const lastSunday = thisMonday - 1

  const groups = {
    today: { key: 'today', label: '今天', items: [] },
    yesterday: { key: 'yesterday', label: '昨天', items: [] },
    thisWeek: { key: 'thisWeek', label: '本周', items: [] },
    lastWeek: { key: 'lastWeek', label: '上周', items: [] },
    earlier: { key: 'earlier', label: '更早', items: [] }
  }

  for (const file of files) {
    // 优先使用 mtimeMs，降级到 Date 解析 modified
    const ts = file.mtimeMs != null ? file.mtimeMs : new Date(file.modified).getTime()

    if (ts >= todayStart) {
      groups.today.items.push(file)
    } else if (ts >= yesterdayStart && ts <= yesterdayEnd) {
      groups.yesterday.items.push(file)
    } else if (ts >= thisMonday) {
      groups.thisWeek.items.push(file)
    } else if (ts >= lastMonday && ts <= lastSunday) {
      groups.lastWeek.items.push(file)
    } else {
      groups.earlier.items.push(file)
    }
  }

  const result = []
  if (groups.today.items.length) result.push(groups.today)
  if (groups.yesterday.items.length) result.push(groups.yesterday)
  if (groups.thisWeek.items.length) result.push(groups.thisWeek)
  if (groups.lastWeek.items.length) result.push(groups.lastWeek)
  if (groups.earlier.items.length) result.push(groups.earlier)

  return result
}

/** 安卓应用壳（WebView）：下载交给壳层下载管理器（通知栏进度、断点续传）。
 *  新版 WebView 的 UA 已移除 wv 标记，Version/4.0 是壳层独有信号 */
export function isAndroidShell() {
  const ua = navigator.userAgent
  return /Android/i.test(ua) && (/; wv\)/i.test(ua) || /Version\/4\.0/.test(ua))
}

/** 是否安卓端（含壳层与浏览器），用于整包更新等端判定 */
export function isAndroidUA() {
  return /Android/i.test(navigator.userAgent)
}

// 服务端按连接来源判定的真值；null = 尚未拿到（按外网保守处理）
let serverSaysLan = null

/** 由 useServerInfo 在拿到 server-info 后注入（服务端按来源 IP 事实判定） */
export function setClientIsLAN(v) {
  serverSaysLan = typeof v === 'boolean' ? v : null
}

/**
 * 判断当前访问是否来自内网
 * 唯一依据：服务端按连接来源 IP 判定的 clientIsLAN（server-info 下发）。
 * 未拿到时按外网处理——保守降级，不做任何形态猜测
 */
export function isLAN() {
  return serverSaysLan === true
}

/**
 * 智能下载：内网原生下载；外网优先「另存为」流式写盘（恒定内存），
 * 不支持时回落 fetch 分块 + Blob（大文件占内存，仅作兜底）
 * @param {string} url - 下载 URL
 * @param {string} filename - 保存文件名
 * @param {function} onProgress - 进度回调 (loaded, total)
 * @returns {Promise<void>}
 */
export async function smartDownload(url, filename, onProgress) {
  if (isLAN() || isAndroidShell()) {
    // 内网：浏览器原生下载（快且不占内存）；应用壳：交壳层下载管理器（通知栏进度、断点续传）
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    return
  }

  // 外网：优先系统「另存为」+ 流式写盘（桌面 Chromium）
  if (window.showSaveFilePicker) {
    let writable = null
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename })
      const response = await fetch(url)
      if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)
      const total = parseInt(response.headers.get('Content-Length') || '0', 10)
      const reader = response.body.getReader()
      writable = await handle.createWritable()
      let loaded = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writable.write(value)
        loaded += value.length
        if (onProgress) onProgress(loaded, total)
      }
      await writable.close()
      writable = null
      return
    } catch (err) {
      if (err && err.name === 'AbortError') throw err // 用户取消另存为
      if (err && err.name === 'NotAllowedError') throw err // 未授权保存
      // 其他错误（磁盘满等）回落 Blob；writable 交给 abort 清理
      if (writable) {
        try {
          await writable.abort()
        } catch {
          /* 已关闭则忽略 */
        }
      }
    }
  }

  // 兜底：fetch 分块 + Blob（读入内存后保存）
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)

  const contentLength = response.headers.get('Content-Length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.length
      if (onProgress) onProgress(loaded, total)
    }
  }

  const blob = new Blob(chunks)
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(blobUrl)
}

/**
 * 检测字符串是否为链接
 * @param {string} text
 * @returns {boolean}
 */
export function isLink(text) {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false

  // 标准http/https链接
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      // 仅限制域名(host)不能是纯中文乱码，路径/参数允许中文
      const host = url.hostname
      // host 包含中文则判定非法域名
      const hostHasChinese = /[\u4e00-\u9fa5]/.test(host)
      if (hostHasChinese) return false
      return host.includes('.') || host === 'localhost'
    } catch {
      return false
    }
  }

  // 裸域名（无协议，如 xxx.com/中文文件）
  const domainReg = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,6}(\/|\?|#|$|\s)/;
  if (domainReg.test(trimmed)) {
    try {
      const url = new URL('http://' + trimmed)
      const host = url.hostname
      const hostHasChinese = /[\u4e00-\u9fa5]/.test(host)
      if (hostHasChinese) return false
      return host.includes('.') || host === 'localhost'
    } catch {
      return false
    }
  }

  return false
}

/**
 * 将可能无协议的链接补全为完整 URL
 * @param {string} text
 * @returns {string}
 */
export function normalizeUrl(text) {
  const trimmed = text.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'http://' + trimmed
}

/**
 * 基于字符串生成固定哈希值（用于设备颜色分配）
 * @param {string} str
 * @returns {number} 0 ~ 1 之间的哈希值
 */
export function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // 转换为 32 位整数
  }
  return Math.abs(hash)
}
