<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="dialogState.visible" class="confirm-backdrop" @click.self="handleCancel">
        <Transition name="confirm-scale" appear>
          <div v-if="dialogState.visible" class="confirm-card">
            <h3 class="confirm-title">{{ dialogState.title }}</h3>
            <p class="confirm-message">{{ dialogState.message }}</p>
            <div class="confirm-actions">
              <button class="confirm-btn confirm-btn-cancel" @click="handleCancel">
                {{ dialogState.cancelText }}
              </button>
              <button
                class="confirm-btn"
                :class="dialogState.variant === 'danger' ? 'confirm-btn-danger' : 'confirm-btn-accent'"
                @click="handleConfirm"
              >
                {{ dialogState.confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useConfirmDialog } from '../composables/useConfirmDialog.js'

const { dialogState, handleConfirm, handleCancel } = useConfirmDialog()

function onKeydown(e) {
  if (!dialogState.value.visible) return
  if (e.key === 'Escape') handleCancel()
  if (e.key === 'Enter') handleConfirm()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* Backdrop */
.confirm-backdrop {
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
.confirm-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: 32px;
  max-width: 420px;
  width: 90%;
}

.confirm-title {
  font-family: 'Playfair Display', serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.confirm-message {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 28px;
  white-space: pre-wrap;       /* 支持文本中的 \n 换行符 */
  overflow-wrap: anywhere;     /* 强制长无空格字符串（如文件名）自动折行 */
  word-break: break-all;       /* 兼容旧浏览器，强制在任意字符处打断 */
}

/* Actions */
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.confirm-btn {
  padding: 10px 24px;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.confirm-btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.confirm-btn-cancel:hover {
  color: var(--text-primary);
  background: var(--border-glow);
}

.confirm-btn-danger {
  background: var(--danger);
  color: #fff;
}
.confirm-btn-danger:hover {
  background: #d65a52;
  box-shadow: 0 4px 20px rgba(196, 85, 77, 0.3);
  transform: translateY(-1px);
}

.confirm-btn-accent {
  background: var(--accent);
  color: var(--text-inverse);
}
.confirm-btn-accent:hover {
  background: var(--accent-glow);
  box-shadow: 0 4px 20px rgba(200, 132, 60, 0.3);
  transform: translateY(-1px);
}

/* Transitions */
.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

.confirm-scale-enter-active {
  transition: all 250ms var(--ease-spring);
}
.confirm-scale-leave-active {
  transition: all 200ms var(--ease-out-expo);
}
.confirm-scale-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.confirm-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Responsive */
@media (max-width: 768px) {
  .confirm-card {
    padding: 24px;
  }
}
</style>
