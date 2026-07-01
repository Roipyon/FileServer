<template>
  <Teleport to="body">
    <Transition name="share-fade">
      <div class="share-backdrop" @click.self="emit('close')">
        <Transition name="share-scale" appear>
          <div class="share-card">
            <div class="share-header">
              <div class="share-header-icon">
                <i class="fas fa-share-nodes"></i>
              </div>
              <h3>分享文件</h3>
              <button class="share-close-btn" @click="emit('close')">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="share-body">
              <div class="share-file-info">
                <i class="fas fa-file"></i>
                <span class="share-file-name">{{ fileName }}</span>
              </div>

              <div class="share-mode-select">
                <label class="share-mode-label">分享模式</label>
                <div class="share-mode-options">
                  <label class="share-mode-option" :class="{ active: mode === 'once' }">
                    <input type="radio" v-model="mode" value="once" />
                    <div class="share-mode-content">
                      <strong>一次性</strong>
                      <span>访问 1 次后自动失效（阅后即焚）</span>
                    </div>
                  </label>
                  <label class="share-mode-option" :class="{ active: mode === 'persistent' }">
                    <input type="radio" v-model="mode" value="persistent" />
                    <div class="share-mode-content">
                      <strong>持续有效</strong>
                      <span>服务运行期间可多次访问（重启后失效）</span>
                    </div>
                  </label>
                </div>
              </div>

              <!-- 生成结果 -->
              <div v-if="shareUrl" class="share-result">
                <div class="share-result-label">分享链接</div>
                <div class="share-url-row">
                  <input
                    :value="shareUrl"
                    class="share-url-input"
                    readonly
                    ref="urlInputRef"
                    @focus="$event.target.select()"
                  />
                  <button class="share-copy-btn" @click="copyUrl">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
                <div class="share-result-hint">
                  <i class="fas fa-info-circle"></i>
                  {{ mode === 'once' ? '此链接只能使用一次，分享给他人后请谨慎操作' : '此链接持续有效，直到服务器重启' }}
                </div>
              </div>
            </div>

            <div class="share-footer">
              <button class="share-btn share-btn-cancel" @click="emit('close')">关闭</button>
              <button
                class="share-btn share-btn-accent"
                :disabled="generating"
                @click="generateLink"
              >
                <i v-if="generating" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-link"></i>
                {{ generating ? '生成中...' : shareUrl ? '重新生成' : '生成分享链接' }}
              </button>
            </div>

            <!-- Copied toast -->
            <Transition name="share-toast">
              <div v-if="copied" class="share-copied-toast">已复制到剪贴板</div>
            </Transition>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { generateShareLink } from '../api/fileApi.js'
import { useToast } from '../composables/useToast.js'

const props = defineProps({
  fileName: { type: String, required: true }
})

const emit = defineEmits(['close'])
const toast = useToast()

const mode = ref('once')
const generating = ref(false)
const shareUrl = ref('')
const copied = ref(false)
const urlInputRef = ref(null)

function handleKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

async function generateLink() {
  generating.value = true
  try {
    const result = await generateShareLink(props.fileName, mode.value)
    // 构建完整 URL
    shareUrl.value = `${window.location.origin}${result.url}`
    toast.success('分享链接已生成')
  } catch (err) {
    toast.error(`生成失败: ${err.message}`)
  } finally {
    generating.value = false
  }
}

async function copyUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
    toast.success('已复制到剪贴板')
  } catch {
    // 降级
    if (urlInputRef.value) {
      urlInputRef.value.select()
      document.execCommand('copy')
      copied.value = true
      setTimeout(() => { copied.value = false }, 1500)
    }
  }
}
</script>

<style scoped>
.share-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(4px);
}

.share-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 28px;
  max-width: 520px;
  width: 90%;
  position: relative;
  overflow: visible;
}

/* Header */
.share-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.share-header-icon {
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

.share-header h3 {
  flex: 1;
  font-family: 'Playfair Display', serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.share-close-btn {
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
}

.share-close-btn:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

/* Body */
.share-body {
  margin-bottom: 20px;
}

.share-file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-deep);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.share-file-info i {
  color: var(--accent-dim);
}

.share-file-name {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Mode select */
.share-mode-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.share-mode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.share-mode-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 150ms var(--ease-out-expo);
}

.share-mode-option:hover {
  border-color: var(--border-accent);
  background: var(--accent-subtle);
}

.share-mode-option.active {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.share-mode-option input[type="radio"] {
  margin-top: 2px;
  accent-color: var(--accent);
}

.share-mode-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.share-mode-content strong {
  font-size: 0.85rem;
  color: var(--text-primary);
}

.share-mode-content span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Result */
.share-result {
  margin-top: 20px;
  padding: 14px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.share-result-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.share-url-row {
  display: flex;
  gap: 6px;
}

.share-url-input {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  color: var(--accent-glow);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  outline: none;
  min-width: 0;
}

.share-copy-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-accent);
  background: var(--accent-subtle);
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms var(--ease-out-expo);
  flex-shrink: 0;
}

.share-copy-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
}

.share-result-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.7rem;
  color: var(--text-muted);
}

.share-result-hint i {
  color: var(--accent-dim);
}

/* Footer */
.share-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.share-btn {
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--duration-normal) var(--ease-out-expo);
  display: flex;
  align-items: center;
  gap: 6px;
}

.share-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.share-btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.share-btn-cancel:hover {
  color: var(--text-primary);
}

.share-btn-accent {
  background: var(--accent);
  color: var(--text-inverse);
}

.share-btn-accent:hover:not(:disabled) {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
  transform: translateY(-1px);
}

/* Copied toast */
.share-copied-toast {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--success);
  color: var(--text-inverse);
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}

.share-toast-enter-active { transition: all 200ms var(--ease-out-expo); }
.share-toast-leave-active { transition: all 300ms var(--ease-out-expo); }
.share-toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(8px); }
.share-toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-4px); }

/* Transitions */
.share-fade-enter-active,
.share-fade-leave-active { transition: opacity var(--duration-normal) var(--ease-out-expo); }
.share-fade-enter-from,
.share-fade-leave-to { opacity: 0; }

.share-scale-enter-active { transition: all 250ms var(--ease-spring); }
.share-scale-leave-active { transition: all 200ms var(--ease-out-expo); }
.share-scale-enter-from { opacity: 0; transform: scale(0.92); }
.share-scale-leave-to { opacity: 0; transform: scale(0.95); }

/* Responsive */
@media (max-width: 480px) {
  .share-card {
    padding: 20px;
    width: 95%;
  }
  .share-mode-option {
    padding: 10px 12px;
  }
}
</style>
