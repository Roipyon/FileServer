<template>
  <Teleport to="body">
    <Transition name="zip-fade">
      <div class="zip-backdrop" @click.self="handleBackdropClick">
        <Transition name="zip-scale" appear>
          <div class="zip-card">

            <!-- ====== 阶段一：命名与启动 ====== -->
            <template v-if="phase === 'input'">
              <div class="zip-header">
                <div class="zip-header-icon">
                  <i class="fas fa-file-zipper"></i>
                </div>
                <h3>打包下载</h3>
              </div>

              <p class="zip-hint">
                已选择 <strong>{{ selectedCount }}</strong> 个文件
                <span v-if="selectedCount > MAX_FILES" class="zip-hint-warn">
                  （最多 {{ MAX_FILES }} 个）
                </span>
              </p>

              <div class="zip-name-field">
                <label>压缩包名称</label>
                <div class="zip-name-input-wrap">
                  <input
                    v-model="zipNameBase"
                    type="text"
                    class="zip-name-input"
                    placeholder="输入文件名..."
                    @keydown.enter.prevent="startPack"
                  />
                  <span class="zip-name-ext">.zip</span>
                </div>
              </div>

              <div class="zip-actions">
                <button class="zip-btn zip-btn-cancel" @click="emit('close')">取消</button>
                <button
                  class="zip-btn zip-btn-accent"
                  :disabled="!canStart || starting || selectedCount > MAX_FILES"
                  @click="startPack"
                >
                  <i v-if="starting" class="fas fa-spinner fa-spin"></i>
                  <i v-else class="fas fa-download"></i>
                  {{ starting ? '准备中...' : '开始打包' }}
                </button>
              </div>
            </template>

            <!-- ====== 阶段二：打包进度 ====== -->
            <template v-if="phase === 'packing'">
              <div class="zip-header">
                <div class="zip-header-icon zip-header-icon-active">
                  <i class="fas fa-gear fa-spin"></i>
                </div>
                <h3>正在打包...</h3>
              </div>

              <div class="zip-progress-section">
                <div class="zip-progress-bar">
                  <div
                    class="zip-progress-fill"
                    :style="{ width: progressPercent + '%' }"
                  ></div>
                </div>
                <div class="zip-progress-text">
                  <span class="zip-progress-pct">{{ progressPercent }}%</span>
                  <span class="zip-progress-count">
                    <template v-if="progress.totalFiles > 0">
                      已处理 {{ progress.processedFiles }} / {{ progress.totalFiles }} 个文件
                    </template>
                    <template v-else>
                      正在处理...
                    </template>
                  </span>
                </div>
              </div>

              <div class="zip-current-file" v-if="progress.currentFile">
                <i class="fas fa-file"></i>
                <span class="zip-current-file-name">{{ progress.currentFile }}</span>
              </div>

              <div class="zip-actions">
                <button class="zip-btn zip-btn-cancel" @click="confirmCancel">
                  <i class="fas fa-ban"></i> 取消打包
                </button>
              </div>
            </template>

            <!-- ====== 阶段三：打包完成 ====== -->
            <template v-if="phase === 'done'">
              <div class="zip-header">
                <div class="zip-header-icon zip-header-icon-done">
                  <i class="fas fa-check-circle"></i>
                </div>
                <h3>打包完成</h3>
              </div>

              <div class="zip-done-info">
                <template v-if="progress.totalFiles === 0">
                  <p>没有找到有效文件，创建的压缩包为空。</p>
                </template>
                <template v-else>
                  <p>
                    共打包 <strong>{{ progress.totalFiles }}</strong> 个文件，
                    即将开始下载 <strong>{{ progress.zipName }}</strong>
                  </p>
                  <p v-if="progress.skippedFiles > 0" class="zip-done-warn">
                    <i class="fas fa-exclamation-triangle"></i>
                    {{ progress.skippedFiles }} 个文件不存在或无效，已跳过
                  </p>
                </template>
              </div>

              <div class="zip-actions">
                <button class="zip-btn zip-btn-accent" @click="downloadNow" :disabled="downloading">
                  <i v-if="downloading" class="fas fa-spinner fa-spin"></i>
                  <i v-else class="fas fa-download"></i>
                  {{ downloading ? '下载中...' : '立即下载' }}
                </button>
                <button class="zip-btn zip-btn-cancel" @click="emit('close')">关闭</button>
              </div>
            </template>

            <!-- ====== 错误状态 ====== -->
            <template v-if="phase === 'error'">
              <div class="zip-header">
                <div class="zip-header-icon zip-header-icon-error">
                  <i class="fas fa-circle-exclamation"></i>
                </div>
                <h3>打包失败</h3>
              </div>

              <div class="zip-error-msg">
                <i class="fas fa-triangle-exclamation"></i>
                <span>{{ errorMessage }}</span>
              </div>

              <div class="zip-actions">
                <button class="zip-btn zip-btn-accent" @click="reset">重试</button>
                <button class="zip-btn zip-btn-cancel" @click="emit('close')">关闭</button>
              </div>
            </template>

            <!-- ====== 轮询超时警告（内嵌在 packing 阶段） ====== -->
            <div v-if="phase === 'packing' && pollingSlow" class="zip-slow-hint">
              <i class="fas fa-hourglass-half"></i>
              打包时间较长，请耐心等待...
            </div>

          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useFileManager } from '../composables/useFileManager.js'
import { useToast } from '../composables/useToast.js'
import { startZipTask, getZipProgress, getZipDownloadUrl, cancelZipTask } from '../api/fileApi.js'

const emit = defineEmits(['close'])
const { state } = useFileManager()
const toast = useToast()

// ==================== 常量 ====================
const MAX_FILES = 1000          // 与后端一致
const POLL_INTERVAL = 500       // 轮询间隔 ms
const POLL_TIMEOUT = 120_000    // 轮询超时 ms（2 分钟）
const SLOW_THRESHOLD = 15_000   // "较慢"提示阈值 ms

// ==================== 状态 ====================
const phase = ref('input') // input | packing | done | error
const starting = ref(false)
const downloading = ref(false)
const errorMessage = ref('')

const zipNameBase = ref('')
const taskId = ref(null)
const taskInfo = ref({})

let pollTimer = null
let pollStartTime = 0
const pollingSlow = ref(false)

// ==================== 计算属性 ====================
const selectedCount = computed(() => state.selectedFiles.size)

const canStart = computed(() => {
  if (zipNameBase.value.trim().length === 0) return false
  if (selectedCount.value === 0) return false
  return true
})

const progressPercent = computed(() => {
  return Math.max(taskInfo.value.percent || 0, 1)
})

const progress = computed(() => ({
  percent: taskInfo.value.percent || 0,
  totalFiles: taskInfo.value.totalFiles || 0,
  processedFiles: taskInfo.value.processedFiles || 0,
  skippedFiles: taskInfo.value.skippedFiles || 0,
  currentFile: taskInfo.value.currentFile || '',
  zipName: taskInfo.value.zipName || ''
}))

// ==================== 完整 ZIP 文件名 ====================
const fullZipName = computed(() => {
  return zipNameBase.value ? `${zipNameBase.value}.zip` : ''
})

// ==================== 方法 ====================

/**
 * 格式化时间戳，生成默认文件名
 */
function generateDefaultName() {
  const now = new Date()
  const y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `FileServer_${y}${M}${d}_${h}${m}${s}`
}

/**
 * 开始打包
 */
async function startPack() {
  const files = [...state.selectedFiles]
  if (files.length === 0) {
    toast.warning('请先选择文件')
    emit('close')
    return
  }

  if (files.length > MAX_FILES) {
    toast.warning(`一次最多打包 ${MAX_FILES} 个文件`)
    return
  }

  starting.value = true
  try {
    const result = await startZipTask(files, fullZipName.value)
    taskId.value = result.taskId
    taskInfo.value = {
      percent: 0,
      totalFiles: result.totalFiles,
      processedFiles: 0,
      currentFile: '',
      zipName: result.zipName
    }
    phase.value = 'packing'
    startPolling()
  } catch (err) {
    toast.error(`创建打包任务失败: ${err.message}`)
    phase.value = 'error'
    errorMessage.value = err.message
  } finally {
    starting.value = false
  }
}

/**
 * 轮询进度（含超时检测）
 */
function startPolling() {
  stopPolling()
  pollStartTime = Date.now()
  pollingSlow.value = false

  pollTimer = setInterval(async () => {
    if (!taskId.value) return

    // 超时检测
    const elapsed = Date.now() - pollStartTime
    if (elapsed > POLL_TIMEOUT) {
      stopPolling()
      phase.value = 'error'
      errorMessage.value = '打包超时，请重试（服务器负载过高或文件过大）'
      toast.error('打包超时')
      return
    }

    // "较慢"提示
    if (elapsed > SLOW_THRESHOLD && !pollingSlow.value) {
      pollingSlow.value = true
    }

    try {
      const info = await getZipProgress(taskId.value)
      taskInfo.value = info

      if (info.state === 'completed') {
        stopPolling()
        phase.value = 'done'
        // 自动触发下载（但空 ZIP 不自动下载）
        if (info.totalFiles > 0) {
          await autoDownload()
        } else {
          // 空结果提示用户手动决定
          toast.info('没有有效文件，压缩包为空')
        }
      } else if (info.state === 'error') {
        stopPolling()
        phase.value = 'error'
        errorMessage.value = info.error || '打包过程出错'
        toast.error('打包出错')
      } else if (info.state === 'cancelled') {
        stopPolling()
        phase.value = 'error'
        errorMessage.value = '任务已被取消'
      }
    } catch (err) {
      // 连续失败 3 次以上给用户提示
      toast.error('轮询进度失败:', err)
    }
  }, POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * 自动下载
 */
async function autoDownload() {
  if (!taskId.value) return
  await nextTick()
  await triggerDownload()
}

/**
 * 手动下载
 */
async function downloadNow() {
  downloading.value = true
  try {
    await triggerDownload()
  } finally {
    downloading.value = false
  }
}

/**
 * 执行下载
 */
async function triggerDownload() {
  if (!taskId.value) return

  const downloadUrl = getZipDownloadUrl(taskId.value)
  const zipName = progress.value.zipName || 'files.zip'

  try {
    // 尝试使用 fetch + Blob 方式（支持自定义文件名）
    const res = await fetch(downloadUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = zipName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 60000)

    // 浏览器通知
    sendNotification(`「${zipName}」下载已开始`)

    toast.success(`打包完成，开始下载 ${zipName}`)
  } catch (err) {
    // Blob 失败降级为 location.href
    toast.error('Blob 下载失败，降级为直接跳转:', err)
    window.location.href = downloadUrl

    toast.success(`打包完成，正在下载 ${zipName}`)
  }
}

/**
 * 取消打包
 */
async function confirmCancel() {
  if (!taskId.value) return
  try {
    await cancelZipTask(taskId.value)
  } catch (err) {
    toast.error('取消失败:', err)
  }
  stopPolling()
  toast.info('已取消打包')
  emit('close')
}

/**
 * 浏览器通知
 */
function sendNotification(body) {
  if (!('Notification' in window)) return false

  if (Notification.permission === 'granted') {
    try {
      new Notification('FileServer - 打包完成', { body, icon: '/favicon.ico' })
      return true
    } catch (e) {
      return false
    }
  }

  if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        try {
          new Notification('FileServer - 打包完成', { body, icon: '/favicon.ico' })
        } catch (e) { /* ignore */ }
      }
    })
  }

  return false
}

/**
 * 重置到输入状态
 */
function reset() {
  phase.value = 'input'
  taskId.value = null
  taskInfo.value = {}
  errorMessage.value = ''
  pollingSlow.value = false
}

/**
 * 点击背景关闭
 */
function handleBackdropClick() {
  if (phase.value === 'packing') {
    // 打包中不关闭（防止误操作丢失进度）
    return
  }
  emit('close')
}

// ==================== 生命周期 ====================
onMounted(() => {
  zipNameBase.value = generateDefaultName()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
/* Backdrop */
.zip-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(4px);
}

/* Card */
.zip-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 32px;
  max-width: 480px;
  width: 90%;
}

/* Header */
.zip-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.zip-header-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  color: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.zip-header-icon-active {
  background: rgba(200, 132, 60, 0.15);
  animation: pulseGlow 1.5s ease-in-out infinite;
}

.zip-header-icon-done {
  background: rgba(76, 175, 80, 0.15);
  color: #4caf50;
}

.zip-header-icon-error {
  background: rgba(196, 85, 77, 0.15);
  color: var(--danger);
}

.zip-header h3 {
  font-family: 'Playfair Display', serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* Hint */
.zip-hint {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 20px;
  line-height: 1.5;
}

.zip-hint strong {
  color: var(--accent-glow);
}

.zip-hint-warn {
  color: var(--danger);
  font-size: 0.8rem;
}

/* Name field */
.zip-name-field {
  margin-bottom: 24px;
}

.zip-name-field label {
  display: block;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.zip-name-input-wrap {
  display: flex;
  align-items: center;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.zip-name-input-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 20px var(--accent-glow-subtle);
}

.zip-name-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  padding: 10px 12px;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.zip-name-input::placeholder {
  color: var(--text-muted);
}

.zip-name-ext {
  padding: 10px 12px 10px 0;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.9rem;
  color: var(--text-muted);
  user-select: none;
}

/* Progress section */
.zip-progress-section {
  margin: 20px 0;
}

.zip-progress-bar {
  height: 8px;
  background: var(--bg-deep);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.zip-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--accent-glow));
  border-radius: 4px;
  transition: width 300ms ease-out;
}

.zip-progress-text {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.zip-progress-pct {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent-glow);
}

.zip-progress-count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Current file */
.zip-current-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-deep);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
  overflow: hidden;
}

.zip-current-file i {
  color: var(--text-muted);
  font-size: 0.8rem;
  flex-shrink: 0;
}

.zip-current-file-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Slow hint */
.zip-slow-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(200, 132, 60, 0.1);
  border-radius: var(--radius-md);
  font-size: 0.8rem;
  color: var(--accent-glow);
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Done info */
.zip-done-info {
  background: var(--bg-deep);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 24px;
}

.zip-done-info p {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.zip-done-info p + p {
  margin-top: 8px;
}

.zip-done-info strong {
  color: var(--accent-glow);
}

.zip-done-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--danger) !important;
  font-size: 0.8rem !important;
}

.zip-done-warn i {
  flex-shrink: 0;
}

/* Error message */
.zip-error-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: rgba(196, 85, 77, 0.1);
  border: 1px solid rgba(196, 85, 77, 0.2);
  border-radius: var(--radius-md);
  margin-bottom: 24px;
  color: var(--danger);
  font-size: 0.85rem;
}

.zip-error-msg i {
  font-size: 1rem;
  flex-shrink: 0;
}

/* Actions */
.zip-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.zip-btn {
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--duration-normal) var(--ease-out-expo);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.zip-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

.zip-btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.zip-btn-cancel:hover {
  color: var(--text-primary);
  background: var(--border-glow);
}

.zip-btn-accent {
  background: var(--accent);
  color: var(--text-inverse);
}
.zip-btn-accent:hover:not(:disabled) {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
  transform: translateY(-1px);
}

/* Animations */
@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(200, 132, 60, 0.2); }
  50% { box-shadow: 0 0 16px 4px rgba(200, 132, 60, 0.15); }
}

/* Transitions */
.zip-fade-enter-active,
.zip-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.zip-fade-enter-from,
.zip-fade-leave-to {
  opacity: 0;
}

.zip-scale-enter-active {
  transition: all 250ms var(--ease-spring);
}
.zip-scale-leave-active {
  transition: all 200ms var(--ease-out-expo);
}
.zip-scale-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.zip-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Responsive */
@media (max-width: 768px) {
  .zip-card {
    padding: 24px;
  }
  .zip-actions {
    flex-wrap: wrap;
  }
  .zip-btn {
    flex: 1;
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .zip-card {
    padding: 20px;
    width: 95%;
  }
  .zip-header h3 {
    font-size: 1.05rem;
  }
}
</style>
