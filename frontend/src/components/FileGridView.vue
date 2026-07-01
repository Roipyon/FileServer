<template>
  <div class="file-groups">
    <template v-for="group in groups" :key="group.key">
      <!-- Group Header -->
      <div class="group-header" @click="$emit('toggle-group', group.key)">
        <div class="group-header-left">
          <i
            class="fas fa-chevron-right group-header-arrow"
            :class="{ expanded: expandedGroups[group.key] }"
          ></i>
          <span class="group-header-label">{{ group.label }}</span>
        </div>
        <span class="group-header-count">{{ group.items.length }} 个文件</span>
      </div>

      <!-- Group Items -->
      <div v-if="expandedGroups[group.key]" class="file-grid">
        <div
          v-for="file in group.items"
          :key="file.name"
          class="file-card"
          :class="{ selected: selectedFiles.has(file.name), 'file-highlight': file.isNew }"
          @mouseenter="showPreview(file, $event)"
          @click="onCardClick(file, $event)"
          @mousedown.prevent="onCardMouseDown(file, $event)"
          @mouseenter.prevent="onCardMouseEnter(file, $event)"
          @mouseup="onCardMouseUp"
          @mousemove="updatePosition(file, $event)"
          @mouseleave="onCardMouseLeave"
        >
          <!-- Selection checkbox -->
          <label class="file-card-check" :class="{ visible: selectionMode }" @click.stop>
            <input
              type="checkbox"
              :checked="selectedFiles.has(file.name)"
              @change="toggleSelect(file.name)"
            />
            <span class="checkmark"></span>
          </label>

          <div class="file-card-top">
            <div class="file-card-icon" :class="iconTypeClass(file.name)">
              <i :class="getFileIcon(file.name)"></i>
            </div>
            <div class="file-card-actions">
              <button
                class="card-action-btn card-action-dl"
                title="下载"
                @click.stop="handleDownload(file)"
              >
                <i class="fas fa-download"></i>
              </button>
              <button
                v-if="isPreviewSupported(file.name)"
                class="card-action-btn card-action-pv"
                title="预览"
                @click.stop="handlePreview(file)"
              >
                <i class="fas fa-eye"></i>
              </button>
              <div class="card-expand-wrap" @click.stop>
                <button
                  class="card-action-btn card-action-mr"
                  title="更多操作"
                  @click="openMenu(file, $event)"
                >
                  <i class="fas fa-ellipsis"></i>
                </button>
              </div>
            </div>
          </div>
          <div class="file-card-name" :title="file.name">{{ file.name }}</div>
          <div class="file-card-meta">
            <span>{{ file.size || '-' }}</span>
            <span>{{ formatDate(file.modified) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>

  <Teleport to="body">
    <Transition name="popover">
      <div
        v-if="menuVisible"
        ref="popoverRef"
        class="list-popover"
        :style="{ position: 'fixed', top: menuY + 'px', left: menuX + 'px', right: 'auto' }"
        @click.stop
      >
        <button
          v-if="menuFile"
          class="list-popover-item"
          @click="handleRename(menuFile.name)"
        >
          <i class="fas fa-pencil"></i> 重命名
        </button>
        <button
          v-if="menuFile && isTextFile(menuFile.name)"
          class="list-popover-item"
          @click="handleEdit(menuFile)"
        >
          <i class="fas fa-pen"></i> 编辑
        </button>
        <button
          v-if="menuFile"
          class="list-popover-item"
          @click="handleShare(menuFile.name)"
        >
          <i class="fas fa-share-nodes"></i> 分享
        </button>
        <button
          v-if="menuFile"
          class="list-popover-item danger"
          @click="handleDelete(menuFile.name)"
        >
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </Transition>
  </Teleport>

  <HoverPreviewPopover />

  <!-- Share Dialog -->
  <ShareDialog
    v-if="showShareDialog && shareFile"
    :file-name="shareFile"
    @close="showShareDialog = false; shareFile = ''"
  />
</template>

<script setup>
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useFileManager } from '../composables/useFileManager.js'
import { useViewer } from '../composables/useViewer.js'
import { useHoverPreview } from '../composables/useHoverPreview.js'
import { useFilePopover } from '../composables/useFilePopover.js'
import { useToast } from '../composables/useToast.js'
import { usePromptDialog } from '../composables/usePromptDialog.js'
import { getFileIcon, smartDownload, isLAN } from '../utils/helpers.js'
import { isTextFile, isPreviewSupported, iconTypeClass } from '../utils/fileTypes.js'
import HoverPreviewPopover from './HoverPreviewPopover.vue'
import ShareDialog from './ShareDialog.vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  expandedGroups: { type: Object, default: () => ({}) },
  selectionMode: { type: Boolean, default: false },
  selectedFiles: { type: Set, default: () => new Set() },
})

defineEmits(['toggle-group'])

const { deleteFile, getDownloadUrl, toggleSelect, renameFile, startSlideSelect, updateSlideSelect, endSlideSelect } = useFileManager()
const { openPreview, openEditor } = useViewer()
const { showPreview, updatePosition, hidePreview } = useHoverPreview()
const { menuVisible, menuFile, menuX, menuY, popoverRef, openMenu, closeMenu } = useFilePopover()
const toast = useToast()
const { prompt } = usePromptDialog()
const showShareDialog = ref(false)
const shareFile = ref('')

function formatDate(dateStr) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function handleDownload(file) {
  if (isLAN()) {
    // 内网：直接下载
    const a = document.createElement('a')
    a.href = getDownloadUrl(file.name)
    a.download = file.name
    a.click()
    return
  }
  // 外网：分块下载，仅提示开始和结束，避免循环中频繁弹窗
  toast.info(`正在下载 ${file.name}，完成后会自动保存...`)
  smartDownload(
    getDownloadUrl(file.name),
    file.name
  ).then(() => {
    toast.success(`下载完成: ${file.name}`)
  }).catch(err => {
    toast.error(`下载失败 ${file.name}: ${err.message}`)
  })
}

function handlePreview(file) {
  openPreview(file)
}

function handleEdit(file) {
  openEditor(file)
  closeMenu()
}

function handleDelete(filename) {
  deleteFile(filename)
  closeMenu()
}

function handleShare(filename) {
  shareFile.value = filename
  showShareDialog.value = true
  closeMenu()
}

async function handleRename(filename) {
  closeMenu()
  const newName = await prompt('', filename, {
    title: '重命名',
    placeholder: '请输入新文件名…'
  })
  if (!newName || newName === filename) return
  try {
    await renameFile(filename, newName)
    toast.success(`已重命名为 ${newName}`)
  } catch (err) {
    toast.error(`重命名失败: ${err.message}`)
  }
}

/**
 * 卡片点击处理：非选择模式触发预览（选择模式由 mousedown 处理）
 */
function onCardClick(file, event) {
  if (props.selectionMode) return
  showPreview(file, event)
}

function onCardMouseDown(file, event) {
  if (props.selectionMode) {
    startSlideSelect(file.name, event)
  }
}

function onCardMouseEnter(file, event) {
  updateSlideSelect(file.name, event)
}

function onCardMouseUp() {
  endSlideSelect()
}

function onCardMouseLeave() {
  hidePreview()
}

onMounted(() => {
  document.addEventListener('mouseup', onCardMouseUp)
})
onUnmounted(() => {
  document.removeEventListener('mouseup', onCardMouseUp)
})

// 新文件高亮时自动滚动到第一个
watch(() => props.groups, async () => {
  const allFiles = props.groups.flatMap(g => g.items)
  const hasNew = allFiles.some(f => f.isNew)
  if (hasNew) {
    await nextTick()
    const el = document.querySelector('.file-highlight')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}, { deep: true })
</script>

<style scoped>
/* --- Group Header ----------------------------------------- */
.file-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 25px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 8px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.group-header:hover {
  color: var(--text-primary);
}

.group-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.group-header-arrow {
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform var(--duration-normal) var(--ease-out-expo);
}

.group-header-arrow.expanded {
  transform: rotate(90deg);
}

.group-header-label {
  font-family: 'Playfair Display', serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: -0.01em;
}

.group-header-count {
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* --- File Grid --------------------------------------------- */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

/* Staggered reveal animation for grid children */
.file-grid > * {
  animation: cardReveal var(--duration-reveal) var(--ease-out-expo) both;
}

.file-grid > *:nth-child(1) { animation-delay: 0ms; }
.file-grid > *:nth-child(2) { animation-delay: 50ms; }
.file-grid > *:nth-child(3) { animation-delay: 100ms; }
.file-grid > *:nth-child(4) { animation-delay: 150ms; }
.file-grid > *:nth-child(5) { animation-delay: 200ms; }
.file-grid > *:nth-child(6) { animation-delay: 250ms; }
.file-grid > *:nth-child(7) { animation-delay: 300ms; }
.file-grid > *:nth-child(8) { animation-delay: 350ms; }
.file-grid > *:nth-child(9) { animation-delay: 400ms; }
.file-grid > *:nth-child(10) { animation-delay: 450ms; }
.file-grid > *:nth-child(n+11) { animation-delay: 500ms; }

/* --- File Card --------------------------------------------- */
.file-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-top: 10px;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out-expo);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  user-select: none;
}

.file-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-card-hover);
  border-color: var(--border-accent);
}

/* File type accent bar */
.file-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 16px;
  right: 16px;
  height: 2px;
  border-radius: 0 0 2px 2px;
  background: var(--border);
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.file-card:hover::after {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
  left: 0;
  right: 0;
}

/* --- File Card Top (icon + actions row) -------------------- */
.file-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.file-card-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  flex-shrink: 0;
}

/* File type color variants */
.file-card-icon.type-doc  { background: rgba(107, 139, 139, 0.15); color: #8fbbbb; }
.file-card-icon.type-img  { background: rgba(196, 155, 77, 0.15);  color: #d4af6a; }
.file-card-icon.type-vid  { background: rgba(155, 107, 139, 0.15); color: #c49bbf; }
.file-card-icon.type-aud  { background: rgba(139, 155, 107, 0.15); color: #b0c47a; }
.file-card-icon.type-arch { background: rgba(196, 132, 96, 0.15);  color: #d4a080; }
.file-card-icon.type-code { background: rgba(107, 139, 155, 0.15); color: #8fbbcc; }
.file-card-icon.type-gen  { background: rgba(155, 155, 155, 0.1);  color: #aaaaaa; }

/* --- Card Actions ------------------------------------------ */
.file-card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transform: translateY(-4px);
  transition: all var(--duration-normal) var(--ease-out-expo);
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.file-card:hover .file-card-actions {
  opacity: 1;
  transform: translateY(0);
}

.card-action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
  text-decoration: none;
  flex-shrink: 0;
}

.card-action-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

.card-action-dl:hover {
  color: var(--accent-glow);
  background: var(--accent-subtle);
}

.card-action-pv:hover {
  color: var(--info);
  background: rgba(123, 156, 173, 0.1);
}

.card-action-mr:hover {
  color: var(--text-primary);
  background: var(--hover-bright);
}

/* --- File Card Name & Meta --------------------------------- */
.file-card-name {
  font-family: 'JetBrains Mono', 'DM Sans', monospace;
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.file-card-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
}

/* --- Card Popover (展开菜单) -------------------------------- */
.card-expand-wrap {
  position: relative;
}

.card-expand-btn.active {
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

/* Popover transition */
.popover-enter-active {
  transition: all 180ms var(--ease-out-back);
}
.popover-leave-active {
  transition: all 120ms var(--ease-out-expo);
}
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.95);
}

/* --- Batch Selection Checkbox ------------------------------- */
.file-card-check {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 5;
  display: none;
  cursor: pointer;
}

.file-card-check.visible {
  display: block;
}

.file-card-check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.file-card-check .checkmark {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--border-glow);
  background: var(--bg-deep);
  transition: all var(--duration-fast) var(--ease-out-expo);
  position: relative;
}

.file-card-check .checkmark::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 5px;
  width: 6px;
  height: 10px;
  border: solid transparent;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  transition: border-color var(--duration-fast);
}

.file-card-check input:checked + .checkmark {
  background: var(--accent);
  border-color: var(--accent);
}

.file-card-check input:checked + .checkmark::after {
  border-color: var(--text-inverse);
}

/* File card selected state */
.file-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 20px var(--accent-glow-subtle);
}

/* --- List Popover (Teleported to body) --------------------- */
.list-popover {
  min-width: 130px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-popover-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
  text-align: left;
}

.list-popover-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.list-popover-item.danger:hover {
  background: var(--danger-glow);
  color: var(--danger);
}

.list-popover-item i {
  width: 16px;
  text-align: center;
  font-size: 0.75rem;
}

/* --- Responsive: Tablet ------------------------------------ */
@media (max-width: 1024px) {
  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .file-card {
    padding: 16px;
  }

  .file-card-icon {
    width: 38px;
    height: 38px;
    font-size: 1.1rem;
  }

  .file-card-name {
    font-size: 0.75rem;
  }

  .file-card-meta {
    font-size: 0.7rem;
  }

  .file-card-actions {
    opacity: 1;
  }

  .group-header-label {
    font-size: 0.95rem;
  }
  .group-header-count {
    font-size: 0.72rem;
  }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }

  .file-card {
    padding: 12px;
    gap: 8px;
    margin-top: 0px;
  }

  .file-card-icon {
    width: 32px;
    height: 32px;
    font-size: 0.85rem;
    border-radius: var(--radius-sm);
  }

  .file-card-name {
    font-size: 0.7rem;
  }

  .file-card-meta {
    font-size: 0.65rem;
  }
}

/* --- Narrow card button shrink ----------------------------- */
@media (max-width: 600px) {
  .card-action-btn {
    width: 28px;
    height: 28px;
    font-size: 0.7rem;
  }
}
</style>
