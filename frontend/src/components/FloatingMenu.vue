<template>
  <div class="fab-container">
    <Transition name="fab-menu">
      <div v-if="isOpen" class="fab-menu">
        <button class="fab-menu-item" @click="action('upload')" title="上传文件">
          <i class="fas fa-cloud-arrow-up"></i>
          <span class="fab-tooltip">上传文件</span>
        </button>
        <button v-if="!isClipboard" class="fab-menu-item" @click="action('toggle-view')" title="切换视图">
          <i :class="currentView === 'grid' ? 'fa-solid fa-list' : 'fa-solid fa-th'"></i>
          <span class="fab-tooltip">切换视图</span>
        </button>
        <button v-if="!isClipboard" class="fab-menu-item" @click="action('batch-select')" title="批量选择">
          <i class="fas fa-check-square"></i>
          <span class="fab-tooltip">批量选择</span>
        </button>
        <button class="fab-menu-item" @click="action('gen-upload-token')" title="生成上传链接">
          <i class="fas fa-link"></i>
          <span class="fab-tooltip">生成上传链接</span>
        </button>
        <button class="fab-menu-item" @click="action('quick-paste')" title="快速粘贴">
          <i class="fas fa-paste"></i>
          <span class="fab-tooltip">快速粘贴</span>
        </button>
        <button class="fab-menu-item" @click="action('refresh')" title="刷新列表">
          <i class="fas fa-arrows-rotate"></i>
          <span class="fab-tooltip">刷新列表</span>
        </button>
      </div>
    </Transition>

    <button
      class="fab-main"
      :class="{ open: isOpen }"
      @click="isOpen = !isOpen"
      title="菜单"
    >
      <i class="fas fa-plus"></i>
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  section: { type: String, default: 'files' },
  currentView: { type: String, default: 'grid' }
})

const emit = defineEmits(['upload', 'toggle-view', 'batch-select', 'quick-paste', 'refresh', 'gen-upload-token'])
const isOpen = ref(false)

const isClipboard = computed(() => props.section === 'clipboard')

function action(type) {
  isOpen.value = false
  if (type === 'upload') emit('upload')
  else if (type === 'toggle-view') emit('toggle-view')
  else if (type === 'batch-select') emit('batch-select')
  else if (type === 'quick-paste') emit('quick-paste')
  else if (type === 'refresh') emit('refresh')
  else if (type === 'gen-upload-token') emit('gen-upload-token')
}
</script>

<style scoped>
.fab-container {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 200;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 12px;
}

.fab-menu {
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
}

.fab-menu-item {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-glow);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  transition: all var(--duration-normal) var(--ease-spring);
  box-shadow: var(--shadow-md);
  position: relative;
}

.fab-menu-item:hover {
  background: var(--accent-subtle);
  color: var(--accent-glow);
  border-color: var(--border-accent);
  transform: scale(1.1);
}

.fab-menu-item .fab-tooltip {
  position: absolute;
  right: 56px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateX(8px);
  transition: all var(--duration-normal) var(--ease-out-expo);
  border: 1px solid var(--border);
}

.fab-menu-item:hover .fab-tooltip {
  opacity: 1;
  transform: translateX(0);
}

/* FAB menu animation */
.fab-menu-enter-active {
  transition: all var(--duration-normal) var(--ease-spring);
}
.fab-menu-leave-active {
  transition: all var(--duration-fast) var(--ease-out-expo);
}
.fab-menu-enter-from,
.fab-menu-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.6);
}

.fab-main {
  width: var(--fab-size);
  height: var(--fab-size);
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--text-inverse);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  box-shadow: 0 4px 24px rgba(200, 132, 60, 0.35);
  transition: all var(--duration-normal) var(--ease-spring);
  position: relative;
  z-index: 2;
}

.fab-main:hover {
  background: var(--accent-glow);
  transform: scale(1.05);
  box-shadow: 0 6px 32px rgba(200, 132, 60, 0.45);
}

.fab-main:active {
  transform: scale(0.95);
}

.fab-main.open {
  transform: rotate(45deg);
  background: var(--bg-elevated);
  color: var(--accent);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-glow);
}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .fab-container {
    bottom: 25px;
    right: 25px;
  }

  .fab-main {
    width: 48px;
    height: 48px;
    font-size: 1.2rem;
  }

  .fab-menu-item {
    width: 40px;
    height: 40px;
    font-size: 0.85rem;
  }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .fab-container {
    bottom: 25px;
    right: 20px;
  }

  .fab-main {
    width: 44px;
    height: 44px;
    font-size: 1.1rem;
  }

  .fab-menu-item {
    width: 40px;
    height: 40px;
    font-size: 0.85rem;
  }
}
</style>
