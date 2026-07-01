<template>
  <div class="connection-info">
    <!-- Backdrop -->
    <Transition name="conn-backdrop">
      <div v-if="visible" class="conn-backdrop" @click="close"></div>
    </Transition>

    <!-- Panel -->
    <Transition name="conn-panel">
      <div v-if="visible" class="conn-panel" @click.stop>
        <div class="conn-panel-header">
          <div class="conn-panel-title">
            <i class="fas fa-wifi"></i>
            <span>连接信息</span>
          </div>
          <button class="conn-close-btn" @click="close" title="关闭">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="conn-panel-body">
          <!-- Loading state -->
          <div v-if="state.loading" class="conn-loading">
            <div class="loading-spinner"></div>
            <p>正在获取连接信息...</p>
          </div>

          <!-- Error state -->
          <div v-else-if="state.error" class="conn-error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>{{ state.error }}</p>
            <button class="conn-retry-btn" @click="fetchWithReset">
              <i class="fas fa-rotate"></i> 重试
            </button>
          </div>

          <!-- Content -->
          <template v-else>
            <!-- Copied toast -->
            <Transition name="conn-toast">
              <div v-if="copied" class="conn-copied-toast">已复制</div>
            </Transition>

            <!-- Device info -->
            <div class="conn-hostname" v-if="state.hostname">
              设备: {{ state.hostname }}
            </div>

            <!-- ====== 区块一：固定公网地址 ====== -->
            <div class="conn-section" v-if="state.publicUrl">
              <div class="conn-section-title">
                <i class="fas fa-globe"></i> 固定公网地址
              </div>
              <div class="conn-url-card public">
                <div class="conn-url-card-body">
                  <div class="conn-url-info">
                    <div class="conn-url-label-row">
                      <span class="conn-url-badge public-badge">公网</span>
                      <span class="conn-url-type">PUBLIC_URL</span>
                    </div>
                    <div class="conn-url-row">
                      <span class="conn-url-text">{{ state.publicUrl }}</span>
                      <button class="conn-visit-btn" @click="visitUrl(state.publicUrl)" title="访问">
                        <i class="fas fa-arrow-up-right-from-square"></i>
                      </button>
                      <button class="conn-copy-btn" @click="doCopy(state.publicUrl)" title="复制">
                        <i class="fas fa-copy"></i>
                      </button>
                    </div>
                    <p class="conn-url-hint">通过环境变量配置的固定地址</p>
                  </div>
                  <div class="conn-qr-col" v-if="autoQRMap[state.publicUrl]">
                    <div class="conn-qr-mini-wrapper">
                      <img :src="autoQRMap[state.publicUrl]" alt="QR" class="conn-qr-mini-img" />
                    </div>
                  </div>
                  <div class="conn-qr-col conn-qr-loading" v-else>
                    <div class="loading-spinner"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ====== 区块二：自动检测到的访问地址 ====== -->
            <div class="conn-section">
              <div class="conn-section-title">
                <i class="fas fa-search"></i> 自动检测到的访问地址
              </div>

              <!-- IP URLs (带滚动，超过 5 个时限制高度) -->
              <div
                class="conn-url-list"
                :class="{ 'conn-url-list-scroll': totalAutoCount > 5 }"
                v-if="state.urls.length > 0"
              >
                <div
                  v-for="(url, index) in state.urls"
                  :key="url"
                  class="conn-url-card"
                  :class="{ recommended: index === 0 }"
                >
                  <div class="conn-url-card-body">
                    <div class="conn-url-info">
                      <div class="conn-url-label-row">
                        <span class="conn-url-type">IP {{ index + 1 }}</span>
                      </div>
                      <div class="conn-url-row">
                        <span class="conn-url-text">{{ url }}</span>
                        <button class="conn-visit-btn" @click="visitUrl(url)" title="访问">
                          <i class="fas fa-arrow-up-right-from-square"></i>
                        </button>
                        <button class="conn-copy-btn" @click="doCopy(url)" title="复制">
                          <i class="fas fa-copy"></i>
                        </button>
                      </div>
                    </div>
                    <div class="conn-qr-col" v-if="autoQRMap[url]">
                      <div class="conn-qr-mini-wrapper">
                        <img :src="autoQRMap[url]" alt="QR" class="conn-qr-mini-img" />
                      </div>
                    </div>
                    <div class="conn-qr-col conn-qr-loading" v-else>
                      <div class="loading-spinner"></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 无 IP 时的空状态 -->
              <div v-if="state.urls.length === 0" class="conn-empty-inline">
                <i class="fas fa-plug"></i>
                <span>未检测到网络连接</span>
              </div>
            </div>

            <!-- ====== 区块三：自定义地址（临时） ====== -->
            <div class="conn-section">
              <div class="conn-section-title">
                <i class="fas fa-pen-to-square"></i> 自定义地址（临时）
              </div>
              <p class="conn-section-desc">
                适用于 VSCode 端口转发、ngrok、frp 等临时公网地址
              </p>
              <div class="conn-custom-input-row">
                <input
                  v-model="customUrlInput"
                  type="text"
                  class="conn-custom-input"
                  placeholder="例如 https://xxx.ngrok.io"
                  @keydown.enter="addCustomEntry"
                />
                <button
                  class="conn-custom-btn"
                  @click="addCustomEntry"
                  :disabled="!customUrlInput.trim()"
                >
                  <i class="fas fa-qrcode"></i> 生成
                </button>
              </div>

              <!-- 自定义条目列表 -->
              <TransitionGroup name="conn-custom-list" tag="div" class="conn-custom-entries">
                <div
                  v-for="entry in customEntries"
                  :key="entry.id"
                  class="conn-url-card custom"
                >
                  <div class="conn-url-card-body">
                    <div class="conn-url-info">
                      <div class="conn-url-label-row">
                        <span class="conn-url-badge custom-badge">自定义</span>
                      </div>
                      <div class="conn-url-row">
                        <span class="conn-url-text">{{ entry.url }}</span>
                        <button class="conn-visit-btn" @click="visitUrl(entry.url)" title="访问">
                          <i class="fas fa-arrow-up-right-from-square"></i>
                        </button>
                        <button class="conn-copy-btn" @click="doCopy(entry.url)" title="复制">
                          <i class="fas fa-copy"></i>
                        </button>
                        <button class="conn-remove-btn" @click="removeCustomEntry(entry.id)" title="移除">
                          <i class="fas fa-xmark"></i>
                        </button>
                      </div>
                    </div>
                    <div class="conn-qr-col" v-if="entry.qrDataUrl">
                      <div class="conn-qr-mini-wrapper">
                        <img :src="entry.qrDataUrl" alt="QR" class="conn-qr-mini-img" />
                      </div>
                    </div>
                    <div class="conn-qr-col conn-qr-loading" v-else-if="entry.generating">
                      <div class="loading-spinner"></div>
                    </div>
                  </div>
                </div>
              </TransitionGroup>
            </div>

            <!-- 底部提示 -->
            <p class="conn-global-hint">
              <i class="fas fa-info-circle"></i>
              请根据当前网络环境选择一个可用的地址扫码访问
            </p>
          </template>
        </div>

        <div class="conn-panel-footer">
          <span>端口 {{ state.port || '—' }}</span>
          <button class="conn-refresh-btn" @click="fetchWithReset" title="刷新">
            <i class="fas fa-rotate"></i> 刷新
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import { useServerInfo } from '../composables/useServerInfo.js'
import { normalizeUrl, isLink } from '../utils/helpers.js'
import { useToast } from '../composables/useToast.js'

const toast = useToast()

const props = defineProps({
  visible: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const { state, fetchInfo, generateQR, collapse, copyUrl, resetCache } = useServerInfo()
const copied = ref(false)
let copyTimer = null

// 自动检测地址的 QR code map（url → dataUrl）
const autoQRMap = reactive({})

// 自定义地址条目
const customEntries = reactive([])
const customUrlInput = ref('')
let customIdCounter = 0

// 自动检测地址总数（IPs + publicUrl），用于判断是否需要滚动
const totalAutoCount = computed(() => {
  let count = state.urls.length
  return count
})

// 访问按钮
function visitUrl(url) {
  window.open(url, '_blank')
}

function close() {
  collapse()
  copied.value = false
  clearTimeout(copyTimer)
  emit('close')
}

async function fetchWithReset() {
  resetCache()
  // 清除旧 QR
  for (const key of Object.keys(autoQRMap)) {
    delete autoQRMap[key]
  }
  await fetchInfo(true)
  if (!state.error && !state.loading) {
    generateAllAutoQRs()
  }
}

async function doCopy(url) {
  const ok = await copyUrl(url)
  if (ok) {
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1200)
  }
}

// 为所有自动检测的 URL 生成 QR 码
async function generateAllAutoQRs() {
  // 清除所有旧的 QR 条目
  for (const key of Object.keys(autoQRMap)) {
    delete autoQRMap[key]
  }

  // 收集所有需要生成 QR 的 URL
  const targets = []
  for (const url of state.urls) {
    targets.push(url)
  }
  if (state.publicUrl) targets.push(state.publicUrl)

  if (targets.length === 0) return

  // 并行生成所有 QR 码
  const results = await Promise.all(targets.map(url => generateQR(url, 160)))
  targets.forEach((url, i) => {
    if (results[i]) {
      autoQRMap[url] = results[i]
    }
  })
}

// 添加自定义地址条目
async function addCustomEntry() {
  const url = customUrlInput.value.trim()
  if (!url) return

  // 验证输入是否为合法链接
  if (!isLink(url)) {
    toast.warn('请输入有效的链接地址（支持域名或 IP，无需输入协议）')
    return
  }

  // 补全协议
  const normalized = normalizeUrl(url)

  const id = ++customIdCounter
  const entry = reactive({ id, url: normalized, qrDataUrl: null, generating: true })
  customEntries.unshift(entry)  // 最新添加的放在最上面

  customUrlInput.value = ''

  // 客户端生成 QR 码
  const qr = await generateQR(normalized, 160)
  entry.qrDataUrl = qr
  entry.generating = false
}

// 移除自定义条目
function removeCustomEntry(id) {
  const idx = customEntries.findIndex(e => e.id === id)
  if (idx !== -1) {
    customEntries.splice(idx, 1)
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    close()
  }
}

// 面板可见时才添加键盘监听，并加载数据 + 生成 QR
watch(() => props.visible, (val) => {
  if (val) {
    fetchInfo().then(() => {
      if (!state.error && !state.loading) {
        generateAllAutoQRs()
      }
    })
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('keydown', handleKeydown)
    copied.value = false
    clearTimeout(copyTimer)
  }
})

onMounted(() => {
  if (props.visible) {
    fetchInfo().then(() => {
      if (!state.error && !state.loading) {
        generateAllAutoQRs()
      }
    })
    window.addEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
/* --- Backdrop --- */
.conn-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 900;
}

.conn-backdrop-enter-active,
.conn-backdrop-leave-active {
  transition: opacity 250ms var(--ease-out-expo, cubic-bezier(0.19, 1, 0.22, 1));
}
.conn-backdrop-enter-from,
.conn-backdrop-leave-to {
  opacity: 0;
}

/* --- Panel --- */
.conn-panel {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 910;
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 100px);
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-lg, 0 12px 40px rgba(0,0,0,0.6)), var(--shadow-glow, 0 0 30px rgba(200,132,60,0.15));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conn-panel-enter-active {
  transition: all 300ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.conn-panel-leave-active {
  transition: all 200ms var(--ease-out-expo, cubic-bezier(0.19, 1, 0.22, 1));
}
.conn-panel-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(24px) scale(0.9);
}
.conn-panel-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.95);
}

/* --- Header --- */
.conn-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.conn-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.conn-panel-title i {
  color: var(--accent);
  font-size: 1.1rem;
}

.conn-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-out-expo);
  font-size: 0.9rem;
}

.conn-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* --- Body --- */
.conn-panel-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  position: relative;
}

/* Loading */
.conn-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0;
  gap: 12px;
}

.conn-loading p {
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* Error */
.conn-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0;
  gap: 12px;
  color: var(--warning);
}

.conn-error i {
  font-size: 2rem;
}

.conn-error p {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.conn-retry-btn {
  margin-top: 8px;
  padding: 8px 20px;
  border-radius: 20px;
  border: 1px solid var(--border-accent);
  background: var(--accent-subtle);
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: 'DM Sans', sans-serif;
  transition: all 150ms var(--ease-out-expo);
  display: flex;
  align-items: center;
  gap: 6px;
}

.conn-retry-btn:hover {
  border-color: var(--accent);
}

/* Copied toast */
.conn-copied-toast {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--success);
  color: var(--text-inverse);
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  z-index: 2;
  pointer-events: none;
}

.conn-toast-enter-active {
  transition: all 200ms var(--ease-out-expo);
}
.conn-toast-leave-active {
  transition: all 300ms var(--ease-out-expo);
}
.conn-toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
.conn-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

/* Hostname */
.conn-hostname {
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 14px;
}

/* --- Sections --- */
.conn-section {
  margin-bottom: 18px;
}

.conn-section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.conn-section-title i {
  font-size: 0.75rem;
  color: var(--accent);
}

.conn-section-desc {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
}

/* --- URL Card --- */
.conn-url-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  padding: 12px 14px;
  margin-bottom: 8px;
  transition: border-color 150ms var(--ease-out-expo);
}

.conn-url-card:last-child {
  margin-bottom: 0;
}

.conn-url-card.recommended {
  border-color: var(--border-accent);
  background: var(--accent-subtle);
}

.conn-url-card.public {
  border-color: var(--success);
  background: rgba(46, 204, 113, 0.06);
}

.conn-url-card.custom {
  border-color: var(--border-accent);
  border-style: dashed;
}

.conn-url-card-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.conn-url-info {
  flex: 1;
  min-width: 0;
}

.conn-url-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.conn-url-badge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--text-inverse);
}

.conn-url-badge.public-badge {
  background: var(--success);
}

.conn-url-badge.custom-badge {
  background: var(--accent-dim);
}

.conn-url-type {
  font-size: 0.65rem;
  color: var(--text-muted);
  font-weight: 500;
}

.conn-url-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conn-url-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
  flex: 1;
  min-width: 0;
}

.conn-url-hint {
  font-size: 0.65rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* QR column */
.conn-qr-col {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conn-qr-loading .loading-spinner {
  width: 20px;
  height: 20px;
  border-width: 2px;
}

.conn-qr-mini-wrapper {
  background: #fff;
  padding: 4px;
  border-radius: 6px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.4));
  line-height: 1;
}

.conn-qr-mini-img {
  display: block;
  width: 72px;
  height: 72px;
}

/* Scrollable URL list (超过 5 个自动地址时) */
.conn-url-list-scroll {
  max-height: 260px;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.conn-url-list-scroll::-webkit-scrollbar {
  width: 4px;
}

.conn-url-list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.conn-url-list-scroll::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

/* --- Empty inline --- */
.conn-empty-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.conn-empty-inline i {
  opacity: 0.4;
}

/* --- Custom Input --- */
.conn-custom-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.conn-custom-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 14px;
  color: var(--text-primary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  outline: none;
  transition: all 150ms var(--ease-out-expo);
}

.conn-custom-input::placeholder {
  color: var(--text-muted);
}

.conn-custom-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

.conn-custom-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 9px 16px;
  border-radius: 10px;
  border: none;
  background: var(--accent);
  color: var(--text-inverse);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms var(--ease-out-expo);
  white-space: nowrap;
}

.conn-custom-btn:hover:not(:disabled) {
  background: var(--accent-glow);
  box-shadow: 0 4px 16px rgba(200, 132, 60, 0.3);
}

.conn-custom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Custom entries */
.conn-custom-entries {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conn-custom-list-enter-active {
  transition: all 250ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}
.conn-custom-list-leave-active {
  transition: all 200ms var(--ease-out-expo);
}
.conn-custom-list-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}
.conn-custom-list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* Remove button */
.conn-remove-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-out-expo);
  font-size: 0.75rem;
}

.conn-remove-btn:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

/* Copy button */
.conn-copy-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-out-expo);
  font-size: 0.8rem;
}

.conn-copy-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}

/* Visit button */
.conn-visit-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-out-expo);
  font-size: 0.8rem;
}

.conn-visit-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

/* --- Global hint --- */
.conn-global-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 0.72rem;
  color: var(--text-muted);
  text-align: center;
  justify-content: center;
}

.conn-global-hint i {
  font-size: 0.7rem;
  color: var(--accent-dim);
}

/* --- Footer --- */
.conn-panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.conn-refresh-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 14px;
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.75rem;
  font-family: 'DM Sans', sans-serif;
  transition: all 150ms var(--ease-out-expo);
}

.conn-refresh-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}

/* --- Responsive: Mobile --- */
@media (max-width: 480px) {
  .conn-panel {
    bottom: 16px;
    left: 8px;
    right: 8px;
    transform: none;
    width: auto;
    max-width: none;
    border-radius: var(--radius-md, 10px);
  }

  .conn-panel-enter-from {
    opacity: 0;
    transform: translateY(24px) scale(0.9);
  }
  .conn-panel-leave-to {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
  }

  .conn-panel-body {
    padding: 14px;
  }

  .conn-url-card-body {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .conn-qr-col {
    width: 100%;
    height: auto;
    display: flex;
    justify-content: center;
  }

  .conn-qr-mini-img {
    width: 100px;
    height: 100px;
  }

  .conn-custom-input-row {
    flex-direction: column;
  }

  .conn-custom-btn {
    justify-content: center;
  }
}
</style>
