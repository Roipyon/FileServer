// 文件类型检测和分类工具

// 文本类型扩展名（可用于编辑）
const TEXT_EXTS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'c', 'cpp', 'h',
  'java', 'go', 'rs', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml',
  'toml', 'sh', 'bat', 'ini', 'cfg', 'log', 'vue', 'csv', 'rb', 'php',
  'swift', 'kt', 'lua', 'r', 'sql', 'env', 'gitignore', 'dockerfile'
])

// Office 类型（需要服务端 LibreOffice 转换）
const OFFICE_EXTS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
])

// 媒体类型
const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'
])
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'
])
const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'
])
const ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'
])

// 扩展名 → CodeMirror 语言模式
const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
  py: 'python',
  c: 'cpp', cpp: 'cpp', h: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  html: 'html', htm: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  json: 'json',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'shell', bat: 'shell',
  rb: 'ruby',
  php: 'php'
}

/**
 * 获取文件扩展名（小写，不含点）
 */
export function getExt(filename) {
  return (filename || '').split('.').pop().toLowerCase()
}

/**
 * 是否为文本类型（支持预览和编辑）
 */
export function isTextFile(filename) {
  return TEXT_EXTS.has(getExt(filename))
}

/**
 * 是否为 Office 文档
 */
export function isOfficeFile(filename) {
  return OFFICE_EXTS.has(getExt(filename))
}

/**
 * 是否为图片
 */
export function isImageFile(filename) {
  return IMAGE_EXTS.has(getExt(filename))
}

/**
 * 是否为视频
 */
export function isVideoFile(filename) {
  return VIDEO_EXTS.has(getExt(filename))
}

/**
 * 是否为音频
 */
export function isAudioFile(filename) {
  return AUDIO_EXTS.has(getExt(filename))
}

/**
 * 是否为压缩包
 */
export function isArchiveFile(filename) {
  return ARCHIVE_EXTS.has(getExt(filename))
}

/**
 * 是否为 PDF
 */
export function isPdfFile(filename) {
  return getExt(filename) === 'pdf'
}

/**
 * 获取文件的显示类别标签
 */
export function getFileCategory(filename) {
  const ext = getExt(filename)
  if (TEXT_EXTS.has(ext)) return 'text'
  if (OFFICE_EXTS.has(ext)) return 'office'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  if (ext === 'pdf') return 'pdf'
  return 'unknown'
}

/**
 * 获取 CodeMirror 语言模式名
 */
export function getCodeMirrorLang(filename) {
  const ext = getExt(filename)
  return LANG_MAP[ext] || null
}

/**
 * 获取文件类型颜色标签
 */
export function getFileTypeColor(category) {
  const colors = {
    text:    { bg: 'rgba(107, 139, 155, 0.15)', color: '#8fbbcc' },
    office:  { bg: 'rgba(107, 139, 139, 0.15)', color: '#8fbbbb' },
    image:   { bg: 'rgba(196, 155, 77, 0.15)',  color: '#d4af6a' },
    video:   { bg: 'rgba(155, 107, 139, 0.15)', color: '#c49bbf' },
    audio:   { bg: 'rgba(139, 155, 107, 0.15)', color: '#b0c47a' },
    archive: { bg: 'rgba(155, 139, 107, 0.15)', color: '#c4a87a' },
    pdf:     { bg: 'rgba(196, 85, 77, 0.15)',   color: '#d4847a' },
    unknown: { bg: 'rgba(155, 155, 155, 0.1)',  color: '#aaaaaa' }
  }
  return colors[category] || colors.unknown
}

/**
 * 判断文件类型是否支持预览/查看
 */
export function isPreviewSupported(filename) {
  const cat = getFileCategory(filename)
  return cat !== 'office' && cat !== 'unknown'
}

/**
 * 文件卡片图标 CSS 类名映射
 */
export function iconTypeClass(filename) {
  const ext = getExt(filename)
  const map = {
    pdf: 'type-doc', doc: 'type-doc', docx: 'type-doc', txt: 'type-doc', md: 'type-doc',
    xls: 'type-doc', xlsx: 'type-doc', ppt: 'type-doc', pptx: 'type-doc',
    jpg: 'type-img', jpeg: 'type-img', png: 'type-img', gif: 'type-img',
    svg: 'type-img', webp: 'type-img', bmp: 'type-img', ico: 'type-img',
    mp4: 'type-vid', avi: 'type-vid', mkv: 'type-vid', mov: 'type-vid',
    webm: 'type-vid', flv: 'type-vid', wmv: 'type-vid',
    mp3: 'type-aud', wav: 'type-aud', flac: 'type-aud', aac: 'type-aud',
    ogg: 'type-aud', wma: 'type-aud', m4a: 'type-aud',
    zip: 'type-arch', rar: 'type-arch', '7z': 'type-arch', tar: 'type-arch',
    gz: 'type-arch', bz2: 'type-arch', xz: 'type-arch',
    js: 'type-code', ts: 'type-code', jsx: 'type-code', tsx: 'type-code',
    vue: 'type-code', py: 'type-code', java: 'type-code', cpp: 'type-code',
    c: 'type-code', go: 'type-code', rs: 'type-code', html: 'type-code',
    css: 'type-code', scss: 'type-code', json: 'type-code', xml: 'type-code',
  }
  return map[ext] || 'type-gen'
}
