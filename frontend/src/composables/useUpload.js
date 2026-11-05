import { ref } from 'vue'
import { uploadFile, uploadChunk, mergeChunks, fetchFiles } from '../api/fileApi.js'
import { useToast } from './useToast.js'
import { useConfirmDialog } from './useConfirmDialog.js'
import { isLAN } from '../utils/helpers.js'

const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB
const BYTES_PER_MB = 1024 * 1024
const UPLOAD_CONCURRENCY = 3   // 文件级并发数
const CHUNK_CONCURRENCY = 2    // 单文件内分片并发数

export function useUpload() {
  const uploading = ref(false)
  const uploadProgress = ref(0)
  const uploadStatus = ref('')
  const uploadFiles = ref([])

  // 速度/剩余时间
  const uploadSpeed = ref(0)      // MB/s
  const uploadEta = ref('')       // 格式化后的剩余时间
  const rawSpeed = ref(0)         // 原始瞬时速度 (bytes/s)

  const toast = useToast()
  const { confirm } = useConfirmDialog()

  const SPEED_SAMPLES = 5        // 移动平均窗口（更小，反应更快）
  const SPEED_LOW_PASS = 0.4     // 低通滤波因子（瞬时速度权重）

  let uploadSeq = 0 // 队列项稳定 id（v-for key，删除中间项不干扰动画）

  /**
   * 追加待上传文件（不清空已有队列，支持在弹窗内逐次添加）。
   * 同名同大小同修改时间的重复文件自动跳过。
   */
  function addFiles(files) {
    const incoming = Array.from(files)
    if (incoming.length === 0) return
    const existing = new Set(
      uploadFiles.value.map((f) => `${f.file.name}|${f.file.size}|${f.file.lastModified ?? ''}`)
    )
    let skipped = 0
    for (const f of incoming) {
      const key = `${f.name}|${f.size}|${f.lastModified ?? ''}`
      if (existing.has(key)) {
        skipped++
        continue
      }
      existing.add(key)
      uploadFiles.value.push({
        uid: ++uploadSeq,
        file: f,
        name: f.name,
        size: f.size,
        status: 'waiting', // waiting | uploading | success | error | skipped
        overwrite: false   // 重名冲突时用户选择"覆盖"则置 true
      })
    }
    if (skipped > 0) toast.info(`已忽略 ${skipped} 个重复添加的文件`)
  }

  /** 移除单个待上传项（上传中的条目由 worker 持有引用，不可移除） */
  function removeFile(item) {
    if (item.status === 'uploading') return
    const idx = uploadFiles.value.indexOf(item)
    if (idx === -1) return
    uploadFiles.value.splice(idx, 1)
    if (uploadFiles.value.length === 0) {
      uploadProgress.value = 0
      uploadStatus.value = ''
      uploadSpeed.value = 0
      uploadEta.value = ''
    }
  }

  function clearFiles() {
    uploadFiles.value = []
    uploadProgress.value = 0
    uploadStatus.value = ''
    uploadSpeed.value = 0
    uploadEta.value = ''
  }

  /**
   * 批量冲突预检：对所有 waiting 且与服务端同名的文件，弹窗让用户选择
   * 覆盖（删除旧文件保留新文件）/ 保留两个（自动改名共存）/ 取消（跳过该文件）。
   * 多个冲突时可勾选"应用到全部"一次性处理。
   */
  async function resolveConflicts() {
    const waiting = uploadFiles.value.filter(f => f.status === 'waiting')
    if (waiting.length === 0) return

    let existingNames
    try {
      const files = await fetchFiles()
      existingNames = new Set(files.map(f => f.name))
    } catch (err) {
      toast.error('检查文件冲突失败，将按"保留两个"继续上传')
      return
    }

    const conflicts = waiting.filter(f => existingNames.has(f.name))
    if (conflicts.length === 0) return

    let remembered = null // 记住的批量选择 { action }，checked 后对所有剩余冲突生效

    for (let i = 0; i < conflicts.length; i++) {
      const item = conflicts[i]
      if (remembered) {
        applyConflictAction(item, remembered)
        continue
      }

      const remaining = conflicts.length - i
      const message = remaining > 1
        ? `文件 "${item.name}" 已存在，如何处理？\n（还有 ${remaining - 1} 个文件同名冲突）`
        : `文件 "${item.name}" 已存在，如何处理？`

      const result = await confirm(message, {
        title: '文件冲突',
        confirmText: '覆盖',
        thirdText: '保留两个',
        cancelText: '取消',
        checkboxLabel: remaining > 1 ? '对本批次所有冲突文件应用此选择' : '',
        variant: 'warning'
      })

      let action, checked = false
      if (result && typeof result === 'object') {
        action = result.action
        checked = result.applyAll
      } else {
        action = result
      }

      const mapped = { action: action === 'confirm' ? 'overwrite' : action === 'third' ? 'rename' : 'skip' }
      applyConflictAction(item, mapped)
      if (checked) remembered = mapped
    }
  }

  function applyConflictAction(item, { action }) {
    if (action === 'overwrite') {
      item.overwrite = true
      item.status = 'waiting'
    } else if (action === 'rename') {
      item.overwrite = false
      item.status = 'waiting'
    } else {
      item.status = 'skipped'
    }
  }

  /**
   * 重试单个失败的上传项
   */
  async function retryItem(item) {
    if (!item.file || item.status !== 'error') return
    item.status = 'waiting'
    item.progress = 0

    // 如果当前没有在上传，启动上传
    if (!uploading.value) {
      await startUpload()
    }
  }

  /**
   * 重试所有失败的上传项
   */
  async function retryAll() {
    const failedItems = uploadFiles.value.filter(f => f.status === 'error')
    if (failedItems.length === 0) return

    failedItems.forEach(item => {
      item.status = 'waiting'
      item.progress = 0
    })

    if (!uploading.value) {
      await startUpload()
    }
  }

  /**
   * 计算瞬时速度（基于最近两个数据点）
   */
  function calcInstantSpeed(speedHistory, deltaLoaded, deltaTime) {
    if (deltaTime <= 0) return 0
    const instant = deltaLoaded / deltaTime // bytes/s

    // 记录样本
    speedHistory.push(instant)
    if (speedHistory.length > SPEED_SAMPLES) speedHistory.shift()

    // 计算移动平均（低通滤波，对瞬时速度更敏感）
    if (speedHistory.length === 0) return 0

    // 加权平均：最近的数据权重更大
    let weightedSum = 0
    let weightTotal = 0
    for (let i = 0; i < speedHistory.length; i++) {
      const weight = i + 1 // 越新的样本权重越高
      weightedSum += speedHistory[i] * weight
      weightTotal += weight
    }
    const smoothAvg = weightedSum / weightTotal

    // 混合瞬时和平均（避免速度突变）
    return smoothAvg * (1 - SPEED_LOW_PASS) + instant * SPEED_LOW_PASS
  }

  /**
   * 格式化剩余时间
   */
  function formatEta(instSpeed, remainingBytes) {
    if (!(instSpeed > 0) || !(remainingBytes > 0) || remainingBytes >= 86400 * BYTES_PER_MB) return ''
    const etaSeconds = remainingBytes / instSpeed
    if (!(etaSeconds > 0) || etaSeconds >= 86400) return ''
    if (etaSeconds >= 3600) return `${Math.round(etaSeconds / 3600)}h ${Math.round((etaSeconds % 3600) / 60)}m`
    if (etaSeconds >= 60) return `${Math.round(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`
    return `${Math.round(etaSeconds)}s`
  }

  /**
   * 并发池：以固定并发数依次消费任务队列
   */
  async function runPool(items, worker, concurrency) {
    let index = 0
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++]
        await worker(current)
      }
    })
    await Promise.all(runners)
  }

  /**
   * 并发进度汇总器：按 item 聚合已上传字节，统一驱动 速度/ETA/总进度
   */
  function createProgressAggregator(totalBytes) {
    const speedHistory = []
    const loadedMap = new Map() // item -> 已上传字节
    let lastCumulative = 0
    let lastTime = Date.now()

    return function tick(item, loaded, label) {
      loadedMap.set(item, loaded)
      const cumulative = [...loadedMap.values()].reduce((a, b) => a + b, 0)
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      const deltaLoaded = cumulative - lastCumulative

      if (deltaTime > 0.05 && deltaLoaded >= 0) {
        const instSpeed = calcInstantSpeed(speedHistory, deltaLoaded, deltaTime)
        rawSpeed.value = instSpeed
        uploadSpeed.value = Math.round((instSpeed / BYTES_PER_MB) * 100) / 100
        uploadEta.value = formatEta(instSpeed, totalBytes - cumulative)
        lastCumulative = cumulative
        lastTime = now
      }

      const overall = Math.min(100, Math.round((cumulative / totalBytes) * 100))
      uploadProgress.value = overall
      uploadStatus.value = `上传中 ${overall}% (${label || item.name})`
      if (rawSpeed.value > 0) {
        const displaySpeed = Math.round((rawSpeed.value / BYTES_PER_MB) * 100) / 100
        uploadStatus.value += ` — ${displaySpeed.toFixed(1)} MB/s`
      }
    }
  }

  function finishStatus() {
    const successCount = uploadFiles.value.filter(f => f.status === 'success').length
    const skippedCount = uploadFiles.value.filter(f => f.status === 'skipped').length
    const errorCount = uploadFiles.value.filter(f => f.status === 'error').length
    let statusMsg = errorCount > 0 ? `部分文件上传失败 (${successCount} 成功 / ${errorCount} 失败)` : `上传成功 (${successCount} 个)`
    if (skippedCount > 0) statusMsg += `，${skippedCount} 个已跳过`
    uploadStatus.value = statusMsg
    uploadProgress.value = errorCount > 0 ? uploadProgress.value : 100
    uploadSpeed.value = 0
    uploadEta.value = ''
    rawSpeed.value = 0
  }

  async function startUpload() {
    if (uploadFiles.value.length === 0) return false
    uploading.value = true

    // 重置进度（保留已成功的）
    let hasActiveItems = false
    for (const item of uploadFiles.value) {
      if (item.status === 'waiting') {
        hasActiveItems = true
      }
    }
    if (!hasActiveItems) {
      uploading.value = false
      return false
    }

    await resolveConflicts()

    const activeFiles = uploadFiles.value.filter(f => f.status === 'waiting')
    if (activeFiles.length === 0) {
      uploading.value = false
      toast.info('已取消，未上传任何文件')
      return false
    }

    // 内网：直接整文件上传；外网：分片上传（避免大文件超时）
    if (isLAN()) {
      return await uploadDirect(activeFiles)
    } else {
      return await uploadChunked(activeFiles)
    }
  }

  /**
   * 内网上传：直接整文件 POST /api/upload
   * 速度更快，无分片/合并开销；多文件并发上传
   */
  async function uploadDirect(activeFiles) {
    const totalBytes = activeFiles.reduce((s, f) => s + f.file.size, 0)
    const tick = createProgressAggregator(totalBytes)
    let hasError = false

    try {
      await runPool(activeFiles, async (item) => {
        item.status = 'uploading'

        const formData = new FormData()
        formData.append('files', item.file)
        if (item.overwrite) formData.append('overwrite', 'true')

        try {
          const result = await uploadFile(formData, (loaded) => tick(item, loaded))
          const r0 = result && Array.isArray(result.results) ? result.results[0] : null
          if (r0 && r0.success === false) {
            item.status = 'error'
            item.error = r0.error || '上传失败'
            hasError = true
          } else {
            // 记录后端返回的最终文件名（"保留两个"时可能被改名 name(1).ext）
            if (r0 && r0.name) item.name = r0.name
            item.status = 'success'
            tick(item, item.file.size)
          }
        } catch (err) {
          item.status = 'error'
          item.error = err.message
          hasError = true
        }
      }, UPLOAD_CONCURRENCY)

      finishStatus()
      if (hasError) toast.error('部分文件上传失败，可手动重试')
      return !hasError
    } catch (err) {
      uploadStatus.value = `上传失败: ${err.message}`
      uploadFiles.value.forEach((item) => {
        if (item.status === 'uploading') item.status = 'error'
        if (item.status === 'waiting') item.status = 'error'
      })
      toast.error('上传中断，失败的文件可手动重试')
      return false
    } finally {
      uploading.value = false
    }
  }

  /**
   * 外网上传：1MB 分片上传，避免大文件超时；文件级并发 + 文件内分片并发
   */
  async function uploadChunked(activeFiles) {
    const totalBytes = activeFiles.reduce((s, f) => s + f.file.size, 0)
    const tick = createProgressAggregator(totalBytes)
    let hasError = false

    try {
      await runPool(activeFiles, async (item) => {
        const file = item.file
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
        const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}-${Math.random().toString(36).slice(2)}`
        item.status = 'uploading'

        const chunkLoaded = new Array(totalChunks).fill(0)
        const chunkIndexes = Array.from({ length: totalChunks }, (_, i) => i)

        try {
          await runPool(chunkIndexes, async (chunkIndex) => {
            const start = chunkIndex * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, file.size)
            const chunk = file.slice(start, end)

            const formData = new FormData()
            formData.append('fileId', fileId)
            formData.append('chunkIndex', chunkIndex)
            formData.append('totalChunks', totalChunks)
            formData.append('fileName', file.name)
            formData.append('chunk', chunk)

            await uploadChunk(formData, (loaded) => {
              chunkLoaded[chunkIndex] = loaded
              const fileLoaded = chunkLoaded.reduce((a, b) => a + b, 0)
              tick(item, fileLoaded)
            })
          }, CHUNK_CONCURRENCY)

          const mergeResult = await mergeChunks(fileId, file.name, totalChunks, item.overwrite)
          if (mergeResult && mergeResult.name) {
            item.name = mergeResult.name
          }
          item.status = 'success'
          tick(item, file.size)
        } catch (err) {
          item.status = 'error'
          item.error = err.message
          hasError = true
        }
      }, UPLOAD_CONCURRENCY)

      finishStatus()
      if (hasError) toast.error('部分文件上传失败，可手动重试')
      return !hasError
    } catch (err) {
      uploadStatus.value = `上传失败: ${err.message}`
      uploadFiles.value.forEach((item) => {
        if (item.status === 'uploading') item.status = 'error'
        if (item.status === 'waiting') item.status = 'error'
      })
      toast.error('上传中断，失败的文件可手动重试')
      return false
    } finally {
      uploading.value = false
    }
  }

  return {
    uploading,
    uploadProgress,
    uploadStatus,
    uploadSpeed,
    uploadEta,
    rawSpeed,
    uploadFiles,
    addFiles,
    removeFile,
    clearFiles,
    startUpload,
    retryItem,
    retryAll,
  }
}
