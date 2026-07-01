<template>
  <div class="status-bar">
    <div class="status-bar-left">
      <button class="status-info-btn" @click="$emit('open-connection-info')" title="连接信息">
        <i class="fas fa-wifi"></i>
      </button>
      <span
        class="status-dot"
        :class="connected ? 'connected' : 'disconnected'"
      ></span>
      {{ connected ? '连接正常' : '连接断开' }}
      <span class="status-separator"></span>
      <span class="status-uptime" v-if="uptimeText">
        <i class="fas fa-clock"></i> {{ uptimeText }}
      </span>
    </div>
    <div class="status-bar-right">
      <span class="status-disk" v-if="diskInfo" :title="diskInfo.detail">
        <i class="fas fa-hard-drive"></i> {{ diskInfo.text }}
      </span>
      <span class="status-separator" v-if="diskInfo"></span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useFileManager } from '../composables/useFileManager.js'
import { useClipboard } from '../composables/useClipboard.js'

defineEmits(['open-connection-info'])

const { state: fileState } = useFileManager()
const { state: clipboardState } = useClipboard()
const uptimeSeconds = ref(0)
let uptimeTimer = null

// 磁盘信息
const diskInfo = ref(null)
let diskTimer = null

const connected = computed(() => {
  return fileState.currentSection === 'clipboard' ? clipboardState.connected : fileState.connected
})

const uptimeText = computed(() => {
  const s = uptimeSeconds.value
  if (s < 60) return `${Math.round(s)}m`
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
})

function refreshUptime() {
  if (connected.value) {
    fetch(`${window.location.origin}/api/server-info`)
      .then(r => r.json())
      .then(data => {
        if (data.uptime != null) {
          uptimeSeconds.value = data.uptime
        }
      })
      .catch(() => {
        uptimeSeconds.value += 60
      })
  } else {
    uptimeSeconds.value = 0
  }
}

async function refreshDiskStatus() {
  try {
    const resp = await fetch(`${window.location.origin}/api/disk-status`)
    if (!resp.ok) return
    const data = await resp.json()
    if (data.error) {
      diskInfo.value = null
      return
    }
    diskInfo.value = {
      text: `剩余 ${data.free} / ${data.total}`,
      detail: `已用 ${data.usedPercent}% · 剩余 ${data.free} / 总共 ${data.total}`,
      percent: data.usedPercent,
    }
  } catch {
    // 静默失败，不显示
  }
}

onMounted(() => {
  refreshUptime()
  refreshDiskStatus()
  uptimeTimer = setInterval(refreshUptime, 60000)
  diskTimer = setInterval(refreshDiskStatus, 60000)
})

onUnmounted(() => {
  if (uptimeTimer) clearInterval(uptimeTimer)
  if (diskTimer) clearInterval(diskTimer)
})
</script>

<style scoped>
.status-bar {
  height: 36px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.status-bar-left,
.status-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-info-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  transition: all 150ms var(--ease-out-expo);
}

.status-info-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.status-separator {
  width: 1px;
  height: 12px;
  background: var(--border);
  opacity: 0.3;
  margin: 0 4px;
}

.status-uptime {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 0.72rem;
}

.status-uptime i {
  font-size: 0.7rem;
}

.status-disk {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 0.72rem;
  cursor: default;
}

.status-disk i {
  font-size: 0.7rem;
  color: var(--accent-dim);
}
</style>
