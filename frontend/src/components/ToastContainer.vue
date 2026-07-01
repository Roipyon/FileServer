<template>
  <Teleport to="body">
    <TransitionGroup name="toast-stack" tag="div" class="toast-container">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast-item"
        :class="`toast-${item.type}`"
      >
        <i v-if="item.icon" :class="['toast-icon', 'fas', item.icon]"></i>
        <span class="toast-message">{{ item.message }}</span>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { toasts } from '../composables/useToast.js'
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  pointer-events: auto;
  border-left: 3px solid transparent;
  backdrop-filter: blur(8px);
}

.toast-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

/* Type variants */
.toast-success { border-left-color: var(--success); }
.toast-success .toast-icon { color: var(--success); }

.toast-error { border-left-color: var(--danger); }
.toast-error .toast-icon { color: var(--danger); }

.toast-warning { border-left-color: var(--warning); }
.toast-warning .toast-icon { color: var(--warning); }

.toast-info { border-left-color: var(--info); }
.toast-info .toast-icon { color: var(--info); }

/* Transitions */
.toast-stack-enter-active {
  transition: all 250ms cubic-bezier(0.19, 1, 0.22, 1);
}
.toast-stack-leave-active {
  transition: all 200ms cubic-bezier(0.19, 1, 0.22, 1);
}
.toast-stack-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.95);
}
.toast-stack-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}
.toast-stack-move {
  transition: transform 250ms cubic-bezier(0.19, 1, 0.22, 1);
}

/* Responsive */
@media (max-width: 768px) {
  .toast-container {
    bottom: 16px;
    left: 16px;
    right: 16px;
    transform: none;
  }
  .toast-item {
    width: 100%;
    white-space: normal;
    word-break: break-word;
  }
}
</style>
