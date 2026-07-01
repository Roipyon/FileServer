<template>
  <div class="upload-overlay" :class="{ closing }" @click.self="close">
    <div class="upload-backdrop"></div>
    <div class="upload-dialog" @click.stop>
      <div class="upload-dialog-header">
        <h2 class="upload-dialog-title">上传文件</h2>
        <button class="upload-dialog-close" @click="close">
          <i class="fas fa-xmark"></i>
        </button>
      </div>

      <div class="upload-dialog-body">
        <!-- Drop zone -->
        <div
          class="upload-dropzone"
          :class="{ dragover: isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <div class="upload-dropzone-icon">
            <i class="fas fa-cloud-arrow-up"></i>
          </div>
          <h4>拖放文件到此处</h4>
          <p>或点击下方按钮选择文件</p>
          <div class="upload-btn-group">
            <label class="upload-browse-btn">
              <i class="fas fa-folder-open"></i>&nbsp; 选择文件
              <input
                ref="fileInputRef"
                type="file"
                multiple
                hidden
                @change="onFileChange"
              />
            </label>
          </div>
        </div>

        <!-- File queue -->
        <div v-if="uploadFiles.length > 0" class="upload-queue">
          <div
            v-for="(item, idx) in uploadFiles"
            :key="idx"
            class="upload-queue-item"
            :class="{ 'item-error': item.status === 'error' }"
          >
            <div class="upload-queue-icon">
              <i class="fas fa-file"></i>
            </div>
            <div class="upload-queue-info">
              <div class="upload-queue-name">{{ item.name }}</div>
              <div class="upload-queue-size">{{ formatFileSize(item.size) }}</div>
            </div>
            <div class="upload-queue-status" :class="item.status">
              {{ statusLabel(item.status) }}
            </div>
            <!-- Retry button for errored items -->
            <button
              v-if="item.status === 'error'"
              class="upload-retry-btn"
              title="重试上传"
              @click="retryItem(item)"
            >
              <i class="fas fa-rotate"></i>
            </button>
          </div>
        </div>

        <!-- Error item retry all hint -->
        <div v-if="hasErrorItems && !uploading" class="upload-retry-all">
          <button class="btn-retry-all" @click="retryAll">
            <i class="fas fa-rotate"></i>&nbsp; 重试全部失败项
          </button>
        </div>

        <!-- Progress -->
        <div v-if="uploading" class="upload-progress-bar">
          <div
            class="upload-progress-fill"
            :style="{ width: uploadProgress + '%' }"
          ></div>
        </div>
        <div v-if="uploading" class="upload-status-text">
          {{ uploadStatus }}
        </div>
        <div v-if="uploading" class="upload-speed-eta">
          <span class="upload-speed"><i class="fas fa-gauge-high"></i> <span class="speed-value">{{ uploadSpeed }} MB/s</span></span>
          <span v-if="uploadEta" class="upload-eta"><i class="fas fa-clock"></i> 剩余 {{ uploadEta }}</span>
        </div>

        <!-- Actions -->
        <div v-if="uploadFiles.length > 0 && !uploading" class="upload-actions">
          <button class="btn-primary" @click="start" :disabled="noWaitingItems">
            <i class="fas fa-upload"></i>&nbsp; 开始上传
          </button>
          <button class="btn-secondary" @click="clear">
            <i class="fas fa-trash"></i>&nbsp; 清空
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useUpload } from '../composables/useUpload.js'
import { formatFileSize } from '../utils/helpers.js'

const props = defineProps({
  pendingFiles: { type: Array, default: null }
})

const emit = defineEmits(['close', 'upload-complete'])
const { uploading, uploadProgress, uploadStatus, uploadSpeed, uploadEta, uploadFiles, addFiles, clearFiles, startUpload, retryItem, retryAll } = useUpload()

// 接收外部传入的待上传文件（如移动端拍照/相册），自动开始上传并关闭弹窗
watch(() => props.pendingFiles, async (files) => {
  if (files && files.length > 0) {
    addFiles(files)
    // 等待 DOM 更新后自动上传
    await nextTick()
    if (!uploading.value && uploadFiles.value.some(f => f.status === 'waiting')) {
      const ok = await startUpload()
      if (ok) {
        const names = getUploadedNames()
        clearFiles()
        emit('upload-complete', names)
        // 自动关闭弹窗（延时让用户看到完成状态）
        setTimeout(() => close(), 300)
      }
    }
  }
}, { immediate: true })

const isDragging = ref(false)
const closing = ref(false)
const fileInputRef = ref(null)

const hasErrorItems = computed(() => uploadFiles.value.some(f => f.status === 'error'))
const noWaitingItems = computed(() => !uploadFiles.value.some(f => f.status === 'waiting'))

function close() {
  if (uploading.value) return
  closing.value = true
  setTimeout(() => {
    closing.value = false
    emit('close')
  }, 300)
}

function onFileChange(e) {
  if (e.target.files.length > 0) {
    addFiles(e.target.files)
  }
  e.target.value = ''
}

function onDrop(e) {
  isDragging.value = false
  if (e.dataTransfer.files.length > 0) {
    addFiles(e.dataTransfer.files)
  }
}

function clear() {
  clearFiles()
}

function getUploadedNames() {
  return uploadFiles.value
    .filter(item => item.status === 'success')
    .map(item => item.name)
}

async function autoUpload() {
  const ok = await startUpload()
  if (ok) {
    const names = getUploadedNames()
    clearFiles()
    emit('upload-complete', names)
  }
}

async function start() {
  const ok = await startUpload()
  if (ok) {
    const names = getUploadedNames()
    clearFiles()
    emit('upload-complete', names)
  }
}

function statusLabel(s) {
  const map = {
    waiting: '等待中',
    uploading: '上传中',
    success: '已完成',
    error: '失败',
    skipped: '已跳过'
  }
  return map[s] || s
}
</script>

<style scoped>
/* --- Upload Overlay ---------------------------------------- */
.upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: overlayIn var(--duration-normal) var(--ease-out-expo) both;
}

.upload-overlay.closing {
  animation: overlayOut var(--duration-normal) var(--ease-out-expo) both;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes overlayOut {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.upload-backdrop {
  position: absolute;
  inset: 0;
  background: var(--bg-overlay);
  backdrop-filter: blur(8px);
}

.upload-dialog {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  width: 90%;
  max-width: 560px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  animation: dialogSlideIn var(--duration-slow) var(--ease-spring) both;
}

.upload-overlay.closing .upload-dialog {
  animation: dialogSlideOut var(--duration-normal) var(--ease-out-expo) both;
}

@keyframes dialogSlideIn {
  from { transform: translateY(40px) scale(0.92); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes dialogSlideOut {
  from { transform: translateY(0) scale(1); opacity: 1; }
  to   { transform: translateY(40px) scale(0.92); opacity: 0; }
}

.upload-dialog-header {
  padding: 24px 28px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.upload-dialog-title {
  font-family: 'Playfair Display', serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.upload-dialog-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.upload-dialog-close:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

.upload-dialog-body {
  padding: 24px 28px 28px;
}

/* --- Dropzone ---------------------------------------------- */
.upload-dropzone {
  border: 2px dashed var(--border-glow);
  border-radius: var(--radius-lg);
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
  position: relative;
  overflow: hidden;
}

.upload-dropzone::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, var(--accent-glow-subtle), transparent);
  opacity: 0;
  transition: opacity var(--duration-normal);
}

.upload-dropzone:hover,
.upload-dropzone.dragover {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.upload-dropzone:hover::before,
.upload-dropzone.dragover::before {
  opacity: 1;
}

.upload-dropzone.dragover {
  border-style: solid;
  box-shadow: 0 0 40px var(--accent-glow-subtle), inset 0 0 40px var(--accent-glow-subtle);
}

.upload-dropzone-icon {
  font-size: 2.5rem;
  color: var(--accent-dim);
  margin-bottom: 16px;
  transition: all var(--duration-normal);
  position: relative;
  z-index: 1;
}

.upload-dropzone.dragover .upload-dropzone-icon {
  color: var(--accent);
  transform: scale(1.1);
}

.upload-dropzone h4 {
  font-family: 'DM Sans', sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.upload-dropzone p {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.upload-btn-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.upload-browse-btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 24px;
  border-radius: 24px;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  color: var(--accent);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.upload-browse-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
  border-color: var(--accent);
}

.upload-camera-btn,
.upload-gallery-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  font-size: 1rem;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border-glow);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.upload-camera-btn:hover {
  background: rgba(107, 139, 155, 0.15);
  color: #8fbbcc;
  border-color: rgba(107, 139, 155, 0.3);
}

.upload-gallery-btn:hover {
  background: rgba(196, 155, 77, 0.15);
  color: #d4af6a;
  border-color: rgba(196, 155, 77, 0.3);
}

/* --- Upload File Queue ------------------------------------- */
.upload-queue {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-queue-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  animation: cardReveal var(--duration-normal) var(--ease-out-expo) both;
}

.upload-queue-item.item-error {
  border-color: rgba(255, 85, 85, 0.25);
  background: rgba(255, 85, 85, 0.04);
}

.upload-queue-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
  flex-shrink: 0;
}

.upload-queue-info {
  flex: 1;
  min-width: 0;
}

.upload-queue-name {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-queue-size {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.upload-queue-status {
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.upload-queue-status.waiting   { color: var(--text-muted); }
.upload-queue-status.uploading { color: var(--warning); }
.upload-queue-status.success   { color: var(--success); }
.upload-queue-status.error     { color: var(--danger); }

/* Retry button */
.upload-retry-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-glow);
  background: var(--bg-hover);
  color: var(--warning);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
  flex-shrink: 0;
}

.upload-retry-btn:hover {
  background: rgba(255, 193, 7, 0.15);
  border-color: var(--warning);
  transform: rotate(180deg);
}

/* Retry all */
.upload-retry-all {
  margin-top: 10px;
  text-align: center;
}

.btn-retry-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 20px;
  border: 1px solid var(--border-glow);
  background: var(--bg-elevated);
  color: var(--warning);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.btn-retry-all:hover {
  background: rgba(255, 193, 7, 0.1);
  border-color: var(--warning);
}

/* --- Progress Bar ------------------------------------------ */
.upload-progress-bar {
  margin-top: 16px;
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
  overflow: hidden;
}

.upload-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent), var(--accent-glow));
  border-radius: 2px;
  transition: width 0.3s var(--ease-out-expo);
  position: relative;
}

.upload-progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.upload-status-text {
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-align: center;
}

.upload-speed-eta {
  margin-top: 6px;
  display: flex;
  justify-content: center;
  gap: 16px;
  font-size: 0.75rem;
  color: var(--text-muted);
  align-items: center;
}

.upload-speed,
.upload-eta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.upload-speed i,
.upload-eta i {
  font-size: 0.7rem;
  color: var(--accent-dim);
}

.speed-value {
  font-variant-numeric: tabular-nums;
  min-width: 5ch;
  display: inline-block;
  text-align: right;
}

/* --- Upload Actions / Buttons ------------------------------ */
.upload-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn-primary {
  flex: 1;
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  border: none;
  cursor: pointer;
  background: var(--accent);
  color: var(--text-inverse);
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.btn-primary:hover {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-secondary {
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: 'DM Sans', sans-serif;
  border: 1px solid var(--border-glow);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.btn-secondary:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .upload-dialog {
    width: 95%;
    max-height: 90vh;
    margin: 0 8px;
  }

  .upload-dialog-header {
    padding: 20px 20px 0;
  }

  .upload-dialog-body {
    padding: 16px 20px 20px;
  }

  .upload-dialog-title {
    font-size: 1.3rem;
  }

  .upload-dropzone {
    padding: 32px 16px;
  }

  .upload-dropzone h4 {
    font-size: 1rem;
  }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .upload-dialog-title {
    font-size: 1.15rem;
  }

  .upload-dropzone {
    padding: 22px 10px;
  }

  .upload-browse-btn {
    padding: 8px 18px;
    font-size: 0.8rem;
  }

  .btn-primary,
  .btn-secondary {
    padding: 10px 18px;
    font-size: 0.8rem;
  }
}
</style>
