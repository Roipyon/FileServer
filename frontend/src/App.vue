<template>
  <div class="app-layout" :class="{ 'app-layout-simple': isUploadPage }">
    <!-- Top Navigation Bar (hidden on upload-token page) -->
    <template v-if="!isUploadPage">
    <header class="topbar">
      <div class="topbar-logo" @click="setSection('files')">
        <div class="topbar-logo-icon">
          <img :src="theme === 'light' ? lightIcon : darkIcon" width="35px">
        </div>
        <span class="topbar-logo-text">FileServer</span>
      </div>

      <div class="topbar-search">
        <i class="fas fa-search topbar-search-icon"></i>
        <input
          type="text"
          :value="state.searchQuery"
          @input="onSearch"
          :placeholder="state.currentSection === 'clipboard' ? '搜索剪贴板...' : '搜索文件...'"
        />
      </div>

      <nav class="topbar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          class="topbar-nav-item"
          :to="item.key"
          active-class="active"
          @click="setSection(item.key)"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <button class="topbar-theme-btn" @click="toggleTheme" :title="theme === 'dark' ? '切换为白天模式' : '切换为暗色模式'">
        <i :class="theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'"></i>
      </button>

      <button v-if="!isMobile" class="topbar-upload-btn" @click="showUpload = true">
        <i class="fas fa-cloud-arrow-up"></i>
        <span>上传</span>
      </button>
    </header>
    </template>

    <!-- Mobile Quick Action Bar (files section only) -->
    <div v-if="isMobile && !isUploadPage && state.currentSection === 'files'" class="mobile-quick-bar">
      <input
        ref="cameraInputRef"
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        @change="onMobileCameraCapture"
      />
      <input
        ref="galleryInputRef"
        type="file"
        accept="image/*"
        multiple
        hidden
        @change="onMobileGallerySelect"
      />
      <button class="mobile-quick-btn" @click="triggerCamera" title="拍照上传">
        <i class="fas fa-camera"></i>
        <span>拍照</span>
      </button>
      <button class="mobile-quick-btn" @click="triggerGallery" title="从相册选择">
        <i class="fas fa-images"></i>
        <span>相册</span>
      </button>
      <button class="mobile-quick-btn" @click="handleQuickPaste" title="快速粘贴">
        <i class="fas fa-paste"></i>
        <span>粘贴</span>
      </button>
    </div>

    <!-- Main Content -->
    <main class="main-content" :class="{ 'main-content-full': isUploadPage }">
      <div class="content-scroll" v-if="!state.loading || isUploadPage">
        <!-- Stats Section -->
        <router-view />
      </div>

      <!-- Loading State -->
      <div class="loading-state" v-if="state.loading">
        <div class="loading-spinner"></div>
        <p>{{ state.currentSection === 'clipboard' ? '正在加载剪贴板...' : '正在加载文件列表...' }}</p>
      </div>

    </main>

    <!-- Floating Action Button -->
    <FloatingMenu
      v-if="!isUploadPage"
      :section="state.currentSection"
      :current-view="state.currentView"
      @upload="showUpload = true"
      @toggle-view="toggleView"
      @batch-select="toggleSelectionMode"
      @quick-paste="handleQuickPaste"
      @refresh="handleRefresh"
      @gen-upload-token="handleGenerateUploadToken"
    />

    <!-- Status Bar -->
    <StatusBar v-if="!isUploadPage" @open-connection-info="showConnectionInfo = true" />

    <!-- Upload Overlay -->
    <Teleport to="body">
      <UploadOverlay
        v-if="showUpload && !isUploadPage"
        :pending-files="pendingUploadFiles"
        @close="handleUploadClose"
        @upload-complete="handleUploadComplete"
      />
    </Teleport>

    <!-- File Viewer (Preview / Edit) -->
    <FileViewer v-if="!isUploadPage" />

    <!-- Connection Info Panel -->
    <ConnectionInfo
      v-if="!isUploadPage"
      :visible="showConnectionInfo"
      @close="showConnectionInfo = false"
    />

    <!-- Batch Operations Bar -->
    <Transition name="batch-bar">
      <div v-if="state.selectionMode" class="batch-bar">
        <div class="batch-bar-left">
          <span class="batch-bar-count">已选 {{ state.selectedFiles.size }} 个</span>
          <button class="batch-bar-link" @click="selectAll">全选</button>
          <button class="batch-bar-link" @click="clearSelection">取消</button>
        </div>
        <div class="batch-bar-right">
          <button class="batch-bar-zip" @click="showZipModal = true">
            <i class="fas fa-file-zipper"></i> 打包下载
          </button>
          <button class="batch-bar-delete" @click="batchDelete">
            <i class="fas fa-trash"></i> 批量删除
          </button>
        </div>
      </div>
    </Transition>

    <Teleport to="body">
      <ZipProgressModal
        v-if="showZipModal && !isUploadPage"
        @close="showZipModal = false"
      />
    </Teleport>

    <!-- Shared Toast & Confirm Dialog (self-teleport to body) -->
    <ToastContainer v-if="!isUploadPage" />
    <ConfirmDialog v-if="!isUploadPage" />
    <PromptDialog v-if="!isUploadPage" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useFileManager } from './composables/useFileManager.js'
import { useClipboard } from './composables/useClipboard.js'
import UploadOverlay from './components/UploadOverlay.vue'
import FloatingMenu from './components/FloatingMenu.vue'
import StatusBar from './components/StatusBar.vue'
import FileViewer from './components/FileViewer.vue'
import ToastContainer from './components/ToastContainer.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import PromptDialog from './components/PromptDialog.vue'
import ConnectionInfo from './components/ConnectionInfo.vue'
import ZipProgressModal from './components/ZipProgressModal.vue'
import { sendClipboard } from './api/clipboardApi.js'
import { generateUploadToken } from './api/fileApi.js'
import { useToast } from './composables/useToast.js'
import { useConfirmDialog } from './composables/useConfirmDialog.js'
import { usePromptDialog } from './composables/usePromptDialog.js'
import { useTheme } from './composables/useTheme.js'

import darkIcon from '../dark-icon.png'
import lightIcon from '../light-icon.png'

const route = useRoute()

// Theme
const { theme, toggleTheme } = useTheme()

const isUploadPage = computed(() => route.name === 'upload-token')

// 移动设备检测
const isMobile = computed(() => {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
})

const cameraInputRef = ref(null)
const galleryInputRef = ref(null)

// 用于向 UploadOverlay 传递预选文件
const pendingUploadFiles = ref(null)

const {
  state,
  loadFiles, setSection, setView, debouncedSearch,
  toggleSelectionMode, selectAll, clearSelection, batchDelete,
  highlightFile,
  startAutoRefresh, stopAutoRefresh, refreshAndResetTimer
} = useFileManager()

const { loadItems: refreshClipboard, getDeviceName } = useClipboard()
const toast = useToast()
const { confirm } = useConfirmDialog()
const { prompt } = usePromptDialog()

const showUpload = ref(false)
const showConnectionInfo = ref(false)
const showZipModal = ref(false)

const navItems = [
  { key: 'files', label: '文件' },
  { key: 'clipboard', label: '剪贴板'}
]

function onSearch(e) {
  debouncedSearch(e.target.value)
}

function toggleView() {
  setView(state.currentView === 'grid' ? 'list' : 'grid')
}

function handleUploadClose() {
  showUpload.value = false
  pendingUploadFiles.value = null
}

async function onUploadComplete(uploadedNames) {
  refreshAndResetTimer()
  if (uploadedNames && uploadedNames.length > 0) {
    highlightFile(uploadedNames)
  }
}

function handleUploadComplete(uploadedNames) {
  onUploadComplete(uploadedNames)
  pendingUploadFiles.value = null
}

function handleRefresh() {
  if (state.currentSection === 'clipboard') {
    refreshClipboard()
  } else {
    refreshAndResetTimer()
  }
}

function triggerCamera() {
  if (cameraInputRef.value) cameraInputRef.value.click()
}

function triggerGallery() {
  if (galleryInputRef.value) galleryInputRef.value.click()
}

function onMobileCameraCapture(e) {
  if (e.target.files && e.target.files.length > 0) {
    pendingUploadFiles.value = Array.from(e.target.files)
    showUpload.value = true
  }
  e.target.value = ''
}

function onMobileGallerySelect(e) {
  const files = e.target.files
  if (files && files.length > 0) {
    const total = files.length
    const limited = total > 50 ? Array.from(files).slice(0, 50) : Array.from(files)
    if (total > 50) {
      toast.warning('最多选择 50 张照片，已截取前 50 张')
    }
    pendingUploadFiles.value = limited
    showUpload.value = true
  }
  e.target.value = ''
}

async function handleGenerateUploadToken() {
  try {
    const result = await generateUploadToken()
    const url = `${window.location.origin}/#/upload?token=${result.token}`

    // 兼容 http 内网环境 clipboard 不存在的问题
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url)
    } else {
      // 降级：创建隐藏输入框执行复制
      const tempInput = document.createElement('input')
      tempInput.style.position = 'absolute'
      tempInput.style.left = '-9999px'
      tempInput.value = url
      document.body.appendChild(tempInput)
      tempInput.select()
      document.execCommand('copy')
      document.body.removeChild(tempInput)
    }

    toast.success('上传链接已生成并复制到剪贴板')
    toast.info(`链接有效期 24 小时，打开即可上传文件，服务关闭或重启后失效`)
  } catch (err) {
    if (err.name === 'NotAllowedError' || !navigator.clipboard) {
      toast.warning(`链接生成成功，但自动复制失败，请手动复制：${url}`)
    } else {
      toast.error(`生成上传链接失败: ${err.message}`)
    }
  }
}

async function handleQuickPaste() {
  let text = ''
  // 尝试读取系统剪贴板
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText()
    }
  } catch (err) {
    toast.error('读取剪贴板失败，降级为手动粘贴:', err)
  }

  // 如果剪贴板 API 不可用或失败，降级为输入对话框
  if (!text) {
    text = await prompt('请粘贴要发送到剪贴板的内容：', '', {
      title: '手动粘贴',
      placeholder: '在此粘贴剪贴板内容…'
    })
    if (!text || !text.trim()) {
      toast.info('未输入内容')
      return
    }
  } else {
    // 截断预览
    const preview = text.length > 100 ? text.slice(0, 100) + '…' : text
    const ok = await confirm(`确认发送以下内容到剪贴板服务器？\n\n${preview}`, {
      title: '发送剪贴板',
      confirmText: '发送',
      variant: 'accent'
    })
    if (!ok) {
      toast.info('已取消')
      return
    }
  }

  try {
    await sendClipboard(text.trim(), getDeviceName())
    toast.success('已发送到剪贴板')
    refreshClipboard()
  } catch (err) {
    toast.error(`发送失败: ${err.message}`)
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    showUpload.value = false
    showConnectionInfo.value = false
    showZipModal.value = false
  }
}

function changeSection() {
  state.currentSection = window.location.hash.slice(2) || 'files'
}

onMounted(() => {
  loadFiles()
  startAutoRefresh(5000)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('hashchange', changeSection)

  // 兜底修正：如果浏览器不支持 dvh，手动计算高度
  const appLayout = document.querySelector('.app-layout')
  if (appLayout) {
    const fixHeight = () => {
      // 用可视高度减去顶部栏高度（56px），剩余给 main + statusbar
      const visualHeight = window.innerHeight
      appLayout.style.height = visualHeight + 'px'
    }
    fixHeight()
    window.addEventListener('resize', fixHeight)
    // 存一下清理函数
    window._fixHeightCleanup = fixHeight
  }
})

onUnmounted(() => {
  stopAutoRefresh()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('hashchange', changeSection)
  if (window._fixHeightCleanup) {
    window.removeEventListener('resize', window._fixHeightCleanup)
  }
})
</script>

<style scoped>
/* --- App Layout -------------------------------------------- */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  position: relative;
  z-index: 1;
}

.app-layout-simple {
  height: auto;
  min-height: 100dvh;
}

.main-content-full {
  overflow: visible !important;
}

/* --- Top Bar ----------------------------------------------- */
.topbar {
  height: var(--topbar-height);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 24px;
  gap: 20px;
  flex-shrink: 0;
  z-index: 100;
  position: relative;
}

.topbar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-dim), transparent);
  opacity: 0.5;
}

/* Logo */
.topbar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}

.topbar-logo-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dim));
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-inverse);
  font-size: 1rem;
}

.topbar-logo-text {
  font-family: 'Playfair Display', serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

/* Search */
.topbar-search {
  flex: 1;
  max-width: 420px;
  position: relative;
}

.topbar-search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 0.85rem;
  pointer-events: none;
  transition: color var(--duration-normal) var(--ease-out-expo);
}

.topbar-search input {
  width: 100%;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 9px 16px 9px 38px;
  color: var(--text-primary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  transition: all var(--duration-normal) var(--ease-out-expo);
  outline: none;
}

.topbar-search input::placeholder {
  color: var(--text-muted);
}

.topbar-search input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 20px var(--accent-glow-subtle);
}

.topbar-search input:focus ~ .topbar-search-icon {
  color: var(--accent);
}

/* Nav items */
.topbar-nav {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.topbar-nav-item {
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
  border: none;
  background: none;
  font-family: 'DM Sans', sans-serif;
  position: relative;
  white-space: nowrap;
  text-decoration: none;
}

.topbar-nav-item:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.topbar-nav-item.active {
  color: var(--accent-glow);
  background: var(--accent-subtle);
}

/* Upload CTA in topbar */
.topbar-upload-btn {
  padding: 9px 20px;
  border-radius: 24px;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  color: var(--text-inverse);
  background: var(--accent);
  border: none;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.topbar-upload-btn:hover {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
  transform: translateY(-1px);
}

.topbar-upload-btn:active {
  transform: translateY(0);
}

/* --- Theme Toggle Button ------------------------------------ */
.topbar-theme-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.topbar-theme-btn:hover {
  border-color: var(--border-accent);
  color: var(--accent-glow);
  background: var(--accent-subtle);
  transform: rotate(15deg);
}

.topbar-theme-btn i {
  transition: transform var(--duration-slow) var(--ease-spring);
}

.topbar-theme-btn:hover i {
  transform: scale(1.15);
}

/* --- Main Content Area ------------------------------------- */
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  scroll-behavior: smooth;
}

/* --- Loading State ----------------------------------------- */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
}

.loading-state p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* --- Batch Operations Bar ----------------------------------- */
.batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.batch-bar-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.batch-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-bar-count {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--accent-glow);
  white-space: nowrap;
}

.batch-bar-link {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--duration-fast);
}

.batch-bar-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.batch-bar-delete {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--danger);
  background: var(--danger-glow);
  color: var(--danger);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
}

.batch-bar-delete:hover {
  background: var(--danger);
  color: #fff;
}

.batch-bar-zip {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent);
  background: var(--accent-subtle);
  color: var(--accent-glow);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
}

.batch-bar-zip:hover {
  background: var(--accent);
  color: var(--text-inverse);
}

.batch-bar-enter-active {
  transition: all 300ms var(--ease-spring);
}
.batch-bar-leave-active {
  transition: all 200ms var(--ease-out-expo);
}
.batch-bar-enter-from,
.batch-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.9);
}

/* --- Mobile Quick Action Bar -------------------------------- */
.mobile-quick-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.mobile-quick-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.mobile-quick-btn:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}

.mobile-quick-btn i {
  font-size: 0.9rem;
  color: var(--accent-dim);
}

/* --- Responsive: Tablet ------------------------------------ */
@media (max-width: 1024px) {
  .topbar-nav-item {
    padding: 8px 12px;
    font-size: 0.8rem;
  }

}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .topbar {
    padding: 16px;
    gap: 10px;
    flex-wrap: wrap;
    height: auto;
  }

  .topbar-logo-text {
    display: none;
  }

  .topbar-search {
    max-width: none;
  }

  .topbar-nav {
    display: flex;
    width: 87%;
    gap: 6px;
  }

  .topbar-nav-item {
    flex: 1;
    text-align: center;
    padding: 10px 16px;
    border-radius: var(--radius-md);
    font-size: 0.85rem;
  }

  .content-scroll {
    padding: 16px;
  }

  .batch-bar {
    left: 10px;
    right: 10px;
    transform: none;
    border-radius: var(--radius-lg);
    padding: 10px 16px;
    gap: 12px;
    flex-wrap: wrap;
    bottom: 80px;
  }

  .batch-bar-count {
    font-size: 0.8rem;
  }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .topbar {
    gap: 8px;
    padding: 12px;
  }

  .topbar-search input {
    font-size: 0.8rem;
    padding: 8px 12px 8px 32px;
  }

  .topbar-search-icon {
    left: 10px;
    font-size: 0.75rem;
  }

  .content-scroll {
    padding: 12px;
  }
}
</style>
