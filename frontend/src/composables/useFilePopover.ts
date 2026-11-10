import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import type { ViewerFile } from './useViewer'

/**
 * 文件弹出菜单（「更多操作」）共享逻辑
 * 用于 FileGridView 和 FileListView
 */
export function useFilePopover() {
  const menuVisible = ref(false)
  const menuFile = ref<ViewerFile | null>(null)
  const menuX = ref(0)
  const menuY = ref(0)
  const popoverRef = ref<HTMLElement | null>(null)

  async function openMenu(file: ViewerFile, e: MouseEvent): Promise<void> {
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

  function closeMenu(): void {
    menuVisible.value = false
  }

  function onGlobalClick(e: MouseEvent): void {
    if (menuVisible.value && !(e.target as HTMLElement | null)?.closest('.list-popover')) {
      closeMenu()
    }
  }

  function onGlobalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && menuVisible.value) {
      closeMenu()
    }
  }

  onMounted(() => {
    document.addEventListener('click', onGlobalClick)
    document.addEventListener('keydown', onGlobalKeydown)
  })
  onUnmounted(() => {
    document.removeEventListener('click', onGlobalClick)
    document.removeEventListener('keydown', onGlobalKeydown)
  })

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
