<template>
  <div
    class="clipboard-item"
    :class="{
      'clipboard-item--new': item.isNew,
      'clipboard-item--link': isLink,
      'clipboard-item--selected': selected && selectionMode,
      'clipboard-item--selection-mode': selectionMode
    }"
    :style="{ animationDelay: (index * 0.04) + 's' }"
  >
    <!-- 批量选择复选框 -->
    <div v-if="selectionMode" class="clipboard-item__checkbox" @click.stop="toggleSelect">
      <div class="clipboard-item__checkbox-box" :class="{ checked: selected }">
        <i v-if="selected" class="fas fa-check"></i>
      </div>
    </div>

    <div class="clipboard-item__body">
      <!-- 内容区 -->
      <div class="clipboard-item__content" ref="contentRef">
        <!-- 链接标签 -->
        <span v-if="isLink" class="clipboard-item__link-tag">
          <i class="fas fa-link"></i>
          链接
        </span>
        <pre v-if="!expanded && isLongContent">{{ truncatedContent }}</pre>
        <pre v-else>{{ item.content }}</pre>
        <button
          v-if="isLongContent"
          class="clipboard-item__expand"
          @click="expanded = !expanded"
        >
          {{ expanded ? '收起' : '展开全部' }}
        </button>
      </div>

      <!-- 元数据 -->
      <div class="clipboard-item__meta">
        <span class="clipboard-item__device" :style="deviceColor ? { color: deviceColor } : undefined">
          <i class="fas fa-laptop" :style="deviceColor ? { color: deviceColor } : undefined"></i>
          {{ item.deviceName }}
        </span>
        <span class="clipboard-item__time">{{ formatRelativeTime(item.timestamp) }}</span>
      </div>

      <!-- 操作按钮 -->
      <div class="clipboard-item__actions">
        <button
          class="clipboard-item__action-btn copy-btn"
          :class="{ copied }"
          :title="copied ? '已复制' : '复制到剪贴板'"
          @click="handleCopy"
        >
          <i :class="copied ? 'fas fa-check' : 'fas fa-copy'"></i>
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </button>
        <button
          v-if="isLink"
          class="clipboard-item__action-btn open-btn"
          title="打开链接"
          @click="handleOpenLink"
        >
          <i class="fas fa-external-link-alt"></i>
          <span>打开</span>
        </button>
        <button
          class="clipboard-item__action-btn delete-btn"
          title="删除"
          @click="handleDelete"
        >
          <i class="fas fa-trash"></i>
          <span>删除</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useClipboard } from '../composables/useClipboard.js'
import { useToast } from '../composables/useToast.js'
import { useConfirmDialog } from '../composables/useConfirmDialog.js'
import { formatRelativeTime, isLink as checkIsLink, normalizeUrl } from '../utils/helpers.js'

const { confirm } = useConfirmDialog()
const toast = useToast()

const props = defineProps({
  item: { type: Object, required: true },
  index: { type: Number, default: 0 },
  selectionMode: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  deviceColor: { type: String, default: '' }
})

const emit = defineEmits(['select', 'delete'])

const { copyToSystem, deleteItem } = useClipboard()
const copied = ref(false)
const expanded = ref(false)

const CONTENT_PREVIEW_LENGTH = 200

const isLongContent = computed(() => {
  return props.item.content && props.item.content.length > CONTENT_PREVIEW_LENGTH
})

const truncatedContent = computed(() => {
  if (!props.item.content) return ''
  return props.item.content.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
})

// 链接检测
const isLink = computed(() => {
  return checkIsLink(props.item.content)
})

let copyTimer = null

async function handleCopy() {
  const ok = await copyToSystem(props.item)
  if (ok) {
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } else {
    toast.error('复制失败，请检查剪贴板权限')
  }
}

// 打开链接
function handleOpenLink() {
  const url = normalizeUrl(props.item.content)
  window.open(url, '_blank', 'noopener')
}

// 切换选中
function toggleSelect() {
  emit('select', props.item.id)
}

// 删除
async function handleDelete() {
  const ok = await confirm('确定要删除这条剪贴板内容吗？', {
    title: '删除剪贴板条目',
    confirmText: '删除',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await deleteItem(props.item.id)
    emit('delete', props.item.id)
  } catch (err) {
    toast.error(`删除失败: ${err.message}`)
  }
}
</script>

<style scoped>
/* --- Clipboard Item Card ----------------------------------- */
.clipboard-item {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  gap: 12px;
  transition: border-color var(--duration-normal) var(--ease-out-expo),
              box-shadow var(--duration-normal) var(--ease-out-expo),
              transform var(--duration-normal) var(--ease-out-expo);
  animation: clipboardItemReveal var(--duration-reveal) var(--ease-out-expo) both;
}

.clipboard-item:hover {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-card-hover);
}

.clipboard-item--new {
  animation: clipboardPulse 2s var(--ease-out-expo);
}

/* --- 链接条目样式 ------------------------------------------- */
.clipboard-item--link {
  border-left: 3px solid var(--link-color, #4CAF50);
}

.clipboard-item--link:hover {
  border-left-color: var(--link-color-hover, #66BB6A);
}

.clipboard-item__link-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #2E7D32;
  background: rgba(76, 175, 80, 0.12);
  margin-bottom: 6px;
  user-select: none;
  letter-spacing: 0.02em;
}

.clipboard-item__link-tag i {
  font-size: 0.65rem;
}

/* --- 选中状态（批量模式）------------------------------------- */
.clipboard-item--selection-mode {
  cursor: default;
}

.clipboard-item--selected {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 1px var(--accent), 0 0 20px var(--accent-glow-subtle) !important;
  background: var(--accent-subtle);
}

/* --- 复选框 ----------------------------------------------- */
.clipboard-item__checkbox {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
  flex-shrink: 0;
  cursor: pointer;
}

.clipboard-item__checkbox-box {
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-muted);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: transparent;
  transition: all var(--duration-fast) var(--ease-out-expo);
  flex-shrink: 0;
}

.clipboard-item__checkbox-box.checked {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}

.clipboard-item__checkbox:hover .clipboard-item__checkbox-box:not(.checked) {
  border-color: var(--accent-dim);
}

.clipboard-item__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

@keyframes clipboardItemReveal {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes clipboardPulse {
  0% {
    border-color: var(--accent);
    box-shadow: 0 0 20px var(--accent-glow-subtle);
    background: var(--accent-subtle);
  }
  100% {
    border-color: var(--border);
    box-shadow: none;
    background: var(--bg-elevated);
  }
}

.clipboard-item__content pre {
  font-family: 'JetBrains Mono', 'DM Sans', monospace;
  font-size: 0.9rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  margin: 0;
}

.clipboard-item__expand {
  display: inline-block;
  margin-top: 6px;
  background: none;
  border: none;
  color: var(--accent);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.clipboard-item__expand:hover {
  color: var(--accent-bright);
}

.clipboard-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.clipboard-item__device {
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.clipboard-item__device i {
  font-size: 0.7rem;
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.clipboard-item__time {
  color: var(--text-muted);
}

.clipboard-item__actions {
  display: flex;
  gap: 8px;
}

.clipboard-item__action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
}

.clipboard-item__action-btn:hover {
  border-color: var(--border-glow);
  color: var(--text-primary);
}

.clipboard-item__action-btn.copy-btn.copied {
  background: var(--success-glow);
  border-color: var(--success);
  color: var(--success);
}

.clipboard-item__action-btn.copy-btn.copied i {
  color: var(--success);
}

.clipboard-item__action-btn.open-btn:hover {
  border-color: var(--link-color, #4CAF50);
  color: #4CAF50;
  background: rgba(76, 175, 80, 0.1);
}

.clipboard-item__action-btn.delete-btn:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-glow);
}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .clipboard-item {
    padding: 12px;
    gap: 10px;
  }

  .clipboard-item__body {
    gap: 10px;
  }

  .clipboard-item__content pre {
    font-size: 0.85rem;
  }

  .clipboard-item__meta {
    font-size: 0.72rem;
  }

  .clipboard-item__action-btn {
    padding: 6px 10px;
    font-size: 0.72rem;
  }

  .clipboard-item__checkbox-box {
    width: 18px;
    height: 18px;
  }
}

@media (max-width: 480px) {
  .clipboard-item {
    padding: 10px;
  }

  .clipboard-item__actions {
    gap: 6px;
  }

  .clipboard-item__action-btn {
    min-height: 44px;
    min-width: 44px;
    padding: 8px 10px;
  }
}
</style>
