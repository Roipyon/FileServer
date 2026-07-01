<template>
  <div class="clipboard-panel">
    <!-- 固定头部：输入 + 工具栏，合并展开收起，始终固定在顶部 -->
    <div class="clipboard-fixed-header">
      <!-- 始终可见的紧凑工具栏 -->
      <div class="clipboard-compact-bar">
        <div class="clipboard-compact-bar__left">
          <button
            class="clipboard-compact-btn"
            @click="toggleExpanded"
            :title="expanded ? '收起输入区' : '展开输入区'"
          >
            <i :class="expanded ? 'fas fa-chevron-down' : 'fas fa-pen'"></i>
            <span>{{ expanded ? '收起' : '发送' }}</span>
          </button>
          <div class="clipboard-device-name" title="点击修改设备名称" @click="editDeviceName">
            <i class="fas fa-laptop"></i>
            <span v-if="!editingName">{{ state.deviceName }}</span>
            <input v-else ref="nameInputRef" v-model="editNameValue" class="clipboard-device-name-input" maxlength="30"
              @blur="saveDeviceName" @keydown.enter="saveDeviceName" @keydown.escape="cancelEditName" />
          </div>
          <span class="clipboard-count">{{ filteredItems.length }} 条</span>
        </div>
        <div class="clipboard-compact-bar__right">
          <button v-if="hasTodayGroup && filteredItems.length > 5 && !selectionMode" class="clipboard-toolbar-btn"
            @click="scrollToToday" title="跳转到最新的条目">
            <i class="fas fa-arrow-down"></i>
            <span>今天</span>
          </button>
          <button v-if="filteredItems.length > 0" class="clipboard-toolbar-btn"
            :class="{ active: selectionMode }" @click="toggleSelectionMode"
            :title="selectionMode ? '退出选择模式' : '进入选择模式'">
            <i class="fas fa-check-square"></i>
            <span>{{ selectionMode ? '取消选择' : '选择' }}</span>
          </button>
          <button v-if="state.items.length > 0 && !selectionMode" class="clipboard-clear-btn"
            @click="handleClearAll" title="清空全部">
            <i class="fas fa-trash-alt"></i>
            <span>清空</span>
          </button>
        </div>
      </div>

      <!-- 展开区域：输入框 + 完整工具栏 -->
      <Transition name="header-expand">
        <div v-if="expanded" class="clipboard-expanded-area">
          <div class="clipboard-input-wrap">
            <textarea ref="inputRef" v-model="inputText" class="clipboard-input"
              placeholder="输入要同步的剪贴板内容... (Ctrl+Enter 发送)" rows="2"
              @keydown="handleKeydown" @input="autoResize"></textarea>
            <button class="clipboard-send-btn" :disabled="sending || !inputText.trim()"
              @click="handleSend" title="发送 (Ctrl+Enter)">
              <i v-if="!sending" class="fas fa-paper-plane"></i>
              <i v-else class="fas fa-spinner fa-spin"></i>
              <span>{{ sending ? '发送中' : '发送' }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 列表区域（始终可见，可滚动） -->
    <div class="clipboard-list" ref="listRef">
      <div v-if="filteredItems.length === 0 && !state.loading" class="clipboard-empty">
        <div class="empty-state-icon"><i class="fas fa-clipboard"></i></div>
        <h4>剪贴板为空</h4>
        <p>点击上方"发送"按钮展开输入区域，粘贴内容并同步</p>
      </div>

      <template v-if="!isSearching">
        <template v-for="group in groupedItems" :key="group.key">
          <div class="clipboard-group-header" @click="toggleGroup(group.key)">
            <div class="clipboard-group-header__left">
              <i class="fas fa-chevron-right clipboard-group-header__arrow"
                :class="{ expanded: !isGroupCollapsed(group.key) }"></i>
              <span class="clipboard-group-header__label">{{ group.label }}</span>
            </div>
            <span class="clipboard-group-header__count">{{ group.items.length }} 条</span>
          </div>
          <template v-if="!isGroupCollapsed(group.key)">
            <ClipboardItem v-for="item in group.items" :key="item.id" :item="item"
              :selection-mode="selectionMode" :selected="isSelected(item.id)"
              :device-color="getDeviceColor(item.deviceName)"
              @select="toggleItemSelection" @delete="onItemDeleted" />
          </template>
        </template>
      </template>

      <template v-else>
        <ClipboardItem v-for="(item, index) in filteredItems" :key="item.id" :item="item" :index="index"
          :selection-mode="selectionMode" :selected="isSelected(item.id)"
          :device-color="getDeviceColor(item.deviceName)"
          @select="toggleItemSelection" @delete="onItemDeleted" />
      </template>

      <div v-if="state.loading && filteredItems.length === 0" class="clipboard-loading">
        <i class="fas fa-spinner fa-spin"></i><span>加载中...</span>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <Transition name="batch-bar-slide">
      <div v-if="selectionMode && filteredItems.length > 0" class="clipboard-batch-bar">
        <div class="clipboard-batch-bar__left">
          <span class="clipboard-batch-bar__count">已选 {{ selectedIds.size }} 项</span>
          <button class="clipboard-batch-bar__link" @click="selectAllItems"
            :disabled="selectedIds.size === filteredItems.length">全选</button>
          <button class="clipboard-batch-bar__link" @click="deselectAllItems"
            :disabled="selectedIds.size === 0">取消</button>
        </div>
        <div class="clipboard-batch-bar__right">
          <button class="clipboard-batch-bar__delete" :disabled="selectedIds.size === 0"
            @click="batchDeleteSelected">
            <i class="fas fa-trash"></i> 删除选中 ({{ selectedIds.size }})
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, reactive } from 'vue'
import { useClipboard } from '../composables/useClipboard.js'
import { useFileManager } from '../composables/useFileManager.js'
import { useToast } from '../composables/useToast.js'
import { useConfirmDialog } from '../composables/useConfirmDialog.js'
import { groupItemsByTime, hashString } from '../utils/helpers.js'
import ClipboardItem from './ClipboardItem.vue'

const { confirm } = useConfirmDialog()
const toast = useToast()

const { state, sendContent, clearAll, deleteItem: deleteSingleItem, setDeviceName, startPolling, stopPolling } = useClipboard()
const { state: fmState } = useFileManager()

const inputRef = ref(null)
const listRef = ref(null)
const nameInputRef = ref(null)
const inputText = ref('')
const sending = ref(false)
const editingName = ref(false)
const editNameValue = ref('')
const expanded = ref(false)

function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) {
    nextTick(() => { if (inputRef.value) inputRef.value.focus() })
  }
}

const selectionMode = ref(false)
const selectedIds = ref(new Set())
const groupCollapse = reactive({})

const DEVICE_COLORS = ['#4FC3F7', '#81C784', '#FFB74D', '#F06292', '#CE93D8', '#4DD0E1', '#FF8A65', '#A1887F', '#90A4AE', '#AED581']

const isSearching = computed(() => fmState.searchQuery.trim().length > 0)

const filteredItems = computed(() => {
  const q = fmState.searchQuery.trim()
  if (!q) return state.items
  const lowerQ = q.toLowerCase()
  return state.items.filter(item =>
    item.content.toLowerCase().includes(lowerQ) || item.deviceName.toLowerCase().includes(lowerQ))
})

const groupedItems = computed(() => groupItemsByTime(filteredItems.value))
const hasTodayGroup = computed(() => groupedItems.value.some(g => g.key === 'today'))

function isGroupCollapsed(key) {
  if (groupCollapse[key] === undefined) return key !== 'today' && key !== 'yesterday'
  return groupCollapse[key]
}

function toggleGroup(key) { groupCollapse[key] = !isGroupCollapsed(key) }

const deviceColorCache = {}
function getDeviceColor(deviceName) {
  if (!deviceName) return ''
  if (deviceColorCache[deviceName]) return deviceColorCache[deviceName]
  const hash = hashString(deviceName)
  const color = DEVICE_COLORS[hash % DEVICE_COLORS.length]
  deviceColorCache[deviceName] = color
  return color
}

function toggleSelectionMode() {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) selectedIds.value.clear()
}
function isSelected(id) { return selectedIds.value.has(id) }
function toggleItemSelection(id) {
  const set = selectedIds.value
  set.has(id) ? set.delete(id) : set.add(id)
  selectedIds.value = new Set(set)
}
function selectAllItems() { selectedIds.value = new Set(filteredItems.value.map(item => item.id)) }
function deselectAllItems() { selectedIds.value.clear(); selectedIds.value = new Set() }

async function batchDeleteSelected() {
  if (selectedIds.value.size === 0) return
  const ok = await confirm(`确定要删除选中的 ${selectedIds.value.size} 条剪贴板内容吗？`, {
    title: '批量删除', confirmText: '删除', variant: 'danger'
  })
  if (!ok) return
  const ids = Array.from(selectedIds.value)
  let success = 0, fail = 0
  for (const id of ids) {
    try { await deleteSingleItem(id); success++ }
    catch { fail++ }
  }
  selectedIds.value.clear(); selectedIds.value = new Set()
  if (fail === 0) toast.success(`已删除 ${success} 条剪贴板内容`)
  else toast.warning(`删除完成：${success} 条成功，${fail} 条失败`)
}

function onItemDeleted(id) {
  const set = selectedIds.value
  if (set.has(id)) { set.delete(id); selectedIds.value = new Set(set) }
}

function scrollToToday() {
  if (!listRef.value) return
  if (isGroupCollapsed('today')) toggleGroup('today')
  nextTick(() => {
    // 获取滚动容器（.content-scroll）
    const scrollContainer = listRef.value.closest('.content-scroll')
    if (!scrollContainer) return

    // 找到“今天”分组标题元素
    const headers = listRef.value.querySelectorAll('.clipboard-group-header')
    let targetEl = null
    for (const h of headers) {
      const label = h.querySelector('.clipboard-group-header__label')
      if (label && label.textContent === '今天') {
        targetEl = h
        break
      }
    }
    if (!targetEl) {
      // 没找到则滚动到顶部
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // 获取固定头部的高度（包含展开区域，动态准确）
    const fixedHeader = document.querySelector('.clipboard-fixed-header')
    if (!fixedHeader) {
      // 容错：如果头部不存在，直接滚动到目标
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    const headerHeight = fixedHeader.offsetHeight

    // 计算目标元素相对于滚动容器的偏移
    const containerRect = scrollContainer.getBoundingClientRect()
    const targetRect = targetEl.getBoundingClientRect()
    const targetOffset = targetRect.top - containerRect.top + scrollContainer.scrollTop

    // 滚动到目标位置，减去 header 高度，使标题正好出现在 header 下方
    scrollContainer.scrollTo({
      top: targetOffset - headerHeight,
      behavior: 'smooth'
    })
  })
}

async function handleSend() {
  const text = inputText.value
  if (!text.trim() || sending.value) return
  sending.value = true
  try {
    await sendContent(text)
    inputText.value = ''
    nextTick(() => autoResize())
    toast.success('已同步到剪贴板')
  } catch (err) { toast.error(`发送失败: ${err.message}`) }
  finally { sending.value = false }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend() }
}

function handleGlobalKeydown(e) {
  if (e.key === 'Escape' && selectionMode.value) { e.preventDefault(); toggleSelectionMode() }
  if (e.key === 'Escape' && editingName.value) cancelEditName()
}

function autoResize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function editDeviceName() {
  editNameValue.value = state.deviceName
  editingName.value = true
  nextTick(() => { if (nameInputRef.value) { nameInputRef.value.focus(); nameInputRef.value.select() } })
}
function saveDeviceName() { const n = editNameValue.value.trim(); if (n) setDeviceName(n); editingName.value = false }
function cancelEditName() { editingName.value = false }

async function handleClearAll() {
  const ok = await confirm('确定要清空所有剪贴板内容吗？此操作不可撤销。', {
    title: '清空剪贴板', confirmText: '清空', variant: 'danger'
  })
  if (!ok) return
  try {
    await clearAll()
    selectedIds.value.clear(); selectedIds.value = new Set()
    toast.success('已清空全部剪贴板内容')
  } catch (err) { toast.error(`清空失败: ${err.message}`) }
}

watch(() => filteredItems.value.length, () => {
  const hasNew = state.items.some(item => item.isNew)
  if (hasNew && listRef.value) {
    nextTick(() => {
      listRef.value.scrollTop = 0
      setTimeout(() => { state.items.forEach(item => { item.isNew = false }) }, 2000)
    })
  }
})

onMounted(() => { startPolling(); window.addEventListener('keydown', handleGlobalKeydown) })
onUnmounted(() => { stopPolling(); window.removeEventListener('keydown', handleGlobalKeydown) })
</script>

<style scoped>
/* --- Clipboard Panel --------------------------------------- */
.clipboard-panel {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
}

/* --- Fixed Header (sticky at top) -------------------------- */
.clipboard-fixed-header {
  position: sticky;
  top: -24px;
  z-index: 20;
  background: var(--bg-deep);
  padding-bottom: 12px;
  margin-bottom: 4px;
}

/* --- Compact Bar (always visible) -------------------------- */
.clipboard-compact-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0px;
  gap: 8px;
  flex-wrap: wrap;
}

.clipboard-compact-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.clipboard-compact-bar__right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.clipboard-compact-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--accent);
  background: var(--accent-subtle);
  color: var(--accent-glow);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
}

.clipboard-compact-btn:hover {
  background: var(--accent);
  color: var(--text-inverse);
}

.clipboard-compact-btn i {
  font-size: 0.8rem;
}

.clipboard-device-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo);
}

.clipboard-device-name:hover {
  background: var(--bg-hover);
  color: var(--accent-glow);
}

.clipboard-device-name i {
  font-size: 1.0rem;
  color: var(--accent-dim);
}

.clipboard-device-name-input {
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.85rem;
  padding: 2px 8px;
  width: 140px;
  outline: none;
}

.clipboard-count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.clipboard-toolbar-btn {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
}

.clipboard-toolbar-btn:hover {
  border-color: var(--border-glow);
  color: var(--text-primary);
  background: var(--bg-hover);
}

.clipboard-toolbar-btn.active {
  border-color: var(--accent);
  color: var(--accent-glow);
  background: var(--accent-subtle);
}

.clipboard-clear-btn {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo);
}

.clipboard-clear-btn:hover {
  background: var(--danger);
  color: #fff;
}

/* --- Expanded Area (input) --------------------------------- */
.clipboard-expanded-area {
  padding-top: 8px;
}

.clipboard-input-wrap {
  display: flex;
  gap: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px;
  transition: border-color var(--duration-normal) var(--ease-out-expo), box-shadow var(--duration-normal) var(--ease-out-expo);
}

.clipboard-input-wrap:focus-within {
  border-color: var(--border-accent);
  box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 20px var(--accent-glow-subtle);
}

.clipboard-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.95rem;
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 48px;
}

.clipboard-input::placeholder { color: var(--text-muted); }

.clipboard-send-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 64px;
  padding: 8px 14px;
  background: var(--accent);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out-expo), box-shadow var(--duration-fast), opacity var(--duration-fast);
  flex-shrink: 0;
}

.clipboard-send-btn:hover:not(:disabled) {
  background: var(--accent-bright);
  box-shadow: 0 0 16px var(--accent-glow-subtle);
}

.clipboard-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.clipboard-send-btn i { font-size: 1rem; }

/* --- Header expand transition ------------------------------ */
.header-expand-enter-active {
  transition: all 250ms var(--ease-spring);
  overflow: hidden;
}
.header-expand-leave-active {
  transition: all 180ms var(--ease-out-expo);
  overflow: hidden;
}
.header-expand-enter-from,
.header-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  transform: translateY(-8px);
}
.header-expand-enter-to,
.header-expand-leave-from {
  opacity: 1;
  max-height: 200px;
}

/* --- Clipboard List ---------------------------------------- */
.clipboard-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
  margin-bottom: 25px;
}

.clipboard-list::-webkit-scrollbar { width: 4px; }
.clipboard-list::-webkit-scrollbar-thumb { background: var(--border-glow); border-radius: 2px; }

/* --- Loading State ----------------------------------------- */
.clipboard-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 0.9rem;
}
.clipboard-loading i { font-size: 1.5rem; }

/* --- Clipboard Empty State --------------------------------- */
.clipboard-empty {
  text-align: center;
  padding: 80px 20px;
  animation: cardReveal var(--duration-reveal) var(--ease-out-expo) both;
}

.clipboard-empty h4 {
  font-family: 'Playfair Display', serif;
  font-size: 1.3rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.clipboard-empty p { color: var(--text-muted); font-size: 0.9rem; }

/* --- 时间线分组标题 ----------------------------------------- */
.clipboard-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
  transition: color var(--duration-fast) var(--ease-out-expo);
  margin-top: 4px;
}

.clipboard-group-header:first-child { margin-top: 0; }

.clipboard-group-header:hover { color: var(--text-primary); }

.clipboard-group-header__left { display: flex; align-items: center; gap: 8px; }

.clipboard-group-header__arrow {
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform var(--duration-normal) var(--ease-out-expo);
}

.clipboard-group-header__arrow.expanded { transform: rotate(90deg); }

.clipboard-group-header__label {
  font-family: 'Playfair Display', serif;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: -0.01em;
}

.clipboard-group-header__count { font-size: 0.78rem; color: var(--text-muted); margin-left: 8px; }

/* --- 批量操作栏 --------------------------------------------- */
.clipboard-batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), var(--shadow-glow);
  padding: 10px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  max-width: calc(100% - 40px);
}

.clipboard-batch-bar__left { display: flex; align-items: baseline; gap: 12px; }
.clipboard-batch-bar__right { display: flex; align-items: center; gap: 8px; }
.clipboard-batch-bar__count { font-size: 0.85rem; font-weight: 600; color: var(--accent-glow); white-space: nowrap; }

.clipboard-batch-bar__link {
  background: none; border: none; color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif; font-size: 0.8rem; cursor: pointer;
  padding: 4px 8px; border-radius: var(--radius-sm); transition: all var(--duration-fast);
}

.clipboard-batch-bar__link:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
.clipboard-batch-bar__link:disabled { opacity: 0.4; cursor: not-allowed; }

.clipboard-batch-bar__delete {
  display: flex; align-items: center; gap: 6px; padding: 8px 16px;
  border-radius: var(--radius-md); border: 1px solid var(--danger); background: var(--danger-glow);
  color: var(--danger); font-family: 'DM Sans', sans-serif; font-size: 0.8rem; font-weight: 600;
  cursor: pointer; transition: all var(--duration-fast) var(--ease-out-expo); white-space: nowrap;
}

.clipboard-batch-bar__delete:hover:not(:disabled) { background: var(--danger); color: #fff; }
.clipboard-batch-bar__delete:disabled { opacity: 0.4; cursor: not-allowed; border-color: var(--text-muted); background: transparent; color: var(--text-muted); }

.batch-bar-slide-enter-active { transition: all 300ms var(--ease-spring); }
.batch-bar-slide-leave-active { transition: all 200ms var(--ease-out-expo); }
.batch-bar-slide-enter-from, .batch-bar-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.9); }

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .clipboard-fixed-header { top: -14px; padding-bottom: 8px; }
  .clipboard-compact-bar { padding: 10px 0; gap: 6px; }
  .clipboard-compact-btn { padding: 5px 10px; font-size: 0.72rem; }
  .clipboard-compact-btn span { display: none; }
  .clipboard-input-wrap { padding: 10px; gap: 8px; }
  .clipboard-input { font-size: 0.9rem; min-height: 42px; }
  .clipboard-send-btn { min-width: 52px; padding: 6px 10px; font-size: 0.75rem; }
  .clipboard-group-header__label { font-size: 0.9rem; }
  .clipboard-batch-bar { left: 10px; right: 10px; transform: none; border-radius: var(--radius-lg);
    padding: 10px 16px; gap: 12px; flex-wrap: wrap; bottom: 16px; max-width: none; }
  .clipboard-batch-bar__count { font-size: 0.8rem; }
  .clipboard-batch-bar__delete { padding: 8px 12px; font-size: 0.75rem; }
}

/* --- Responsive: Small Phone ------------------------------- */
@media (max-width: 480px) {
  .clipboard-compact-bar__left .clipboard-device-name span { display: none; }
  .clipboard-compact-bar__left .clipboard-count { font-size: 0.72rem; }
  .clipboard-input-wrap { padding: 8px; gap: 6px; }
  .clipboard-input { font-size: 16px; }
  .clipboard-send-btn { min-width: 44px; padding: 6px 8px; font-size: 0.7rem; }
  .clipboard-send-btn i { font-size: 0.85rem; }
  .clipboard-empty { padding: 40px 12px; }
  .clipboard-empty .empty-state-icon { font-size: 2.5rem; }
  .clipboard-empty h4 { font-size: 1.1rem; }
  .clipboard-batch-bar { padding: 8px 12px; gap: 8px; bottom: 12px; }
}
</style>
