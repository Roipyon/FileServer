<template>
  <TransitionGroup name="dl" tag="div" class="dl-progress-wrap">
    <div v-for="t in dl.tasks" :key="t.id" class="dl-progress-item" :class="{ done: t.done, failed: t.failed }">
      <div class="dl-progress-head">
        <i class="fas" :class="t.done ? 'fa-circle-check' : t.failed ? 'fa-circle-xmark' : 'fa-arrow-down'"></i>
        <span class="dl-progress-name" :title="t.name">{{ t.name }}</span>
        <span class="dl-progress-pct">{{ pct(t) }}</span>
      </div>
      <div class="dl-progress-bar">
        <div class="dl-progress-fill" :style="{ width: pct(t) }"></div>
      </div>
      <div class="dl-progress-meta">
        <span>{{ dl.fmtBytes(t.loaded) }}<template v-if="t.total"> / {{ dl.fmtBytes(t.total) }}</template></span>
        <span v-if="t.speed">{{ t.speed }}</span>
        <span v-if="t.eta">{{ t.eta }}</span>
      </div>
    </div>
  </TransitionGroup>
</template>

<script setup>
import { useDownloadProgress } from '../composables/useDownloadProgress'

const dl = useDownloadProgress()

function pct(t) {
  if (t.done) return '100%'
  if (!t.total) return '…'
  return Math.min(100, Math.round((t.loaded / t.total) * 100)) + '%'
}
</script>

<style scoped>
.dl-progress-wrap {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1600;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 280px;
  pointer-events: none;
}

.dl-progress-item {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dl-progress-item.done {
  border-color: var(--success, #34c77b);
}

.dl-progress-item.failed {
  border-color: var(--danger);
}

.dl-progress-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: var(--text-primary);
}

.dl-progress-head i {
  color: var(--accent);
  flex-shrink: 0;
}

.dl-progress-item.done .dl-progress-head i {
  color: var(--success, #34c77b);
}

.dl-progress-item.failed .dl-progress-head i {
  color: var(--danger);
}

.dl-progress-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.dl-progress-pct {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
  color: var(--text-secondary);
}

.dl-progress-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}

.dl-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 200ms ease;
}

.dl-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.62rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.dl-enter-active,
.dl-leave-active {
  transition: all 250ms ease;
}

.dl-enter-from,
.dl-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
