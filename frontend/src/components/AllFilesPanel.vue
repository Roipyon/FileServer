<template>
    <!-- Files Section -->
    <div>
        <div class="section-header">
        <h3>所有文件</h3>
        <p>{{ displayFileCount }} 个文件</p>
        </div>

        <!-- Type Filter Toolbar -->
        <div class="filter-bar">
          <button
            v-for="f in FILTER_OPTIONS"
            :key="f.key"
            class="filter-btn"
            :class="{ active: activeFilter === f.key }"
            @click="setFilter(f.key)"
          >
            <i :class="f.icon"></i>
            <span>{{ f.label }}</span>
          </button>
        </div>

        <!-- Grouped Views -->
        <FileGridView
          v-if="state.currentView === 'grid'"
          :groups="groupedFiles"
          :expanded-groups="expandedGroups"
          :selection-mode="state.selectionMode"
          :selected-files="state.selectedFiles"
          @toggle-group="toggleGroup"
        />
        <FileListView
          v-if="state.currentView === 'list'"
          :groups="groupedFiles"
          :expanded-groups="expandedGroups"
          :selection-mode="state.selectionMode"
          :selected-files="state.selectedFiles"
          @toggle-group="toggleGroup"
        />

        <div v-if="displayTotal === 0 && !state.loading" class="empty-state">
        <div class="empty-state-icon">
            <i class="fas fa-folder-open"></i>
        </div>
        <h4>暂无共享文件</h4>
        <p>将文件放入共享文件夹或上传新文件</p>
        </div>
    </div>
</template>
<script setup>
import { ref, computed, reactive, watch } from 'vue'
import FileGridView from './FileGridView.vue'
import FileListView from './FileListView.vue'
import { useFileManager } from '../composables/useFileManager.js'
import { getFileCategory } from '../utils/fileTypes.js'
import { groupFilesByTime } from '../utils/helpers.js'

const { state } = useFileManager()

// ==================== 类型筛选 ====================
const FILTER_OPTIONS = [
  { key: 'all',    label: '全部', icon: 'fas fa-th-large' },
  { key: 'image',  label: '图片', icon: 'fas fa-image' },
  { key: 'video',  label: '视频', icon: 'fas fa-video' },
  { key: 'doc',    label: '文档', icon: 'fas fa-file-lines' },
  { key: 'archive',label: '压缩包', icon: 'fas fa-file-zipper' },
  { key: 'audio',  label: '音频', icon: 'fas fa-music' },
  { key: 'other',  label: '其他', icon: 'fas fa-file' },
]

const activeFilter = ref('all')

function setFilter(key) {
  activeFilter.value = key
}

/**
 * 按类型过滤文件
 */
function applyTypeFilter(files) {
  const filter = activeFilter.value
  if (filter === 'all') return files

  return files.filter(f => {
    const cat = getFileCategory(f.name)
    switch (filter) {
      case 'image':   return cat === 'image'
      case 'video':   return cat === 'video'
      case 'doc':     return cat === 'text' || cat === 'office' || cat === 'pdf'
      case 'archive': return cat === 'archive'
      case 'audio':   return cat === 'audio'
      case 'other':   return cat === 'unknown'
      default:        return true
    }
  })
}

// ==================== 显示用量统计 ====================
const displayTotal = computed(() => {
  const filtered = applyTypeFilter(state.filteredFiles)
  return filtered.length
})

const displayFileCount = computed(() => {
  if (activeFilter.value === 'all') return state.filteredFiles.length
  return displayTotal.value
})

// ==================== 时间分组 ====================
const groupedFiles = computed(() => {
  const filtered = applyTypeFilter(state.filteredFiles)
  return groupFilesByTime(filtered)
})

// ==================== 分组展开/收起 ====================
const expandedGroups = reactive({
  today: true,
  yesterday: true,
  thisWeek: false,
  lastWeek: false,
  earlier: false,
})

function toggleGroup(key) {
  expandedGroups[key] = !expandedGroups[key]
}

// 当切换 filter 时自动展开有内容的分组
watch(activeFilter, () => {
  // 重新计算后，有内容的分组自动展开 today/yesterday
  expandedGroups.today = true
  expandedGroups.yesterday = true
  expandedGroups.thisWeek = false
  expandedGroups.lastWeek = false
  expandedGroups.earlier = false
})
</script>

<style scoped>
.section-header {
  margin-bottom: 24px;
}

.section-header h3 {
  font-family: 'Playfair Display', serif;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
  letter-spacing: -0.02em;
}

.section-header p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* --- Type Filter Bar -------------------------------------- */
.filter-bar {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out-expo);
  white-space: nowrap;
}

.filter-btn i {
  font-size: 1.2rem;
}

.filter-btn:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.filter-btn.active {
  border-color: var(--accent);
  background: var(--accent-subtle);
  color: var(--accent-glow);
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  animation: cardReveal var(--duration-reveal) var(--ease-out-expo) both;
}

.empty-state h4 {
  font-family: 'Playfair Display', serif;
  font-size: 1.3rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.empty-state p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

@media (max-width: 768px) {
  .section-header {
    margin-bottom: 18px;
  }
  .section-header h3 {
    font-size: 1.35rem;
  }
  .filter-bar {
    margin-bottom: 16px;
    gap: 6px;
  }
  .filter-btn {
    padding: 5px 12px;
    font-size: 0.75rem;
  }
  .empty-state {
    padding: 50px 16px;
  }
  .empty-state-icon {
    font-size: 2.5rem;
  }
  .empty-state h4 {
    font-size: 1.1rem;
  }
}

@media (max-width: 480px) {
  .filter-bar {
    justify-content: center;
  }
  .filter-btn {
    padding: 6px 10px;
    font-size: 0.75rem;
  }
  .filter-btn i {
    font-size: 1.2rem;
  }
  .filter-btn span {
    display: none;
  }
}
</style>
