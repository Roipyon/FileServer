<template>
  <div class="upload-token-layout">
    <div class="upload-token-card">
      <div class="upload-token-header">
        <div class="upload-token-icon">
          <i class="fas fa-cloud-arrow-up"></i>
        </div>
        <h2>文件上传</h2>
        <p v-if="!error">选择文件上传到服务器，每次最多 10 个文件</p>
      </div>

      <!-- Error state -->
      <div v-if="error" class="upload-token-error">
        <i class="fas fa-circle-exclamation"></i>
        <p>{{ error }}</p>
      </div>

      <!-- Success state -->
      <div v-if="uploadComplete && !error" class="upload-token-success">
        <i class="fas fa-check-circle"></i>
        <p>上传完成！</p>
        <p class="upload-token-success-detail">
          已成功上传 {{ uploadResults.filter(r => r.success).length }} 个文件
        </p>
        <button class="upload-token-btn upload-token-btn-accent" @click="resetUpload">
          继续上传
        </button>
      </div>

      <!-- Upload area -->
      <div v-if="!uploadComplete && !error" class="upload-token-body">
        <!-- Dropzone -->
        <div
          class="upload-token-dropzone"
          :class="{ dragover: isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <div class="upload-token-dropzone-icon">
            <i class="fas fa-cloud-arrow-up"></i>
          </div>
          <h4>拖放文件到此处</h4>
          <p>或点击选择文件</p>
          <label class="upload-token-browse-btn">
            <i class="fas fa-folder-open"></i> 选择文件
            <input type="file" multiple hidden ref="fileInputRef" @change="onFileChange" />
          </label>
        </div>

        <!-- File list -->
        <div v-if="files.length > 0" class="upload-token-queue">
          <div v-for="(f, i) in files" :key="i" class="upload-token-queue-item">
            <i class="fas fa-file"></i>
            <span class="upload-token-queue-name">{{ f.name }}</span>
            <span class="upload-token-queue-size">{{ formatFileSize(f.size) }}</span>
            <span v-if="f.status === 'success'" class="upload-token-queue-status success">
              <i class="fas fa-check"></i>
            </span>
            <span v-else-if="f.status === 'error'" class="upload-token-queue-status error">
              <i class="fas fa-xmark"></i>
            </span>
          </div>
        </div>

        <!-- Progress -->
        <div v-if="uploading" class="upload-token-progress">
          <div class="upload-token-progress-bar">
            <div class="upload-token-progress-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="upload-token-progress-text">{{ progress }}%</div>
        </div>
        <div v-if="merging" class="upload-token-merge-status">
          <i class="fas fa-spinner fa-spin"></i> 正在合并文件...
        </div>

        <!-- Actions -->
        <div v-if="files.length > 0 && !uploading && !uploadComplete" class="upload-token-actions">
          <button class="upload-token-btn upload-token-btn-accent" :disabled="files.length > 10" @click="startUpload">
            <i class="fas fa-upload"></i> 开始上传
          </button>
          <button class="upload-token-btn upload-token-btn-cancel" @click="clearFiles">
            <i class="fas fa-trash"></i> 清空
          </button>
        </div>

        <div v-if="files.length > 10" class="upload-token-limit-warn">
          最多选择 10 个文件
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { formatFileSize } from '../utils/helpers.js'

const props = defineProps({
  token: { type: String, default: '' }
})

const BASE = window.location.origin
const CHUNK_SIZE = 1 * 1024 * 1024

const files = ref([])
const uploading = ref(false)
const merging = ref(false)
const progress = ref(0)
const uploadComplete = ref(false)
const uploadResults = ref([])
const error = ref('')
const isDragging = ref(false)
const fileInputRef = ref(null)

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

function addFiles(newFiles) {
  const arr = Array.from(newFiles)
  if (files.value.length + arr.length > 10) {
    error.value = '最多选择 10 个文件'
    return
  }
  files.value = files.value.concat(arr.map(f => ({
    file: f,
    name: f.name,
    size: f.size,
    status: 'waiting'
  })))
  error.value = ''
}

onMounted(() => {
  if (!props.token) {
    error.value = '无效的上传链接：缺少访问令牌'
  }
})

function clearFiles() {
  files.value = []
  progress.value = 0
  error.value = ''
}

function resetUpload() {
  uploadComplete.value = false
  merging.value = false
  uploadResults.value = []
  files.value = []
  progress.value = 0
  error.value = ''
}

async function startUpload() {
  if (files.value.length === 0) return
  uploading.value = true
  progress.value = 0

  try {
    for (let i = 0; i < files.value.length; i++) {
      const item = files.value[i]
      const file = item.file
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}-${i}`
      item.status = 'uploading'

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunk = file.slice(start, end)

        const formData = new FormData()
        formData.append('fileId', fileId)
        formData.append('chunkIndex', chunkIndex)
        formData.append('totalChunks', totalChunks)
        formData.append('fileName', file.name)
        formData.append('chunk', chunk)

        await uploadChunk(formData, (loaded, total) => {
          const chunkPct = (chunkIndex + loaded / total) / totalChunks
          progress.value = Math.round(((i + chunkPct) / files.value.length) * 100)
        })
      }

      // 合并阶段
      merging.value = true
      const mergeResult = await mergeChunks(fileId, file.name, totalChunks)
      merging.value = false
      item.status = 'success'
      uploadResults.value.push({ name: mergeResult?.name || file.name, success: true })
    }

    uploadComplete.value = true
    progress.value = 100
  } catch (err) {
    merging.value = false
    error.value = `上传失败: ${err.message}`
    // 标记当前正在上传的文件为错误状态
    files.value.forEach(f => {
      if (f.status === 'uploading') f.status = 'error'
    })
  } finally {
    uploading.value = false
  }
}

// Upload helpers (use chunked upload with token auth)
function uploadChunk(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/upload-chunk?token=${props.token}`, true)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ success: true })
      } else {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('网络错误')))
    xhr.addEventListener('abort', () => reject(new Error('上传取消')))
    xhr.send(formData)
  })
}

function mergeChunks(fileId, fileName, totalChunks) {
  return fetch(`${BASE}/api/merge-chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, fileName, totalChunks, token: props.token })
  }).then(r => {
    if (!r.ok) return r.json().then(e => Promise.reject(new Error(e.error || '合并失败')))
    return r.json()
  })
}
</script>

<style scoped>
.upload-token-layout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  padding: 20px;
}

.upload-token-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 32px;
  max-width: 560px;
  width: 100%;
}

.upload-token-header {
  text-align: center;
  margin-bottom: 24px;
}

.upload-token-icon {
  font-size: 2.5rem;
  color: var(--accent-dim);
  margin-bottom: 12px;
}

.upload-token-header h2 {
  font-family: 'Playfair Display', serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.upload-token-header p {
  color: var(--text-muted);
  font-size: 0.875rem;
}

/* Error */
.upload-token-error {
  text-align: center;
  padding: 40px 20px;
  color: var(--danger);
}

.upload-token-error i {
  font-size: 2.5rem;
  margin-bottom: 12px;
}

/* Success */
.upload-token-success {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0px 20px 20px 20px;
}

.upload-token-success i {
  font-size: 3rem;
  color: var(--success);
  margin-bottom: 12px;
}

.upload-token-success p {
  font-size: 1.1rem;
  color: var(--text-primary);
  font-weight: 600;
}

.upload-token-success-detail {
  font-size: 0.85rem !important;
  color: var(--text-muted) !important;
  font-weight: 400 !important;
  margin-top: 10px;
  margin-bottom: 20px;

}

/* Dropzone */
.upload-token-dropzone {
  border: 2px dashed var(--border-glow);
  border-radius: var(--radius-lg);
  padding: 40px 24px;
  text-align: center;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.upload-token-dropzone:hover,
.upload-token-dropzone.dragover {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.upload-token-dropzone.dragover {
  border-style: solid;
}

.upload-token-dropzone-icon {
  font-size: 2rem;
  color: var(--accent-dim);
  margin-bottom: 12px;
}

.upload-token-dropzone h4 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.upload-token-dropzone p {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.upload-token-browse-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  cursor: pointer;
  transition: all var(--duration-normal);
}

.upload-token-browse-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
}

/* Queue */
.upload-token-queue {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.upload-token-queue-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
}

.upload-token-queue-item i {
  color: var(--text-muted);
}

.upload-token-queue-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.upload-token-queue-size {
  color: var(--text-muted);
  flex-shrink: 0;
}

.upload-token-queue-status.success { color: var(--success); }
.upload-token-queue-status.error { color: var(--danger); }

/* Progress */
.upload-token-progress {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.upload-token-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-deep);
  border-radius: 3px;
  overflow: hidden;
}

.upload-token-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent));
  border-radius: 3px;
  transition: width 0.3s ease-out;
}

.upload-token-progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  color: var(--accent-glow);
  font-weight: 600;
  min-width: 40px;
  text-align: right;
}

/* Merge status */
.upload-token-merge-status {
  margin-top: 10px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.upload-token-merge-status i {
  color: var(--accent-dim);
}

/* Actions */
.upload-token-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.upload-token-btn {
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--duration-normal);
  display: flex;
  align-items: center;
  gap: 6px;
}

.upload-token-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upload-token-btn-accent {
  flex: 1;
  background: var(--accent);
  color: var(--text-inverse);
}

.upload-token-btn-accent:hover:not(:disabled) {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
}

.upload-token-btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.upload-token-btn-cancel:hover {
  color: var(--text-primary);
}

.upload-token-limit-warn {
  margin-top: 12px;
  text-align: center;
  color: var(--danger);
  font-size: 0.8rem;
}

@media (max-width: 480px) {
  .upload-token-card { padding: 20px; }
}
</style>
