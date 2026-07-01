<template>
  <div class="file-groups">
    <template v-for="group in groups" :key="group.key">
      <!-- Group Header -->
      <div class="list-group-header" @click="$emit('toggle-group', group.key)">
        <div class="list-group-header-left">
          <i
            class="fas fa-chevron-right group-header-arrow"
            :class="{ expanded: expandedGroups[group.key] }"
          ></i>
          <span class="group-header-label">{{ group.label }}</span>
        </div>
        <span class="group-header-count">{{ group.items.length }} 个文件</span>
      </div>

      <!-- Group Table -->
      <div v-if="expandedGroups[group.key]" class="table-wrapper">
        <table class="file-table">
          <thead>
            <tr>
              <th class="col-check" v-if="selectionMode"></th>
              <th @click="setSort('name')">
                名称
                <i class="fas sort-icon" :class="sortIcon('name')"></i>
              </th>
              <th @click="setSort('size')">
                大小
                <i class="fas sort-icon" :class="sortIcon('size')"></i>
              </th>
              <th @click="setSort('mtime')">
                修改时间
                <i class="fas sort-icon" :class="sortIcon('mtime')"></i>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="file in sortedItems(group)"
              :key="file.name"
              :class="{ selected: selectedFiles.has(file.name), 'file-highlight': file.isNew }"
              @mouseenter="showPreview(file, $event)"
              @click="onRowClick(file, $event)"
              @mousedown.prevent="onRowMouseDown(file, $event)"
              @mouseenter.prevent="onRowMouseEnter(file, $event)"
              @mouseup="onRowMouseUp"
              @mousemove="updatePosition(file, $event)"
              @mouseleave="hidePreview"
            >
              <td class="col-check" v-if="selectionMode">
                <label class="file-card-check list-check" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedFiles.has(file.name)"
                    @change="toggleSelect(file.name)"
                  />
                  <span class="checkmark"></span>
                </label>
              </td>
              <td>
                <div class="cell-name-inner">
                  <span class="mini-file-icon" :class="iconTypeClass(file.name)">
                    <i :class="getFileIcon(file.name)"></i>
                  </span>
                  <span class="file-name-text" :title="file.name">{{ file.name }}</span>
                </div>
              </td>
              <td>{{ file.size || '-' }}</td>
              <td class="col-mtime">{{ formatDate(file.modified) }}</td>
              <td>
                <div class="cell-actions" @click.stop>
                  <button
                    class="row-action-btn row-action-dl"
                    title="下载"
                    @click="handleDownload(file)"
                  >
                    <i class="fas fa-download"></i>
                  </button>
                  <button
                    v-if="isPreviewSupported(file.name)"
                    class="row-action-btn row-action-pv"
                    title="预览"
                    @click="handlePreview(file)"
                  >
                    <i class="fas fa-eye"></i>
                  </button>
                  <div class="list-expand-wrap" @click.stop>
                    <button
                      class="row-action-btn row-action-mr"
                      title="更多操作"
                      @click="openMenu(file, $event)"
                    >
                      <i class="fas fa-ellipsis"></i>
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
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
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useFileManager } from '../composables/useFileManager.js'
import { useViewer } from '../composables/useViewer.js'
import { useHoverPreview } from '../composables/useHoverPreview.js'
import { useFilePopover } from '../composables/useFilePopover.js'
import { useToast } from '../composables/useToast.js'
import { usePromptDialog } from '../composables/usePromptDialog.js'
import { parseFileSize, getFileIcon, smartDownload, isLAN } from '../utils/helpers.js'
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

// ==================== 分组内排序 ====================
const sortField = ref('mtime')
const sortDirection = ref('desc')

function setSort(field) {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = field === 'mtime' ? 'desc' : 'asc'
  }
}

function sortIcon(field) {
  if (sortField.value !== field) return 'fa-sort'
  return sortDirection.value === 'asc' ? 'fa-sort-up' : 'fa-sort-down'
}

function sortedItems(group) {
  const items = [...(group.items || [])]
  const dir = sortDirection.value === 'asc' ? 1 : -1

  items.sort((a, b) => {
    let cmp = 0
    if (sortField.value === 'size') {
      const aVal = a.sizeInBytes || parseFileSize(a.size)
      const bVal = b.sizeInBytes || parseFileSize(b.size)
      cmp = aVal - bVal
    } else if (sortField.value === 'mtime') {
      const aVal = a.mtimeMs != null ? a.mtimeMs : new Date(a.modified).getTime()
      const bVal = b.mtimeMs != null ? b.mtimeMs : new Date(b.modified).getTime()
      cmp = aVal - bVal
    } else {
      const aVal = (a.name || '').toLowerCase()
      const bVal = (b.name || '').toLowerCase()
      cmp = aVal.localeCompare(bVal, 'zh-CN')
    }
    return cmp * dir
  })

  return items
}

// ==================== 操作函数 ====================
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

function onRowClick(file, event) {
  if (props.selectionMode) return
  showPreview(file, event)
}

function onRowMouseDown(file, event) {
  if (props.selectionMode) {
    startSlideSelect(file.name, event)
  }
}

function onRowMouseEnter(file, event) {
  updateSlideSelect(file.name, event)
}

function onRowMouseUp() {
  endSlideSelect()
}

onMounted(() => {
  document.addEventListener('mouseup', onRowMouseUp)
})
onUnmounted(() => {
  document.removeEventListener('mouseup', onRowMouseUp)
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

.list-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 8px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
  transition: color var(--duration-fast) var(--ease-out-expo);
}

.list-group-header:hover {
  color: var(--text-primary);
}

.list-group-header-left {
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

/* --- File Table ---------------------------------------- */
.table-wrapper {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  animation: cardReveal var(--duration-reveal) var(--ease-out-expo) both;
  margin-top: 10px;
}

.file-table {
  width: 100%;
  border-collapse: collapse;
}

.file-table thead th {
  background: var(--bg-elevated);
  padding: 14px 20px;
  text-align: left;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-fast);
}

.file-table thead th:hover {
  color: var(--accent-glow);
}

.file-table thead th .sort-icon {
  margin-left: 6px;
  font-size: 0.65rem;
  opacity: 0.5;
}

.file-table tbody td {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 0.875rem;
  transition: background var(--duration-fast);
}

.file-table tbody tr:last-child td {
  border-bottom: none;
}

.file-table tbody tr:hover td {
  background: var(--bg-hover);
}

/* Staggered row animation */
.file-table tbody tr {
  animation: rowReveal var(--duration-reveal) var(--ease-out-expo) both;
}

.file-table tbody tr:nth-child(1) { animation-delay: 0ms; }
.file-table tbody tr:nth-child(2) { animation-delay: 40ms; }
.file-table tbody tr:nth-child(3) { animation-delay: 80ms; }
.file-table tbody tr:nth-child(4) { animation-delay: 120ms; }
.file-table tbody tr:nth-child(5) { animation-delay: 160ms; }
.file-table tbody tr:nth-child(6) { animation-delay: 200ms; }
.file-table tbody tr:nth-child(7) { animation-delay: 240ms; }
.file-table tbody tr:nth-child(8) { animation-delay: 280ms; }
.file-table tbody tr:nth-child(9) { animation-delay: 320ms; }
.file-table tbody tr:nth-child(10) { animation-delay: 360ms; }
.file-table tbody tr:nth-child(n+11) { animation-delay: 400ms; }

@keyframes rowReveal {
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Selected row */
.file-table tbody tr.selected td {
  background: var(--accent-subtle) !important;
}

/* --- Cell Styles --------------------------------------- */
.cell-name-inner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mini-file-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
  color: var(--text-secondary);
}

/* File type color variants (mirrored from grid) */
.mini-file-icon.type-doc  { background: rgba(107, 139, 139, 0.15); color: #8fbbbb; }
.mini-file-icon.type-img  { background: rgba(196, 155, 77, 0.15);  color: #d4af6a; }
.mini-file-icon.type-vid  { background: rgba(155, 107, 139, 0.15); color: #c49bbf; }
.mini-file-icon.type-aud  { background: rgba(139, 155, 107, 0.15); color: #b0c47a; }
.mini-file-icon.type-arch { background: rgba(196, 132, 96, 0.15);  color: #d4a080; }
.mini-file-icon.type-code { background: rgba(107, 139, 155, 0.15); color: #8fbbcc; }
.mini-file-icon.type-gen  { background: rgba(155, 155, 155, 0.1);  color: #aaaaaa; }

.file-name-text {
  font-family: 'JetBrains Mono', 'DM Sans', monospace;
  font-size: 0.825rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
  user-select: none;
}

.cell-actions {
  display: flex;
  gap: 6px;
}

.row-action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  transition: all var(--duration-fast) var(--ease-out-expo);
  text-decoration: none;
}

.row-action-btn:hover {
  background: var(--bg-hover);
}

.row-action-dl:hover {
  color: var(--accent-glow);
  background: var(--accent-subtle);
}

.row-action-del:hover {
  color: var(--danger);
  background: var(--danger-glow);
}

.row-action-pv:hover {
  color: var(--info);
  background: rgba(123, 156, 173, 0.1);
}

.row-action-mr:hover {
  color: var(--text-primary);
  background: var(--hover-bright);
}

/* --- List expand / popover ----------------------------- */
.list-expand-wrap {
  position: relative;
}

.list-expand-wrap .row-action-btn.active {
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

/* List popover */
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

/* --- List View Checkbox --------------------------------- */
.list-check {
  position: static;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.list-check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.list-check .checkmark {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--border-glow);
  background: var(--bg-deep);
  transition: all var(--duration-fast) var(--ease-out-expo);
  position: relative;
}

.list-check .checkmark::after {
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

.list-check input:checked + .checkmark {
  background: var(--accent);
  border-color: var(--accent);
}

.list-check input:checked + .checkmark::after {
  border-color: var(--text-inverse);
}

.col-check {
  width: 40px;
  padding: 14px 8px !important;
  text-align: center;
}

.col-mtime {
  color: var(--text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

/* --- Responsive: Mobile --------------------------------- */
@media (max-width: 768px) {
  .table-wrapper {
    overflow-x: auto;
  }

  .file-table {
    min-width: 500px;
  }

  .file-table thead th,
  .file-table tbody td {
    padding: 12px 16px;
    font-size: 0.8rem;
  }

  .file-name-text {
    max-width: 180px;
    font-size: 0.75rem;
  }

  .cell-actions {
    flex-direction: column;
    gap: 4px;
  }

  .group-header-label {
    font-size: 0.95rem;
  }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .file-name-text {
    max-width: 120px;
  }
}
</style>
