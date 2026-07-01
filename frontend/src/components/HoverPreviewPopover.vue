<template>
  <Teleport to="body">
    <Transition name="preview-fade">
      <div
        v-if="previewState.visible"
        ref="popoverRoot"
        class="hover-preview-popover"
        :class="{ 'preview-wide': previewState.type === 'archive' || previewState.type === 'zip' }"
        :style="{ left: previewState.x + 'px', top: previewState.y + 'px' }"
        @mouseenter="onPopoverEnter"
        @mouseleave="onPopoverLeave"
      >
        <!-- Loading -->
        <div v-if="previewState.loading" class="hover-preview-loading">
          <div class="mini-spinner"></div>
        </div>

        <!-- Image preview -->
        <img
          v-else-if="previewState.type === 'image'"
          :src="previewState.imageUrl"
          class="hover-preview-img"
          alt="preview"
          loading="lazy"
          @error="onImageError"
        />

        <!-- Text preview -->
        <div v-else-if="previewState.type === 'text'" class="hover-preview-text">
          <pre>{{ previewState.content }}</pre>
        </div>

        <!-- Archive file listing (ZIP / RAR / 7z / Tar) -->
        <div v-else-if="previewState.type === 'archive' || previewState.type === 'zip'" class="hover-preview-archive">
          <div class="hover-preview-archive-header">
            <i class="fas fa-file-archive"></i>
            <span>{{ previewState.content }}</span>
          </div>
          <div class="hover-preview-archive-list" v-if="previewState.extraData && previewState.extraData.length > 0">
            <div v-for="(entry, i) in previewState.extraData.slice(0, 20)" :key="i" class="hover-preview-archive-entry">
              <i :class="entry.isDirectory ? 'fas fa-folder' : 'fas fa-file'"></i>
              <span class="hover-preview-archive-entry-name">{{ entry.name }}</span>
              <span v-if="!entry.isDirectory" class="hover-preview-archive-entry-size">{{ formatEntrySize(entry.size) }}</span>
            </div>
            <div v-if="previewState.extraData.length > 20" class="hover-preview-archive-more">
              还有 {{ previewState.extraData.length - 20 }} 个条目...
            </div>
          </div>
        </div>

        <!-- Media / Fallback -->
        <div v-else class="hover-preview-icon-only">
          <i :class="fallbackIcon" class="hover-preview-icon"></i>
          <span class="hover-preview-fname">{{ previewState.fileName }}</span>
          <span v-if="previewState.fileSize" class="hover-preview-fsize">{{ previewState.fileSize }}</span>
          <span class="hover-preview-fallback-hint">{{ fallbackHint }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, watch, ref, nextTick } from 'vue'
import { useHoverPreview } from '../composables/useHoverPreview.js'
import { formatFileSize } from '../utils/helpers.js'

const { previewState, onPopoverEnter, onPopoverLeave, setPopoverElement, repositionPopover } = useHoverPreview()
const popoverRoot = ref(null)

const fallbackIcon = computed(() => {
  const map = {
    video: 'fas fa-file-video',
    audio: 'fas fa-file-audio',
    archive: 'fas fa-file-archive',
  }
  return map[previewState.fallbackType] || previewState.icon || 'fas fa-file'
})

const fallbackHint = computed(() => {
  const map = {
    video: '视频文件（悬停预览需 ffmpeg）',
    audio: '音频文件',
    archive: '压缩文件',
    file: previewState.fileName?.split('.').pop()?.toUpperCase() + ' 文件' || '',
  }
  return map[previewState.fallbackType] || ''
})

watch(popoverRoot, (el) => {
  if (el) {
    setPopoverElement(el)
    // 等待 Vue 渲染完成，确保尺寸正确
    nextTick(() => {
      repositionPopover()
    })
  }
}, { immediate: true })

function formatEntrySize(bytes) {
  return formatFileSize(bytes)
}

function onImageError(e) {
  // 图片加载失败时显示 fallback
  previewState.type = 'fallback'
  previewState.fallbackType = 'file'
}
</script>

<style scoped>
.hover-preview-popover {
  position: fixed;
  z-index: 9999;
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  max-width: 320px;
  max-height: 280px;
  overflow: hidden;
}

.hover-preview-popover.preview-wide {
  max-width: 380px;
  max-height: 320px;
}

.hover-preview-loading {
  width: 80px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.hover-preview-img {
  display: block;
  max-width: 300px;
  max-height: 260px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  margin: 6px;
}

.hover-preview-text {
  padding: 14px 16px;
  max-height: 260px;
  overflow: hidden;
}

.hover-preview-text pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

/* Archive preview (unified for ZIP / RAR / 7z / Tar) */
.hover-preview-archive {
  padding: 10px 12px;
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.hover-preview-archive-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--accent-glow);
  font-weight: 600;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.hover-preview-archive-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hover-preview-archive-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.hover-preview-archive-entry i {
  width: 12px;
  text-align: center;
  font-size: 0.65rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.hover-preview-archive-entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hover-preview-archive-entry-size {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.hover-preview-archive-more {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-align: center;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

/* Fallback */
.hover-preview-icon-only {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 20px;
  max-width: 280px;
}

.hover-preview-icon {
  font-size: 1.8rem;
  color: var(--text-muted);
}

.hover-preview-fname {
  font-size: 0.7rem;
  color: var(--text-primary);
  text-align: center;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.hover-preview-fsize {
  font-size: 0.65rem;
  color: var(--text-muted);
}

.hover-preview-fallback-hint {
  font-size: 0.6rem;
  color: var(--text-muted);
  text-align: center;
  opacity: 0.7;
  margin-top: 2px;
}

/* Transition */
.preview-fade-enter-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.preview-fade-leave-active {
  transition: opacity 100ms ease;
}
.preview-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.preview-fade-leave-to {
  opacity: 0;
}
</style>
