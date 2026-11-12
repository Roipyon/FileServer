import { reactive } from 'vue'

export interface DownloadTask {
  id: number
  name: string
  loaded: number
  total: number
  speed: string  // "2.5 MB/s"
  eta: string    // "剩余 3s"
  done: boolean
  failed: boolean
}

const tasks = reactive<DownloadTask[]>([])
let uid = 0

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB'
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB'
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + ' KB'
  return n + ' B'
}

function fmtEta(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return ''
  if (sec >= 3600) return `剩余 ${Math.round(sec / 3600)}h`
  if (sec >= 60) return `剩余 ${Math.round(sec / 60)}m`
  return `剩余 ${Math.max(1, Math.round(sec))}s`
}

/**
 * 下载进度面板状态：外网/流式下载在页面内显示进度、速度与剩余时间；
 * 内网原生下载由浏览器接管，不经过此处。
 */
export function useDownloadProgress() {
  /** 面板容量上限：超过时淘汰最旧的未完成任务 */
  function enforceCap(cap = 4) {
    const live = tasks.filter((t) => !t.done && !t.failed)
    while (live.length > cap) {
      const oldest = live.shift()
      if (oldest) remove(oldest.id)
    }
  }

  /** 新建任务，返回喂进度的回调 (loaded, total) */
  function start(name: string): (loaded: number, total: number) => void {
    enforceCap()
    const t = reactive<DownloadTask>({
      id: ++uid,
      name,
      loaded: 0,
      total: 0,
      speed: '',
      eta: '',
      done: false,
      failed: false
    })
    tasks.push(t)

    let lastT = Date.now()
    let lastLoaded = 0
    return (loaded: number, total: number) => {
      t.loaded = loaded
      if (total) t.total = total
      const now = Date.now()
      const dt = (now - lastT) / 1000
      if (dt >= 0.4) {
        const bps = (loaded - lastLoaded) / dt
        t.speed = fmtBytes(bps) + '/s'
        t.eta = total ? fmtEta((total - loaded) / bps) : ''
        lastT = now
        lastLoaded = loaded
      }
    }
  }

  function finish(id: number) {
    const t = tasks.find((x) => x.id === id)
    if (t) {
      t.done = true
      t.speed = ''
      t.eta = ''
      setTimeout(() => remove(id), 2500)
    }
  }

  function fail(id: number) {
    const t = tasks.find((x) => x.id === id)
    if (t) {
      t.failed = true
      setTimeout(() => remove(id), 4000)
    }
  }

  function remove(id: number) {
    const i = tasks.findIndex((x) => x.id === id)
    if (i >= 0) tasks.splice(i, 1)
  }

  return { tasks, start, finish, fail, remove, fmtBytes }
}
