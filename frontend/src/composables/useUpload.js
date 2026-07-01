import { ref } from 'vue'
import { uploadFile, uploadChunk, mergeChunks, fetchFiles } from '../api/fileApi.js'
import { useToast } from './useToast.js'
import { useConfirmDialog } from './useConfirmDialog.js'
import { isLAN } from '../utils/helpers.js'

const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB
const BYTES_PER_MB = 1024 * 1024

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

  function addFiles(files) {
    uploadFiles.value = Array.from(files).map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      status: 'waiting' // waiting | uploading | success | error | skipped
    }))
  }

  function clearFiles() {
    uploadFiles.value = []
    uploadProgress.value = 0
    uploadStatus.value = ''
    uploadSpeed.value = 0
    uploadEta.value = ''
  }

  /**
   * 上传前检查是否存在同名文件
   * @param {string} fileName
   * @returns {Promise<boolean>} true = 用户确认覆盖，false = 取消上传
   */
  async function checkConflict(fileName) {
    try {
      const files = await fetchFiles()
      const exists = files.some(f => f.name === fileName)
      if (!exists) return true

      const ok = await confirm(
        `文件 "${fileName}" 已存在，是否覆盖？\n（选择"保留"将取消此文件的上传）`,
        {
          title: '文件冲突',
          confirmText: '覆盖',
          cancelText: '保留',
          variant: 'warning'
        }
      )
      return ok // true=覆盖, false=保留
    } catch (err) {
      toast.error('检查文件冲突失败，继续上传:', err)
      return true
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

    // 冲突检查（只检查 waiting 状态的文件）
    for (const item of uploadFiles.value) {
      if (item.status === 'waiting') {
        const proceed = await checkConflict(item.name)
        if (!proceed) {
          item.status = 'skipped'
        }
      }
    }

    const activeFiles = uploadFiles.value.filter(f => f.status === 'waiting')
    if (activeFiles.length === 0) {
      uploading.value = false
      toast.info('所有文件已保留，未上传任何文件')
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
   * 速度更快，无分片/合并开销
   */
  async function uploadDirect(activeFiles) {
    const speedHistory = []
    let lastLoaded = 0
    let lastTime = Date.now()

    const totalBytes = activeFiles.reduce((s, f) => s + f.file.size, 0)
    let uploadedBytes = 0

    try {
      for (let i = 0; i < activeFiles.length; i++) {
        const item = activeFiles[i]
        item.status = 'uploading'

        const formData = new FormData()
        formData.append('files', item.file)

        await uploadFile(formData, (loaded, total) => {
          const now = Date.now()
          const deltaTime = (now - lastTime) / 1000
          const deltaLoaded = loaded - lastLoaded

          if (deltaTime > 0.05 && deltaLoaded >= 0) {
            const instSpeed = calcInstantSpeed(speedHistory, deltaLoaded, deltaTime)
            rawSpeed.value = instSpeed
            uploadSpeed.value = Math.round((instSpeed / BYTES_PER_MB) * 100) / 100

            const cumulativeBytes = uploadedBytes + loaded

            const remainingBytes = totalBytes - cumulativeBytes
            if (instSpeed > 0 && remainingBytes > 0 && remainingBytes < 86400 * BYTES_PER_MB) {
              const etaSeconds = remainingBytes / instSpeed
              if (etaSeconds > 0 && etaSeconds < 86400) {
                if (etaSeconds >= 3600) {
                  uploadEta.value = `${Math.round(etaSeconds / 3600)}h ${Math.round((etaSeconds % 3600) / 60)}m`
                } else if (etaSeconds >= 60) {
                  uploadEta.value = `${Math.round(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`
                } else {
                  uploadEta.value = `${Math.round(etaSeconds)}s`
                }
              } else {
                uploadEta.value = ''
              }
            } else {
              uploadEta.value = ''
            }
          }

          lastLoaded = loaded
          lastTime = now

          const progress = uploadedBytes + loaded
          const overall = Math.round((progress / totalBytes) * 100)
          uploadProgress.value = Math.min(overall, 100)
          uploadStatus.value = `上传中 ${overall}% (${item.name})`

          if (rawSpeed.value > 0) {
            const displaySpeed = Math.round((rawSpeed.value / BYTES_PER_MB) * 100) / 100
            uploadStatus.value += ` — ${displaySpeed.toFixed(1)} MB/s`
          }
        })

        item.status = 'success'
        uploadedBytes += item.file.size
      }

      const successCount = uploadFiles.value.filter(f => f.status === 'success').length
      const skippedCount = uploadFiles.value.filter(f => f.status === 'skipped').length
      let statusMsg = `上传成功 (${successCount} 个)`
      if (skippedCount > 0) statusMsg += `，${skippedCount} 个已保留`
      uploadStatus.value = statusMsg
      uploadProgress.value = 100
      uploadSpeed.value = 0
      uploadEta.value = ''
      rawSpeed.value = 0
      return true
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
   * 外网上传：1MB 分片上传，避免大文件超时
   */
  async function uploadChunked(activeFiles) {
    const speedHistory = []
    let lastLoaded = 0
    let lastTime = Date.now()
    let cumulativeBytes = 0

    const totalBytes = activeFiles.reduce((s, f) => s + f.file.size, 0)
    let uploadedBytes = 0

    try {
      for (let i = 0; i < activeFiles.length; i++) {
        const item = activeFiles[i]
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
            const now = Date.now()
            const deltaTime = (now - lastTime) / 1000
            const deltaLoaded = loaded - lastLoaded

            if (deltaTime > 0.05 && deltaLoaded >= 0) {
              const instSpeed = calcInstantSpeed(speedHistory, deltaLoaded, deltaTime)
              rawSpeed.value = instSpeed
              uploadSpeed.value = Math.round((instSpeed / BYTES_PER_MB) * 100) / 100

              const chunkProgress = start + loaded
              cumulativeBytes = uploadedBytes + chunkProgress

              const remainingBytes = totalBytes - cumulativeBytes
              if (instSpeed > 0 && remainingBytes > 0 && remainingBytes < 86400 * BYTES_PER_MB) {
                const etaSeconds = remainingBytes / instSpeed
                if (etaSeconds > 0 && etaSeconds < 86400) {
                  if (etaSeconds >= 3600) {
                    uploadEta.value = `${Math.round(etaSeconds / 3600)}h ${Math.round((etaSeconds % 3600) / 60)}m`
                  } else if (etaSeconds >= 60) {
                    uploadEta.value = `${Math.round(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`
                  } else {
                    uploadEta.value = `${Math.round(etaSeconds)}s`
                  }
                } else {
                  uploadEta.value = ''
                }
              } else {
                uploadEta.value = ''
              }
            }

            lastLoaded = loaded
            lastTime = now

            const chunkPct = (chunkIndex + loaded / total) / totalChunks
            const progress = uploadedBytes + (chunkPct * file.size)
            const overall = Math.round((progress / totalBytes) * 100)
            uploadProgress.value = Math.min(overall, 100)
            uploadStatus.value = `上传中 ${overall}% (${file.name})`

            if (rawSpeed.value > 0) {
              const displaySpeed = Math.round((rawSpeed.value / BYTES_PER_MB) * 100) / 100
              uploadStatus.value += ` — ${displaySpeed.toFixed(1)} MB/s`
            }
          })
        }

        const mergeResult = await mergeChunks(fileId, file.name, totalChunks)
        if (mergeResult && mergeResult.name) {
          item.name = mergeResult.name
        }
        item.status = 'success'
        uploadedBytes += file.size
      }

      const successCount = uploadFiles.value.filter(f => f.status === 'success').length
      const skippedCount = uploadFiles.value.filter(f => f.status === 'skipped').length
      let statusMsg = `上传成功 (${successCount} 个)`
      if (skippedCount > 0) statusMsg += `，${skippedCount} 个已保留`
      uploadStatus.value = statusMsg
      uploadProgress.value = 100
      uploadSpeed.value = 0
      uploadEta.value = ''
      rawSpeed.value = 0
      return true
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
    clearFiles,
    startUpload,
    retryItem,
    retryAll,
  }
}
