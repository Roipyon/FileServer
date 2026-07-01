<template>
  <Teleport to="body">
    <Transition name="viewer-fade">
      <div v-if="viewerState.visible" class="viewer-overlay" @click.self="handleClose">
        <Transition name="viewer-slide">
          <div v-if="viewerState.visible" class="viewer-drawer">
            <!-- Header -->
            <div class="viewer-header">
              <div class="viewer-header-left">
                <span class="viewer-file-icon" :class="iconTypeClass">
                  <i :class="fileIcon"></i>
                </span>
                <span class="viewer-file-name" :title="fileName">{{ fileName }}</span>
                <span class="viewer-file-tag" :style="tagStyle">{{ fileCategory }}</span>
              </div>
              <div class="viewer-header-right">
                <button
                  v-if="canEdit"
                  class="viewer-header-btn"
                  :class="{ active: viewerState.mode === 'edit' }"
                  @click="toggleEditMode"
                  :title="viewerState.mode === 'edit' ? '切换为预览' : '编辑 (保存: Ctrl+S 或点击 ✓ 按钮)'"
                >
                  <i :class="viewerState.mode === 'edit' ? 'fas fa-eye' : 'fas fa-pen'"></i>
                </button>
                <button
                  v-if="canEdit && viewerState.mode === 'edit'"
                  class="viewer-header-btn viewer-save-btn"
                  :class="{ saving: viewerState.saving }"
                  title="保存 (Ctrl+S)"
                  @click="handleSave"
                >
                  <i :class="viewerState.saving ? 'fas fa-spinner fa-spin' : 'fas fa-check'"></i>
                </button>
                <a :href="downloadUrl" class="viewer-header-btn" title="下载">
                  <i class="fas fa-download"></i>
                </a>
                <button class="viewer-header-btn viewer-close-btn" @click="handleClose" title="关闭">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>

            <!-- Content -->
            <div class="viewer-body" ref="viewerBodyRef">
              <!-- Loading -->
              <div v-if="loading" class="viewer-loading">
                <div class="loading-spinner"></div>
                <p>{{ loadingText }}</p>
              </div>

              <!-- Text / Code (CodeMirror) — shown for: non-md text, md in edit mode, pdf/office -->
              <div
                v-show="!loading && (fileCategory === 'pdf' || fileCategory === 'office' || (fileCategory === 'text' && (!isMd || viewerState.mode === 'edit')))"
                ref="cmContainer" class="viewer-cm-container">
              </div>

              <!-- Markdown preview — only when md + preview mode -->
              <div
                v-show="!loading && fileCategory === 'text' && isMd && viewerState.mode === 'preview'"
                class="viewer-md-preview" v-html="renderedMd">
              </div>

              <!-- Image -->
              <div v-show="!loading && fileCategory === 'image'" class="viewer-image-wrap">
                <div class="viewer-image-zoom-bar">
                  <button class="viewer-zoom-btn" @click="zoomOut" :disabled="imgScale <= minScale" title="缩小">－</button>
                  <span class="viewer-zoom-percent">{{ Math.round(imgScale * 100) }}%</span>
                  <button class="viewer-zoom-btn" @click="zoomIn" :disabled="imgScale >= maxScale" title="放大">＋</button>
                  <button class="viewer-zoom-btn" @click="resetZoom" title="重置">重置</button>
                  <span class="viewer-zoom-separator"></span>
                  <button class="viewer-zoom-btn" @click="rotateImage(-90)" title="逆时针旋转 90°">
                    <i class="fas fa-undo-alt"></i>
                  </button>
                  <span class="viewer-zoom-percent">{{ rotation }}°</span>
                  <button class="viewer-zoom-btn" @click="rotateImage(90)" title="顺时针旋转 90°">
                    <i class="fas fa-redo-alt"></i>
                  </button>
                </div>
                <div class="viewer-image-nav">
                  <button class="viewer-image-arrow" @click="navImage(-1)" :disabled="!hasPrevImage">
                    <i class="fas fa-chevron-left"></i>
                  </button>
                  <img :src="rawUrl" :alt="fileName" class="viewer-image-main" draggable="false"
                    :style="{
                      transform: `scale(${imgScale}) translate(${imgTranslate.x}px, ${imgTranslate.y}px) rotate(${rotation}deg)`,
                      transition: 'transform 0.1s ease',
                      cursor: imgScale > 1 ? 'grab' : 'default'
                    }"
                    @load="onImageLoad"
                    @wheel="handleImageWheel"
                    @mousedown="startDrag"
                  />
                  <button class="viewer-image-arrow" @click="navImage(1)" :disabled="!hasNextImage">
                    <i class="fas fa-chevron-right"></i>
                  </button>
                </div>
                <div class="viewer-image-counter" v-if="totalImages > 1">{{ imageIndex + 1 }} / {{ totalImages }}</div>
              </div>

              <!-- Video -->
              <div v-show="!loading && fileCategory === 'video'" class="viewer-media-wrap">
                <video :src="rawUrl" class="viewer-video" controls preload="metadata">
                  您的浏览器不支持视频播放
                </video>
              </div>

              <!-- Audio -->
              <div v-show="!loading && fileCategory === 'audio'" class="viewer-media-wrap viewer-audio-wrap">
                <div class="viewer-audio-icon">
                  <i :class="fileIcon"></i>
                </div>
                <p class="viewer-audio-name">{{ fileName }}</p>
                <audio :src="rawUrl" class="viewer-audio" controls preload="metadata">
                  您的浏览器不支持音频播放
                </audio>
              </div>

              <!-- Archive (ZIP / RAR / 7z / Tar) -->
              <div v-show="!loading && fileCategory === 'archive'" class="viewer-archive-wrap">
                <!-- Fallback: 无法读取压缩包 -->
                <div v-if="archiveFallback" class="viewer-archive-fallback">
                  <i class="fas fa-file-archive viewer-archive-fallback-icon"></i>
                  <p>无法预览此压缩包内容</p>
                </div>
                <!-- 正常文件列表 -->
                <template v-else>
                  <div class="viewer-archive-header">
                    <i class="fas fa-file-archive"></i>
                    <span class="viewer-archive-filename">{{ fileName }}</span>
                    <span class="viewer-archive-format">{{ archiveFormat.toUpperCase() }}</span>
                    <span class="viewer-archive-count">{{ archiveTotal }} 个条目</span>
                    <button v-if="archiveEntries.length < archiveTotal" class="viewer-archive-dl-btn" @click="handleDownload">
                      <i class="fas fa-download"></i> 下载完整文件
                    </button>
                  </div>
                  <div class="viewer-archive-list">
                    <div
                      v-for="(entry, i) in archiveEntries"
                      :key="i"
                      class="viewer-archive-entry"
                      :class="{ 'is-dir': entry.isDirectory }"
                    >
                      <i :class="entry.isDirectory ? 'fas fa-folder' : 'fas fa-file'"></i>
                      <span class="viewer-archive-entry-name">{{ entry.name }}</span>
                      <span v-if="!entry.isDirectory" class="viewer-archive-entry-size">{{ formatEntrySize(entry.size) }}</span>
                    </div>
                    <div v-if="archiveEntries.length < archiveTotal" class="viewer-archive-more">
                      <i class="fas fa-ellipsis-h"></i>
                      还有 {{ archiveTotal - archiveEntries.length }} 个条目（仅显示前 {{ archiveEntries.length }} 个）
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Footer -->
            <div class="viewer-footer">
              <span>{{ viewerState.file?.size || '-' }}</span>
              <span v-if="viewerState.mode === 'edit'" class="viewer-save-status" :class="{ dirty: !viewerState.saved, saving: viewerState.saving }">
                {{ viewerState.saving ? '保存中...' : viewerState.saved ? '已保存' : '未保存' }}
              </span>
              <span>{{ viewerState.file?.modified || '-' }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useViewer } from '../composables/useViewer.js'
import { useFileManager } from '../composables/useFileManager.js'
import { getFileIcon, formatFileSize } from '../utils/helpers.js'
import { getDownloadUrl, getRawUrl, saveFile } from '../api/fileApi.js'
import {
  isTextFile, isImageFile, isArchiveFile,
  getFileCategory, getCodeMirrorLang, getExt, getFileTypeColor, iconTypeClass as getIconTypeClass
} from '../utils/fileTypes.js'
import { useToast } from '../composables/useToast.js'
import { useConfirmDialog } from '../composables/useConfirmDialog.js'

const toast = useToast()
const { confirm } = useConfirmDialog()

const { viewerState, openPreview, openEditor, closeViewer, toggleEditMode, markDirty, markSaved } = useViewer()
const { state: fileState } = useFileManager()

// --- 图片缩放 & 旋转 ---
const imgScale = ref(1)
const minScale = 0.2
const maxScale = 5
const imgTranslate = ref({ x: 0, y: 0 })
const rotation = ref(0)
let isDragging = false
let dragStart = { x: 0, y: 0 }

const zoomIn = () => {
  imgScale.value = Math.min(maxScale, imgScale.value + 0.05)
}
const zoomOut = () => {
  imgScale.value = Math.max(minScale, imgScale.value - 0.05)
}
const resetZoom = () => {
  imgScale.value = 1
  imgTranslate.value = { x: 0, y: 0 }
  rotation.value = 0
}

// 图片旋转
function rotateImage(degrees) {
  rotation.value = ((rotation.value + degrees) % 360 + 360) % 360
}

// 鼠标滚轮缩放
const handleImageWheel = (e) => {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.05 : 0.05
  const newScale = imgScale.value + delta
  if (newScale >= minScale && newScale <= maxScale) {
    imgScale.value = newScale
  }
}

// 拖拽平移（缩放大于1时有效）
const startDrag = (e) => {
  if (imgScale.value <= 1) return
  isDragging = true
  dragStart = { x: e.clientX - imgTranslate.value.x, y: e.clientY - imgTranslate.value.y }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}
const onDrag = (e) => {
  if (!isDragging) return
  imgTranslate.value = {
    x: e.clientX - dragStart.x,
    y: e.clientY - dragStart.y
  }
}
const stopDrag = () => {
  isDragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

// --- Refs ---
const cmContainer = ref(null)
const viewerBodyRef = ref(null)
const loading = ref(false)
const loadingText = ref('加载中...')
const showOfficeFallback = ref(false)
const renderedMd = ref('')

// Archive 预览状态
const archiveEntries = ref([])
const archiveTotal = ref(0)
const archiveFormat = ref('')
const archiveFallback = ref(false)

// CodeMirror instance
let cmView = null
let cmModules = null

// PDF.js instance
let pdfDoc = null
let pdfCurrentPage = 1

// --- Computed ---
const fileName = computed(() => viewerState.file?.name || '')
const fileExt = computed(() => getExt(fileName.value))
const fileCategory = computed(() => getFileCategory(fileName.value))
const fileIcon = computed(() => getFileIcon(fileName.value))
const iconTypeClass = computed(() => viewerState.file ? getIconTypeClass(fileName.value) : '')
const tagStyle = computed(() => {
  const c = getFileTypeColor(fileCategory.value)
  return { background: c.bg, color: c.color }
})
const canEdit = computed(() => isTextFile(fileName.value))
const isMd = computed(() => fileExt.value === 'md')
const rawUrl = computed(() => viewerState.file ? getRawUrl(viewerState.file.name) : '')
const downloadUrl = computed(() => viewerState.file ? getDownloadUrl(viewerState.file.name) : '')
const loadTrigger = computed(() => ({
  name: viewerState.file?.name,
  mode: viewerState.mode,
  visible: viewerState.visible
}))

// Image navigation
const imageIndex = ref(0)
const totalImages = computed(() => fileState.filteredFiles.filter(f => isImageFile(f.name)).length)
const imageFiles = computed(() => fileState.filteredFiles.filter(f => isImageFile(f.name)))
const hasPrevImage = computed(() => imageIndex.value > 0)
const hasNextImage = computed(() => imageIndex.value < totalImages.value - 1)

function navImage(dir) {
  const newIdx = imageIndex.value + dir
  const imgs = imageFiles.value
  if (newIdx >= 0 && newIdx < imgs.length) {
    imageIndex.value = newIdx
    openPreview(imgs[newIdx])
    resetZoom()
  }
}

function onImageLoad() {
  loading.value = false
  // 同步图片索引
  if (viewerState.file) {
    const imgs = imageFiles.value
    const idx = imgs.findIndex(f => f.name === viewerState.file.name)
    if (idx >= 0) imageIndex.value = idx
  }
}

let cmContentCache = ''

watch(loadTrigger, async (newVal, oldVal) => {
  // 仅当查看器可见且有文件时才处理
  if (!newVal.visible || !newVal.name) return

  // 判断是文件变化还是模式变化（可选，用于优化缓存）
  const nameChanged = newVal.name !== oldVal?.name
  const modeChanged = newVal.mode !== oldVal?.mode

  // 文件变化时重置状态
  if (nameChanged) {
    cmContentCache = ''
    resetZoom()
    pdfDoc = null
    imageIndex.value = 0
    archiveEntries.value = []
    archiveTotal.value = 0
    archiveFormat.value = ''
    archiveFallback.value = false
  }

  // 模式变化且之前处于编辑状态时，保存编辑器内容到缓存
  if (modeChanged && oldVal?.mode === 'edit' && cmView) {
    cmContentCache = cmView.state.doc.toString()
  }

  // 重新加载内容（原有加载逻辑不变）
  loading.value = true
  loadingText.value = '加载中...'
  showOfficeFallback.value = false
  await nextTick()

  const cat = fileCategory.value
  if (cat === 'text') {
    const content = nameChanged ? undefined : cmContentCache
    await loadText(content)
  } else if (cat === 'image') {
    loading.value = true // 等待图片 @load 事件
  } else if (cat === 'pdf' || cat === 'office') {
    if (nameChanged) await loadPdf()
    else loading.value = false
  } else if (cat === 'archive') {
    await loadArchive()
    // 文件变化时重置 archive 状态（nameChanged 已在 loadArchive 中处理）
  } else {
    loading.value = false
  }
}, { flush: 'post' })

// --- Text Loading (CodeMirror) ---
async function ensureCodeMirror() {
  if (cmModules) return cmModules

  const [
    { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder },
    { EditorState },
    { defaultKeymap, history, historyKeymap, indentWithTab },
    { syntaxHighlighting, defaultHighlightStyle },
    { oneDark }
  ] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/theme-one-dark')
  ])

  cmModules = {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, placeholder, EditorState, defaultKeymap, history, historyKeymap,
    indentWithTab, syntaxHighlighting, defaultHighlightStyle, oneDark
  }
  return cmModules
}

async function getLanguageExtension(filename) {
  const lang = getCodeMirrorLang(filename)
  if (!lang) return []

  // Dynamic language imports
  const langMap = {
    javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
    python: () => import('@codemirror/lang-python').then(m => m.python()),
    cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
    html: () => import('@codemirror/lang-html').then(m => m.html()),
    css: () => import('@codemirror/lang-css').then(m => m.css()),
    json: () => import('@codemirror/lang-json').then(m => m.json()),
    markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  }

  const loader = langMap[lang]
  if (loader) {
    try {
      const ext = await loader()
      return [ext]
    } catch { return [] }
  }
  return []
}

async function loadText(cachedContent) {
  await nextTick()

  // Destroy existing
  if (cmView) {
    cmView.destroy()
    cmView = null
  }

  // For md preview (no CM needed)
  if (isMd.value && viewerState.mode === 'preview') {
    try {
      const content = cachedContent || await (await fetch(rawUrl.value)).text()
      const { marked } = await import('marked')
      renderedMd.value = await marked(content)
      loading.value = false
    } catch (err) {
      toast.error('加载 Markdown 失败:', err)
      loadingText.value = '加载失败'
      loading.value = false
    }
    return
  }

  if (!cmContainer.value) return

  try {
    const content = cachedContent || await (await fetch(rawUrl.value)).text()

    renderedMd.value = ''

    const cm = await ensureCodeMirror()
    const langExt = await getLanguageExtension(fileName.value)

    const isEditable = viewerState.mode === 'edit'

    const extensions = [
      cm.lineNumbers(),
      cm.highlightActiveLine(),
      cm.drawSelection(),
      cm.syntaxHighlighting(cm.defaultHighlightStyle),
      cm.syntaxHighlighting(cm.oneDark),
      cm.history(),
      cm.keymap.of([...cm.defaultKeymap, ...cm.historyKeymap, cm.indentWithTab]),
      cm.EditorView.editable.of(isEditable),
      cm.EditorState.readOnly.of(!isEditable),
      cm.EditorView.updateListener.of((update) => {
        if (update.docChanged && isEditable) {
          markDirty()
        }
      })
    ]

    if (langExt.length) extensions.push(...langExt)

    // Save shortcut (Ctrl+S)
    if (isEditable) {
      const saveKeymap = cm.keymap.of([{
        key: 'Mod-s',
        run: () => { handleSave(); return true },
        preventDefault: true
      }])
      extensions.push(saveKeymap)
    }

    cmView = new cm.EditorView({
      doc: content,
      extensions,
      parent: cmContainer.value
    })

    loading.value = false
  } catch (err) {
    toast.error('加载文本失败:', err)
    loadingText.value = '加载失败'
    cmContainer.value && (cmContainer.value.innerHTML = `<p class="viewer-error">加载失败: ${err.message}</p>`)
  }
}

// --- PDF Loading (also used for Office) ---
async function loadPdf() {
  await nextTick()

  // Check if the response is actually a PDF
  try {
    const resp = await fetch(rawUrl.value)
    const contentType = resp.headers.get('content-type') || ''

    if (!contentType.includes('application/pdf')) {
      // Not a PDF — failed conversion, show fallback
      loading.value = false
      showOfficeFallback.value = true
      return
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    // Clear container
    if (cmContainer.value) cmContainer.value.innerHTML = ''
    if (cmView) { cmView.destroy(); cmView = null }

    const pdfjsLib = await import('pdfjs-dist')
    // 优先本地 worker（内网/离线），CDN 作为备用
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

    // 检测本地 worker 是否可用，不可用时使用 CDN fallback
    try {
      const check = await fetch('/pdf.worker.min.mjs', { method: 'HEAD' })
      if (!check.ok) throw new Error('not found')
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
    }

    const arrayBuffer = await resp.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    pdfDoc = await loadingTask.promise

    // Render all pages
    if (!cmContainer.value) return
    const container = cmContainer.value
    container.innerHTML = ''

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: 1.3 })
      const canvas = document.createElement('canvas')
      canvas.className = 'viewer-pdf-page'
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      container.appendChild(canvas)
    }

    loading.value = false
  } catch (err) {
    toast.error('加载 PDF 失败:', err)
    loading.value = false
    if (cmContainer.value) {
      cmContainer.value.innerHTML = `<p class="viewer-error">PDF 加载失败: ${err.message}</p>`
    }
  }
}

// --- Archive Loading (ZIP / RAR / 7z / Tar) ---
async function loadArchive() {
  await nextTick()
  archiveEntries.value = []
  archiveTotal.value = 0
  archiveFormat.value = ''
  archiveFallback.value = false

  try {
    const resp = await fetch(`/api/thumbnail/${encodeURIComponent(fileName.value)}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const result = await resp.json()
    if (result.type === 'archive' && Array.isArray(result.data)) {
      archiveEntries.value = result.data
      archiveTotal.value = result.total || result.data.length
      archiveFormat.value = result.format || 'zip'
      archiveFallback.value = false
    } else {
      archiveFallback.value = true
    }
  } catch (err) {
    archiveFallback.value = true
  }
  loading.value = false
}

function formatEntrySize(bytes) {
  return formatFileSize(bytes)
}

function handleDownload() {
  window.location.href = downloadUrl.value
}

// --- Save ---
async function handleSave() {
  if (!cmView) return
  viewerState.saving = true
  try {
    const content = cmView.state.doc.toString()
    await saveFile(fileName.value, content)
    markSaved()
    toast.success('已保存')
  } catch (err) {
    toast.error(`保存失败: ${err.message}`)
  } finally {
    viewerState.saving = false
  }
}

// --- Close ---
async function handleClose() {
  if (viewerState.mode === 'edit' && !viewerState.saved) {
    const ok = await confirm('有未保存的修改，确定关闭吗？', {
      title: '未保存的修改',
      confirmText: '关闭',
      variant: 'danger'
    })
    if (!ok) return
  }
  closeViewer()
}

// Keyboard: Escape to close
function handleKeydown(e) {
  if (!viewerState.visible) return
  if (e.key === 'Escape') {
    handleClose()
  }
}

// Register global keyboard handler
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleKeydown)
}

// Cleanup CodeMirror on unmount
onBeforeUnmount(() => {
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
/* --- Viewer Overlay & Drawer -------------------------------- */
.viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--overlay-bg);
  backdrop-filter: blur(4px);
}

.viewer-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 70%;
  max-width: 900px;
  height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-glow);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  z-index: 501;
}

/* Transition */
.viewer-fade-enter-active { transition: opacity 250ms var(--ease-out-expo); }
.viewer-fade-leave-active { transition: opacity 200ms var(--ease-out-expo); }
.viewer-fade-enter-from,
.viewer-fade-leave-to { opacity: 0; }

.viewer-slide-enter-active { transition: all 350ms var(--ease-spring); }
.viewer-slide-leave-active { transition: all 250ms var(--ease-out-expo); }
.viewer-slide-enter-from,
.viewer-slide-leave-to { transform: translateX(100%); }

/* --- Viewer Header ----------------------------------------- */
.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-surface);
}

.viewer-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.viewer-file-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.viewer-file-name {
  font-family: 'JetBrains Mono', 'DM Sans', monospace;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.viewer-file-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.viewer-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.viewer-header-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
  text-decoration: none;
}

.viewer-header-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

.viewer-header-btn.active {
  background: var(--accent-subtle);
  color: var(--accent);
  border: 1px solid var(--border-accent);
}

.viewer-close-btn:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

.viewer-save-btn {
  color: var(--success) !important;
  border: 1px solid var(--success-glow) !important;
}

.viewer-save-btn:hover {
  background: var(--success-glow) !important;
  color: #fff !important;
}

.viewer-save-btn.saving {
  opacity: 0.6;
  cursor: wait;
}

/* --- Viewer Body ------------------------------------------- */
.viewer-body {
  flex: 1;
  overflow: auto;
  position: relative;
}

.viewer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 16px;
}

.viewer-loading p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.viewer-error {
  color: var(--danger) !important;
  text-align: center;
  padding: 40px 20px;
}

/* --- CodeMirror Container ---------------------------------- */
.viewer-cm-container {
  height: 100%;
  overflow: auto;
}

.viewer-cm-container .cm-editor {
  height: 100%;
  font-size: 0.875rem;
}

.viewer-cm-container .cm-editor .cm-scroller {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.viewer-cm-container .cm-editor.cm-focused {
  outline: none;
}

/* --- Image Viewer ------------------------------------------ */
.viewer-image-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  height: 100%;
  overflow: auto;
  text-align: center;
}

.viewer-image-nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  width: 100%;
}

.viewer-image-arrow {
  position: absolute;
  z-index: 10;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-glow);
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
  flex-shrink: 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.viewer-image-arrow:first-child {
  left: 12px;
}

.viewer-image-arrow:last-child {
  right: 12px;
}

.viewer-image-arrow:hover:not(:disabled) {
  background: var(--accent-subtle);
  color: var(--accent-glow);
  border-color: var(--border-accent);
}

.viewer-image-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.viewer-image-main {
  max-width: 100%;
  max-height: calc(100vh - 180px);
  object-fit: contain;
  border-radius: var(--radius-sm);
  transform-origin: center;
  user-select: none;
  transition: transform 0.1s cubic-bezier(0.2, 0.9, 0.4, 1.1);
  cursor: grab;
  max-width: none;
}

.viewer-image-main:active {
  cursor: grabbing;
}

.viewer-image-main.dragging {
  cursor: grabbing;
}

.viewer-image-counter {
  margin-top: 12px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Image zoom bar (floating glass) */
.viewer-image-zoom-bar {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border-radius: 40px;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 15;
  border: 1px solid var(--border-glow);
  box-shadow: var(--shadow-md);
  transition: opacity 0.2s ease;
}

.viewer-image-zoom-bar:hover {
  background: color-mix(in srgb, var(--glass-bg), black 10%);
  border-color: var(--border-accent);
}

.viewer-zoom-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.viewer-zoom-btn:hover:not(:disabled) {
  background: var(--accent-subtle);
  color: var(--accent-glow);
  transform: scale(1.05);
}

.viewer-zoom-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.viewer-zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.viewer-zoom-percent {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  font-weight: 500;
  min-width: 50px;
  text-align: center;
  letter-spacing: 0.5px;
}

.viewer-zoom-btn.reset-btn {
  font-size: 0.75rem;
  width: auto;
  border-radius: 20px;
  padding: 0 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
}

.viewer-zoom-separator {
  width: 1px;
  height: 20px;
  background: var(--border-glow);
  opacity: 0.3;
}

.viewer-zoom-btn.reset-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
  border-color: var(--accent);
}

/* Scaled image state */
.viewer-image-wrap.scaled .viewer-image-main {
  box-shadow: 0 0 0 1px var(--border-accent), 0 8px 24px rgba(0,0,0,0.3);
}

/* --- Video Player ------------------------------------------ */
.viewer-media-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  height: 100%;
}

.viewer-video {
  max-width: 100%;
  max-height: calc(100vh - 180px);
  border-radius: var(--radius-md);
  background: #000;
}

/* --- Audio Player ------------------------------------------ */
.viewer-audio-wrap {
  gap: 20px;
  padding-top: 60px;
  justify-content: flex-start;
}

.viewer-audio-icon {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: var(--text-muted);
}

.viewer-audio-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.viewer-audio {
  width: 100%;
  max-width: 500px;
  margin-top: 8px;
}

/* --- PDF Viewer -------------------------------------------- */
.viewer-pdf-page {
  display: block;
  margin: 0 auto 16px;
  box-shadow: var(--shadow-md);
  border-radius: 2px;
}

.viewer-pdf-page:last-child {
  margin-bottom: 0;
}

/* --- Office Fallback --------------------------------------- */
.viewer-office-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
  gap: 12px;
}

.viewer-office-fallback-icon {
  font-size: 3rem;
  color: var(--text-muted);
  opacity: 0.4;
  margin-bottom: 8px;
}

.viewer-office-fallback p {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.viewer-office-fallback-hint {
  color: var(--text-muted) !important;
  font-size: 0.8rem !important;
}

.viewer-office-dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 24px;
  border-radius: 24px;
  background: var(--accent);
  color: var(--text-inverse);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.viewer-office-dl-btn:hover {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
}

/* --- Viewer Footer ----------------------------------------- */
.viewer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
  background: var(--bg-surface);
}

.viewer-save-status {
  font-weight: 600;
  color: var(--success);
  transition: color var(--duration-fast);
}

.viewer-save-status.dirty {
  color: var(--warning);
}

.viewer-save-status.saving {
  color: var(--warning);
  animation: pulse 0.8s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* --- Archive Preview ------------------------------------------ */
.viewer-archive-wrap {
  padding: 20px 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.viewer-archive-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8rem;
  color: var(--accent-glow);
  font-weight: 600;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.viewer-archive-filename {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  color: var(--text-primary);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-archive-format {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-subtle);
  color: var(--accent-glow);
  letter-spacing: 0.05em;
}

.viewer-archive-count {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 400;
}

.viewer-archive-dl-btn {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 16px;
  border: 1px solid var(--accent);
  background: var(--accent-subtle);
  color: var(--accent-glow);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.viewer-archive-dl-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
}

.viewer-archive-list {
  flex: 1;
  overflow-y: auto;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.viewer-archive-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--text-secondary);
  transition: background var(--duration-fast);
}

.viewer-archive-entry:hover {
  background: var(--bg-hover);
}

.viewer-archive-entry.is-dir {
  color: var(--accent-dim);
}

.viewer-archive-entry i {
  width: 14px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.viewer-archive-entry.is-dir i {
  color: var(--accent-dim);
}

.viewer-archive-entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
}

.viewer-archive-entry-size {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.viewer-archive-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--text-muted);
  padding: 8px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.viewer-archive-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
  text-align: center;
}

.viewer-archive-fallback-icon {
  font-size: 3rem;
  color: var(--text-muted);
  opacity: 0.4;
}

.viewer-archive-fallback p {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* --- Responsive: Viewer Drawer ----------------------------- */
@media (max-width: 768px) {
  .viewer-drawer {
    width: 100%;
    max-width: none;
  }

  .viewer-header {
    padding: 12px 16px;
  }

  .viewer-file-name {
    max-width: 160px;
    font-size: 0.8rem;
  }

  .viewer-image-main {
    max-height: calc(100vh - 200px);
  }

  .viewer-video {
    max-height: calc(100vh - 200px);
  }

  .viewer-image-zoom-bar {
    bottom: 16px;
    padding: 4px 12px;
    gap: 12px;
  }
  .viewer-zoom-btn {
    width: 36px;
    height: 36px;
    font-size: 1rem;
  }
  .viewer-zoom-percent {
    font-size: 0.75rem;
    min-width: 44px;
  }
  .viewer-zoom-btn.reset-btn {
    padding: 0 10px;
  }
}

@media (max-width: 480px) {
  .viewer-header-left {
    gap: 8px;
  }

  .viewer-file-tag {
    display: none;
  }

  .viewer-image-zoom-bar {
    bottom: 12px;
    padding: 4px 10px;
    gap: 8px;
  }
  .viewer-zoom-btn {
    width: 32px;
    height: 32px;
    font-size: 0.9rem;
  }
  .viewer-zoom-percent {
    font-size: 0.7rem;
    min-width: 38px;
  }

  .viewer-archive-wrap {
    padding: 12px 16px;
  }
  .viewer-archive-header {
    font-size: 0.75rem;
    gap: 6px;
  }
  .viewer-archive-entry {
    font-size: 0.75rem;
    padding: 3px 6px;
  }
  .viewer-archive-entry-name {
    font-size: 0.73rem;
  }
  .viewer-archive-entry-size {
    font-size: 0.65rem;
  }
}

/* Landscape short screens */
@media (max-height: 500px) and (orientation: landscape) {
  .viewer-image-zoom-bar {
    bottom: 8px;
    padding: 2px 8px;
  }
  .viewer-zoom-btn {
    width: 28px;
    height: 28px;
    font-size: 0.8rem;
  }
}
</style>

<style>
/* ============================================================
   Markdown Preview Styles (non-scoped, for v-html content)
   ============================================================ */
.viewer-md-preview {
  padding: 24px 32px;
  font-family: 'DM Sans', sans-serif;
  color: var(--text-primary);
  line-height: 1.8;
  max-width: 100%;
  overflow-x: auto;
}

.viewer-md-preview h1,
.viewer-md-preview h2,
.viewer-md-preview h3,
.viewer-md-preview h4,
.viewer-md-preview h5,
.viewer-md-preview h6 {
  font-family: 'Playfair Display', serif;
  color: var(--accent-glow);
  margin: 1.2em 0 0.6em;
}

.viewer-md-preview h1 { font-size: 1.6rem; }
.viewer-md-preview h2 { font-size: 1.3rem; }
.viewer-md-preview h3 { font-size: 1.1rem; }
.viewer-md-preview h4 { font-size: 1rem; }
.viewer-md-preview h5 { font-size: 0.95rem; }
.viewer-md-preview h6 { font-size: 0.9rem; }

.viewer-md-preview p {
  margin: 0.8em 0;
}

.viewer-md-preview code {
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
}

.viewer-md-preview pre {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;
}

.viewer-md-preview pre code {
  background: none;
  padding: 0;
}

.viewer-md-preview blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 16px;
  color: var(--text-secondary);
  margin: 1em 0;
}

.viewer-md-preview table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.viewer-md-preview th,
.viewer-md-preview td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.viewer-md-preview th {
  background: var(--bg-hover);
  font-weight: 600;
}

.viewer-md-preview a {
  color: var(--accent);
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.viewer-md-preview a:hover {
  color: var(--accent-glow);
  text-decoration: underline;
}

.viewer-md-preview ul,
.viewer-md-preview ol {
  margin: 0.6em 0;
  padding-left: 1.8em;
}

.viewer-md-preview li {
  margin: 0.3em 0;
}

.viewer-md-preview hr {
  border: none;
  border-top: 1px solid var(--border-glow);
  margin: 1.5em 0;
}

.viewer-md-preview img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  margin: 1em 0;
}

.viewer-md-preview strong {
  color: var(--accent-glow);
  font-weight: 700;
}

.viewer-md-preview em {
  color: var(--text-secondary);
  font-style: italic;
}
</style>