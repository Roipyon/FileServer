<template>
  <div
    ref="containerRef"
    class="fab-container"
    :class="[`fab-side-${side}`, { 'fab-open': isOpen, 'fab-gesturing': gesturing, 'fab-dragging': dragMode, 'fab-summon': summonGlow }]"
    :style="containerStyle"
  >
    <!-- 菜单常驻渲染：透明度/位移由唤出程度驱动，跟随手指滑出与收回（把手不动） -->
    <div class="fab-menu" :style="menuStyle" @pointerdown.stop>
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

    <!-- 圆角矩形把手：长按拖动改位置；短按单击唤出/收回；短按向中心滑 → 菜单渐进滑出 -->
    <button
      ref="handleRef"
      class="fab-handle"
      :title="isOpen ? '收起菜单' : '打开菜单'"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @contextmenu.prevent
    >
      <i class="fas" :class="side === 'right' ? 'fa-chevron-left' : 'fa-chevron-right'"></i>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  section: { type: String, default: 'files' },
  currentView: { type: String, default: 'grid' }
})

const emit = defineEmits(['upload', 'toggle-view', 'batch-select', 'quick-paste', 'refresh', 'gen-upload-token'])
const isOpen = ref(false)

const isClipboard = computed(() => props.section === 'clipboard')

// ==================== 把手位置（贴左/右边缘，长按拖动，记忆位置） ====================
const POS_KEY = 'fileserver-fab-pos'
const TAP_TOL = 6             // 未超此位移判定为点击(px)
const LONG_PRESS_MS = 350     // 长按进入拖动的时限
const SWIPE_MAX_RATIO = 0.28  // 唤出全程 ≈ 28% 屏宽
const RETRACT_MAX = 44        // 已开状态向边缘收回的行程(px)：真机手指到屏幕边缘仅约 25px
const OPEN_AT = 0.5           // 松手时唤出程度过半即展开

const containerRef = ref(null)
const handleRef = ref(null)
const side = ref('right')       // 'left' | 'right'
const topPct = ref(70)          // 把手垂直位置（视口高度百分比）
const dragMode = ref(false)     // 长按自由拖动中
const swipeMode = ref(false)    // 短按滑动唤出/收回中
const reveal = ref(0)           // 菜单唤出程度 0..1（滑动期间实时跟随）
const tx = ref(0)               // 长按拖动横向偏移(px)
const ty = ref(0)               // 长按拖动纵向偏移(px)

const gesturing = computed(() => dragMode.value || swipeMode.value)
const summonGlow = computed(() => swipeMode.value && reveal.value > 0.12)

let startX = 0
let startY = 0
let startCX = 0                 // 按下时把手中心（视口坐标）
let startCY = 0
let handleW = 34
let startSide = 'right'
let mode = null                 // null | 'pending' | 'swipe' | 'drag'
let baseReveal = 0              // 手势起始时菜单开合（1=已开）
let lpTimer = 0
let glideTimer = 0
let activeId = null

const containerStyle = computed(() => {
  const s = { top: `${topPct.value}%` }
  if (tx.value || ty.value) s.transform = `translate(${tx.value}px, calc(-50% + ${ty.value}px))`
  return s
})

/** 菜单位移：右侧藏在把手后方（向右偏 100%+12px），左侧镜像 */
function menuHiddenX(r) {
  const off = 1 - r
  return side.value === 'right'
    ? `translateX(calc(${off * 100}% + ${off * 12}px))`
    : `translateX(calc(${-off * 100}% - ${off * 12}px))`
}

const menuStyle = computed(() => {
  if (swipeMode.value) {
    const r = reveal.value
    return {
      opacity: String(r),
      transform: `translateY(-50%) ${menuHiddenX(r)}`,
      pointerEvents: r > 0.95 ? 'auto' : 'none'
    }
  }
  if (isOpen.value) {
    return { opacity: '1', transform: 'translateY(-50%) translateX(0)', pointerEvents: 'auto' }
  }
  return { opacity: '0', transform: `translateY(-50%) ${menuHiddenX(0)}`, pointerEvents: 'none' }
})

try {
  const saved = JSON.parse(localStorage.getItem(POS_KEY))
  if (saved && (saved.side === 'left' || saved.side === 'right')) {
    side.value = saved.side
    topPct.value = Math.min(92, Math.max(8, Number(saved.top) || 70))
  }
} catch {}

function persistPos() {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ side: side.value, top: topPct.value })) } catch {}
}

function swipeMax() {
  return Math.max(110, (window.innerWidth || 360) * SWIPE_MAX_RATIO)
}

/** 把手贴边静止时的中心 x（env 安全边距取计算值，取不到回退 10px） */
function anchorX(sideStr, vw) {
  const cs = getComputedStyle(containerRef.value)
  const pad = parseFloat(sideStr === 'right' ? cs.paddingRight : cs.paddingLeft) || 10
  return sideStr === 'right' ? vw - pad - handleW / 2 : pad + handleW / 2
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return
  if (activeId !== null) return
  activeId = e.pointerId
  try { handleRef.value.setPointerCapture?.(e.pointerId) } catch {}
  const rect = handleRef.value.getBoundingClientRect()
  handleW = rect.width || 34
  startCX = rect.left + handleW / 2
  startCY = rect.top + rect.height / 2
  startX = e.clientX
  startY = e.clientY
  startSide = side.value
  baseReveal = isOpen.value ? 1 : 0
  mode = 'pending'
  tx.value = 0
  ty.value = 0
  reveal.value = baseReveal
  clearTimeout(glideTimer)
  lpTimer = setTimeout(() => {
    if (mode !== 'pending') return
    mode = 'drag'
    dragMode.value = true
    if (isOpen.value) isOpen.value = false // 拖动前先收起菜单
    navigator.vibrate?.(20)
  }, LONG_PRESS_MS)
}

function onPointerMove(e) {
  if (e.pointerId !== activeId || !mode) return

  if (mode === 'pending') {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) <= TAP_TOL) return
    clearTimeout(lpTimer)
    mode = 'swipe'
    swipeMode.value = true
    applySwipe(e.clientX)
    return
  }

  if (mode === 'swipe') {
    applySwipe(e.clientX)
    return
  }

  // drag：把手自由跟随手指（限制在视口内），菜单不动
  const vw = window.innerWidth || 360
  const vh = window.innerHeight || 640
  const cx = Math.min(vw - handleW / 2 - 4, Math.max(handleW / 2 + 4, startCX + (e.clientX - startX)))
  const cy = Math.min(vh - 40, Math.max(40, startCY + (e.clientY - startY)))
  tx.value = cx - startCX
  ty.value = cy - startCY
}

/** 短按滑动：把手不动，仅菜单随手指朝中心渐进滑出 / 朝边缘收回（负向位移用于收回） */
function applySwipe(clientX) {
  const dir = side.value === 'right' ? -1 : 1 // 屏幕坐标上“朝中心”的符号
  const toward = (clientX - startX) * dir
  // 唤出用大行程；已开状态向边缘收回用短行程（手指很快顶到屏幕边缘）
  const range = baseReveal === 1 ? RETRACT_MAX : swipeMax()
  reveal.value = Math.min(1, Math.max(0, baseReveal + toward / range))
}

function finishGesture(e, cancelled) {
  if (e.pointerId !== activeId) return
  activeId = null
  clearTimeout(lpTimer)
  const m = mode
  mode = null
  if (!m) return

  if (m === 'pending') {
    if (!cancelled) isOpen.value = !isOpen.value // 单击：切换菜单
    return
  }

  if (m === 'swipe') {
    const opened = !cancelled && reveal.value >= OPEN_AT
    swipeMode.value = false
    isOpen.value = opened
    reveal.value = opened ? 1 : 0
    return
  }

  // drag 落定：防跳两步走——先换算到目标锚点（视觉位置不变），
  // 下一帧再归零，由过渡把把手平滑滑入边缘；纵向折算进 topPct 同步过渡。
  dragMode.value = false
  if (cancelled) {
    tx.value = 0
    ty.value = 0
    return
  }
  const vw = window.innerWidth || 360
  const vh = window.innerHeight || 640
  const dragCX = startCX + tx.value
  const dragCY = startCY + ty.value
  const finalSide = dragCX < vw / 2 ? 'left' : 'right'
  topPct.value = Math.min(92, Math.max(8, (dragCY / vh) * 100))
  ty.value = 0
  if (finalSide !== startSide) {
    side.value = finalSide
    tx.value = dragCX - anchorX(finalSide, vw) // 换算后视觉一致
    glideTimer = setTimeout(() => { tx.value = 0 }, 40)
  } else {
    tx.value = 0
  }
  persistPos()
}

function onPointerUp(e) { finishGesture(e, false) }
function onPointerCancel(e) { finishGesture(e, true) }

// 点击把手外区域收起菜单
function onDocPointerDown(e) {
  if (!isOpen.value) return
  if (containerRef.value && containerRef.value.contains(e.target)) return
  isOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  clearTimeout(lpTimer)
  clearTimeout(glideTimer)
})

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
  z-index: 200;
  display: flex;
  align-items: center;
  transform: translateY(-50%);
  pointer-events: none; /* 容器不拦截空白区域，仅把手与菜单可点 */
  transition: transform 300ms var(--ease-spring), top 300ms var(--ease-spring);
}

/* 手势期间关闭过渡：位置完全跟随手指；松手后恢复过渡实现回弹/吸附 */
.fab-container.fab-gesturing {
  transition: none;
}

.fab-container.fab-side-right {
  right: 0;
  padding-right: max(10px, env(safe-area-inset-right));
}

.fab-container.fab-side-left {
  left: 0;
  padding-left: max(10px, env(safe-area-inset-left));
}

.fab-handle {
  position: relative; /* 叠于滑出菜单之上，形成从把手后方抽出的层次 */
  pointer-events: auto;
  width: 34px;
  height: 56px;
  border-radius: 14px;
  border: 1px solid var(--border-glow);
  background: var(--bg-elevated);
  backdrop-filter: blur(8px);
  color: var(--text-secondary);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  box-shadow: var(--shadow-md);
  transition: background var(--duration-fast) var(--ease-out-expo),
              color var(--duration-fast) var(--ease-out-expo),
              transform 160ms var(--ease-spring),
              box-shadow var(--duration-fast) var(--ease-out-expo);
  touch-action: none; /* 手势期间禁用页面滚动 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.fab-handle:hover {
  color: var(--accent-glow);
  border-color: var(--border-accent);
}

.fab-handle:active {
  cursor: grabbing;
}

.fab-dragging .fab-handle {
  transition: none;
  cursor: grabbing;
  transform: scale(1.06);
  border-color: var(--border-accent);
  color: var(--accent-glow);
}

/* 滑动唤出中：把手压感发光 */
.fab-summon .fab-handle {
  color: var(--accent-glow);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle), 0 0 24px var(--accent-glow-subtle);
}

.fab-open .fab-handle {
  color: var(--accent);
  border-color: var(--border-accent);
  background: var(--bg-elevated);
}

/* --- Menu（绝对定位于把手内侧，垂直居中于把手） ---------------- */
.fab-menu {
  position: absolute;
  top: 50%;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  border: 1px solid var(--border-glow);
  box-shadow: var(--shadow-lg);
  transition: opacity 200ms var(--ease-out-expo), transform 300ms var(--ease-spring);
  will-change: transform, opacity;
}

.fab-gesturing .fab-menu {
  transition: none; /* 滑动期间由内联样式逐帧驱动 */
}

.fab-side-right .fab-menu {
  right: calc(100% + 12px);
  align-items: flex-end;
}

.fab-side-left .fab-menu {
  left: calc(100% + 12px);
  align-items: flex-start;
}

.fab-menu-item {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--border-glow);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  transition: all var(--duration-normal) var(--ease-spring);
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
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: all var(--duration-normal) var(--ease-out-expo);
  border: 1px solid var(--border);
  z-index: 1;
}

.fab-side-right .fab-tooltip {
  right: 54px;
  transform: translateY(-50%) translateX(8px);
}

.fab-side-left .fab-tooltip {
  left: 54px;
  transform: translateY(-50%) translateX(-8px);
}

.fab-menu-item:hover .fab-tooltip {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

/* --- Responsive: Mobile ------------------------------------ */
@media (max-width: 768px) {
  .fab-handle {
    width: 30px;
    height: 50px;
  }

  .fab-menu-item {
    width: 40px;
    height: 40px;
    font-size: 0.85rem;
  }
}
</style>
