import { ref, nextTick, onMounted, onUnmounted } from 'vue'

/**
 * 文件弹出菜单（「更多操作」）共享逻辑
 * 用于 FileGridView 和 FileListView
 */
export function useFilePopover() {
  const menuVisible = ref(false)
  const menuFile = ref(null)
  const menuX = ref(0)
  const menuY = ref(0)
  const popoverRef = ref(null)

  async function openMenu(file, e) {
    e.stopPropagation()
    if (menuVisible.value && menuFile.value === file) {
      menuVisible.value = false
      return
    }
    menuFile.value = file
    menuX.value = e.clientX + 10
    menuY.value = e.clientY + 10
    menuVisible.value = true

    await nextTick()
    const rect = popoverRef.value?.getBoundingClientRect()
    if (!rect) return

    // 边界修正
    const overflowRight = rect.right - window.innerWidth
    const overflowBottom = rect.bottom - window.innerHeight

    if (overflowRight > 0) menuX.value -= overflowRight + 5
    if (overflowBottom > 0) menuY.value -= overflowBottom + 5
  }

  function closeMenu() {
    menuVisible.value = false
  }

  function onGlobalClick(e) {
    if (menuVisible.value && !e.target.closest('.list-popover')) {
      closeMenu()
    }
  }

  onMounted(() => document.addEventListener('click', onGlobalClick))
  onUnmounted(() => document.removeEventListener('click', onGlobalClick))

  return {
    menuVisible,
    menuFile,
    menuX,
    menuY,
    popoverRef,
    openMenu,
    closeMenu
  }
}
