import { reactive, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { getRawUrl, type FileEntry } from '../api/fileApi'
import { isImageFile, isTextFile, isVideoFile, isAudioFile, isArchiveFile } from '../utils/fileTypes.js'
import { getFileIcon } from '../utils/helpers.js'

type PreviewType = 'image' | 'text' | 'video' | 'audio' | 'archive' | 'fallback' | 'other' | ''
type FallbackKind = '' | 'video' | 'audio' | 'archive' | 'file'

interface PreviewState {
  visible: boolean
  x: number
  y: number
  _rawClientX: number   // 鼠标坐标
  _rawClientY: number
  type: PreviewType
  content: string       // text preview content / archive filename
  imageUrl: string      // image / thumbnail data URL
  fileName: string
  icon: string
  loading: boolean
  extraData: unknown    // archive file entries array
  fallbackType: FallbackKind
  fileSize: string      // formatted file size string
}

const previewState = reactive<PreviewState>({
  visible: false,
  x: 0,
  y: 0,
  _rawClientX: 0,
  _rawClientY: 0,
  type: '',
  content: '',
  imageUrl: '',
  fileName: '',
  icon: '',
  loading: false,
  extraData: null,
  fallbackType: '',
  fileSize: '',
})
const popoverRef = ref<HTMLElement | null>(null)

let hoverTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let currentFile: FileEntry | null = null // 最近一次悬停的文件（用于内部状态追踪）

function getPreviewType(filename: string): Exclude<PreviewType, '' | 'fallback'> {
  if (isImageFile(filename)) return 'image'
  if (isTextFile(filename)) return 'text'
  if (isVideoFile(filename)) return 'video'
  if (isAudioFile(filename)) return 'audio'
  if (isArchiveFile(filename)) return 'archive'
  return 'other'
}

const PREVIEW_TEXT_MAX = 200
const PREVIEW_SIZE_MAX = 1024 * 1024 // 1MB
const THUMBNAIL_BASE = '/api/thumbnail/'

function repositionPopover(): void {
    if (!previewState.visible) return

    // 默认尺寸（fallback，防止 DOM 还没渲染）
    let actualWidth = 300
    let actualHeight = 260

    // 尝试读取真实 DOM 尺寸
    const el = popoverRef.value
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        actualWidth = rect.width
        actualHeight = rect.height
      }
    }

    const rawX = previewState._rawClientX
    const rawY = previewState._rawClientY
    let x = rawX + 5
    let y = rawY + 5

    // 边界检查
    if (x + actualWidth > window.innerWidth - 10) {
      x = rawX - actualWidth - 10
    }
    if (y + actualHeight > window.innerHeight - 10) {
      y = window.innerHeight - actualHeight - 10
    }
    if (y < 10) y = 10
    if (x < 10) x = 10

    previewState.x = x
    previewState.y = y
  }

interface ThumbResult {
  type: string
  data?: unknown
}

async function loadPreview(filename: string): Promise<void> {
  const type = getPreviewType(filename)
  previewState.type = type
  previewState.fileName = filename
  previewState.icon = getFileIcon(filename)
  previewState.extraData = null
  previewState.fallbackType = ''
  previewState.loading = true

  if (type === 'image') {
    previewState.imageUrl = getRawUrl(filename)
    previewState.content = ''
    previewState.loading = false
    await nextTick()
    repositionPopover()
    return
  } else if (type === 'text') {
    previewState.imageUrl = ''
    try {
      const resp = await fetch(getRawUrl(filename))
      if (!resp.ok) throw new Error('加载失败')

      const contentLen = parseInt(resp.headers.get('content-length') || '0', 10)
      if (contentLen > PREVIEW_SIZE_MAX) {
        previewState.content = '文件较大，暂不预览'
        previewState.loading = false
        await nextTick()
        repositionPopover()
        return
      }

      const text = await resp.text()
      if (text.length === 0) {
        // 空文件：避免渲染空白气泡
        previewState.content = '（空文件）'
      } else if (text.length > PREVIEW_TEXT_MAX) {
        previewState.content = text.slice(0, PREVIEW_TEXT_MAX) + '…'
      } else {
        previewState.content = text
      }
    } catch {
      previewState.content = '预览加载失败'
    }
    previewState.loading = false
    await nextTick()
    repositionPopover()
    return
  } else if (type === 'video' || type === 'audio' || type === 'archive') {
    // 调用缩略图 API 获取视频截帧 / 音频封面 / ZIP 文件列表
    try {
      const resp = await fetch(`${THUMBNAIL_BASE}${encodeURIComponent(filename)}`)
      if (resp.ok) {
        const result: ThumbResult = await resp.json()
        if (result.type === 'image' && result.data) {
          // 视频截帧 / 音频封面 → 作为图片展示
          previewState.imageUrl = String(result.data)
          previewState.type = 'image'
          previewState.content = ''
          previewState.loading = false
          await nextTick()
          repositionPopover()
          return
        } else if ((result.type === 'archive' || result.type === 'zip') && result.data) {
          // 压缩包文件列表（ZIP/RAR/7z/Tar）
          // 兼容旧缓存 type: 'zip'
          previewState.extraData = result.data
          previewState.content = filename
          previewState.type = 'archive'
          previewState.loading = false
          await nextTick()
          repositionPopover()
          return
        }
      }
    } catch {
      // 缩略图获取失败 → 降级为图标
    }
    // Fallback
    previewState.imageUrl = ''
    previewState.content = ''
    previewState.fallbackType = type
    previewState.type = 'fallback'
    previewState.loading = false
    await nextTick()
    repositionPopover()
    return
  } else {
    // other: just show icon
    previewState.imageUrl = ''
    previewState.content = ''
    previewState.fallbackType = 'file'
    previewState.type = 'fallback'
    previewState.loading = false
    await nextTick()
    repositionPopover()
    return
  }
}

/** 事件目标是否落在操作按钮区域（预览应忽略/隐藏） */
function inActionArea(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest(
    '.card-action-btn, .row-action-btn, .card-expand-wrap, .list-expand-wrap, ' +
    '.file-card-actions, .cell-actions'
  )
}

export function useHoverPreview() {
  function setPopoverElement(el: HTMLElement | null): void {
    popoverRef.value = el
  }

  function showPreview(file: FileEntry | null, event: PointerEvent): void {
    if (!file || !file.name) return

    const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
    const isMobile = ua.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

    // 移动设备触发点击预览
    if (event.type === 'click' && !isMobile) return

    // 不支持预览的类型不显示
    if (getPreviewType(file.name) === 'other') return

    // 鼠标在操作按钮区域时忽略
    if (inActionArea(event.target)) return

    previewState._rawClientX = event.clientX
    previewState._rawClientY = event.clientY

    // 清除上一个定时器
    if (hoverTimer) clearTimeout(hoverTimer)
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    currentFile = file

    hoverTimer = setTimeout(async () => {
      previewState.visible = true
      repositionPopover()
      await loadPreview(file.name)
    }, 300)
  }

  function updatePosition(file: FileEntry, event: PointerEvent): void {
    // 鼠标在操作按钮区域时隐藏预览
    if (inActionArea(event.target)) {
      cancelHide()
      resetPreviewState()
      return
    }

    previewState._rawClientX = event.clientX
    previewState._rawClientY = event.clientY

    if (previewState.visible) {
      // 重新定位（基于最新的鼠标坐标和当前的 DOM 真实尺寸）
      repositionPopover()
      return
    }

    showPreview(file, event)
  }

  function resetPreviewState(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    currentFile = null
    previewState.visible = false
    previewState.type = ''
    previewState.content = ''
    previewState.imageUrl = ''
    previewState.extraData = null
    previewState.fallbackType = ''
    previewState.loading = false
  }

  function hidePreview(): void {
    // Archive preview: delay hide so user can move cursor onto the popover to scroll
    if (previewState.type === 'archive') {
      if (hideTimer) return // already scheduled
      hideTimer = setTimeout(() => {
        hideTimer = null
        resetPreviewState()
      }, 500)
      return
    }

    // Non-archive: hide immediately
    resetPreviewState()
  }

  function cancelHide(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function onPopoverEnter(): void {
    cancelHide()
  }

  function onPopoverLeave(): void {
    hidePreview()
  }

  onMounted(() => {
    window.addEventListener('resize', repositionPopover)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', repositionPopover)
    if (hoverTimer) clearTimeout(hoverTimer)
    if (hideTimer) clearTimeout(hideTimer)
  })

  return {
    previewState,
    showPreview,
    updatePosition,
    hidePreview,
    cancelHide,
    onPopoverEnter,
    onPopoverLeave,
    setPopoverElement,
    repositionPopover,
  }
}
