// 跨风格轨道逻辑层（minimal 圆点轨 / codex 刻度轨共用）：
// 数据装配 / 布局钉位 / 阅读间谍 / 条带翻页 / 卡片预览 / 失败提示 / 收藏 / 手机模式。
// 节点数据形态（RailMarker）与几何常量（行距 14px）为插件自身设计——两风格行距一致，
// 翻页步距与跟读滚动对任意风格成立（风格差异只在节点视觉与 hover 呈现）。
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { FocusState, NavInjected, ObservableFace, RailMarker, SessionListLike, Translate } from '../shared/types.ts'
import { DEFAULT_ALIGN, DEFAULT_BAND, DEFAULT_CARD_COUNT, DEFAULT_CARD_ITEMS, DEFAULT_MARK_TONE, DEFAULT_PAGING, DEFAULT_SCROLL, DEFAULT_SEARCH_SCOPES, DEFAULT_SHOW, DEFAULT_STYLE, type BandHeight, type CardCount, type CardItem, type MarkTone, type NavStyle, type RailAlign, type ScrollMode, type SearchScope, type ShowMode } from '../../settings.ts'

/* ================= 数据装配 ================= */

/** 锚点 key：镜像聊天行锚点公式 '<kind长度>:<kind><id>'，kind 段固定 'input-message'（DOM 契约） */
function anchorKey(id: unknown): string {
  return '13:input-message' + String(id)
}

/** 投影条目（含可选性能指标） */
interface ProjectedEntry {
  turn: number
  id: string
  seq: number
  time: number
  text: string
  metrics?: { durationMs: number; firstTokenMs: number; tokensPerSec: number }
}

/** 投影值 → 条目（结构守卫：缺 id/seq/turn 的脏数据丢弃） */
function projectedEntries(face: ObservableFace | undefined): ProjectedEntry[] {
  const value = face?.getSnapshot()
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ProjectedEntry =>
    typeof item === 'object' && item !== null
    && typeof (item as { id?: unknown }).id === 'string'
    && typeof (item as { seq?: unknown }).seq === 'number'
    && typeof (item as { turn?: unknown }).turn === 'number')
}

/** 结构相等：members 全等即内容一致（React bail out 用） */
function sameMarkers(a: readonly RailMarker[], b: readonly RailMarker[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].members.length !== b[i].members.length) return false
    for (let j = 0; j < a[i].members.length; j++) {
      if (a[i].members[j] !== b[i].members[j]) return false
    }
  }
  return true
}

/** 活窗口行最小面 */
interface LiveRow {
  key: string
  anchorSeq: number
  time: number
  text: string
}

/**
 * 回合标记装配：投影条目（全量）+ 活窗口行（投影未收录才补）统一排序后按回合分组。
 * 同回合连续条目合并为同一标记（锚点取首问）。
 */
function buildMarkers(projected: readonly ProjectedEntry[], live: readonly LiveRow[]): RailMarker[] {
  const seen = new Set<string>()
  const merged: { turn: number | null; seq: number; key: string; time: number; text: string; metrics?: { durationMs: number; firstTokenMs: number; tokensPerSec: number } }[] = []
  for (const p of projected) {
    const key = anchorKey(p.id)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ turn: p.turn, seq: p.seq, key, time: p.time, text: p.text, metrics: p.metrics })
  }
  for (const l of live) {
    if (seen.has(l.key)) continue
    seen.add(l.key)
    merged.push({ turn: null, seq: l.anchorSeq, key: l.key, time: l.time, text: l.text })
  }
  merged.sort((a, b) => a.seq - b.seq)
  const markers: RailMarker[] = []
  for (const m of merged) {
    const tail = markers[markers.length - 1]
    if (tail !== undefined && tail.turn !== null && tail.turn === m.turn) {
      markers[markers.length - 1] = { ...tail, texts: [...tail.texts, m.text], members: [...tail.members, m.key] }
    } else {
      markers.push({ turn: m.turn, key: m.key, seq: m.seq, time: m.time, texts: [m.text], members: [m.key], metrics: m.metrics })
    }
  }
  return markers
}

/** 圆点数据：会话可见性 + 标记装配（订阅集中管理，共用一条刷新管线） */
export function useMarkerData(
  injected: NavInjected | undefined,
  useSessions?: <S>(selector: (s: SessionListLike) => S) => S,
): { sessionId: string | undefined; visible: boolean; markers: RailMarker[] } {
  const current = useSessions?.((s) => s.current) as string | undefined
  const summary = useSessions?.((s) => (current === undefined ? undefined : s.byId?.[String(current)]))
  // 仅对话视图显示（[data-chat-flow] 只在对话消息流渲染；Trajectory 视图与会话未加载时不存在）
  const [viewOk, setViewOk] = useState<boolean>(() => document.querySelector('[data-chat-flow]') !== null)
  useEffect(() => {
    const check = (): void => setViewOk(document.querySelector('[data-chat-flow]') !== null)
    check()
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check)
    observer?.observe(document.body, { childList: true, subtree: true })
    return () => { observer?.disconnect() }
  }, [])
  const visible = current !== undefined && summary !== undefined && summary.blank !== true && viewOk
  const [markers, setMarkers] = useState<RailMarker[]>([])
  const cacheRef = useRef<RailMarker[]>([])

  useEffect(() => {
    if (!visible || current === undefined || injected === undefined) {
      cacheRef.current = []
      setMarkers([])
      return
    }
    const face = injected.questionProjection(current)
    // 内容刷新经 rAF 合并：流式输出/历史装载时一帧内可能多次变更事件，
    // 只做一次装配（buildMarkers 遍历全量投影 + 活窗行，频繁执行会拖慢长会话）
    let raf = 0
    const refresh = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const next = buildMarkers(projectedEntries(face), injected.readQuestions(current) as unknown as LiveRow[])
        if (sameMarkers(next, cacheRef.current)) {
          setMarkers(cacheRef.current)
          return
        }
        cacheRef.current = next
        setMarkers(next)
      })
    }
    refresh()
    const offProjection = face?.subscribe(refresh) ?? (() => {})
    const offContent = injected.subscribeContent(current, refresh)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      offProjection()
      offContent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, current, visible])

  return { sessionId: current, visible, markers }
}

/* ================= 布局钉位 ================= */

/** 对话列根元素（桌面 rail 钉位基准——保持历史稳定实现） */
function conversationRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="conversation"] > div[data-phase]')
}

/** 手机搜索按钮宿主：对话滚动容器 [data-conversation-scroll]（sticky 粘附基准） */
function mobileSearchHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-scroll]')
}

/** 期望几何：rail 钉到对话列（对齐侧决定 edge 归属）；offset 为 rail 与对话列边缘的距离 */
function desiredGeometry(panel: HTMLElement, align: RailAlign, offset: number): { top: string; height: string; edge: string; side: 'left' | 'right' } | null {
  const frame = panel.closest('[data-shell-overlay]')?.parentElement ?? null
  const root = conversationRoot()
  if (frame === null || root === null) return null
  const fr = frame.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  if (rr.height <= 0 || rr.width <= 0) return null
  // 取整到整数像素：getBoundingClientRect 的浮点噪声（如 3.05e-05px）
  // 会让字符串比较永远 dirty，布局循环停不下来
  const top = Math.round(rr.top - fr.top)
  const height = Math.round(rr.height)
  return align === 'right'
    ? { top: top + 'px', height: height + 'px', edge: Math.round(fr.right - rr.right + offset) + 'px', side: 'right' }
    : { top: top + 'px', height: height + 'px', edge: Math.round(rr.left - fr.left + offset) + 'px', side: 'left' }
}

/** 布局钉位：期望几何 → 比对 → 写入（rAF 循环，连续 3 帧稳定停车；resize/尺寸变化唤醒） */
/**
 * 布局钉位：校准状态机（鲁棒 + 长会话低成本）。
 *
 * 会话/工作区切换时对话区可能整体重建、或复用同一容器异步填充——校准必须
 * 覆盖这些路径，同时**行级消息增删绝不唤醒校准**（那会让长会话的 rAF 校准
 * 循环停不下来，每帧 reflow 拖慢一切交互——与对话几何无关）。
 *
 * 状态机：
 *  - running：切换/尺寸事件后启动，每帧 calibrate 一次；
 *      changed → 重置稳定帧；stable → 连续 3 帧停车（parked）；
 *      missing（对话区未出现/高度为 0）→ 不停车，继续等待重建完成。
 *  - parked：静默。唤醒条件：
 *      1) ResizeObserver（frame / 对话区根元素尺寸变化）
 *      2) window resize
 *      3) MutationObserver 发现对话区根元素被移除或替换（会话/工作区切换）
 *      4) effect 依赖变化重启（sessionId / visible / align / offset）
 *
 * 行级变化（追加消息、装载历史、其他插件改 body 子树）只做一次 O(1) 的
 * isConnected 检查，不唤醒校准。
 */
export function usePinning(panelRef: RefObject<HTMLDivElement>, visible: boolean, align: RailAlign, offset = 0, sessionId?: string): void {
  useEffect(() => {
    let alive = true
    let observer: ResizeObserver | null = null
    let domObserver: MutationObserver | null = null
    let raf = 0
    let parked = true
    let stableFrames = 0
    let retry: ReturnType<typeof setTimeout> | null = null
    let watchedRoot: Element | null = null

    // 目标缺失（对话区重建中/尚未挂载）时持续等待：missing 永不 parking，
    // 但用 60ms 定时退避重试（不空转 rAF；重建完成后自动就位）
    const calibrate = (): 'missing' | 'changed' | 'stable' => {
      const panel = panelRef.current
      if (panel === null) return 'missing'
      const want = desiredGeometry(panel, align, offset)
      if (want === null) return 'missing'
      const other = want.side === 'right' ? 'left' : 'right'
      const dirty = panel.style.top !== want.top
        || panel.style.height !== want.height
        || panel.style[want.side] !== want.edge
        || panel.style[other] !== ''
      if (!dirty) return 'stable'
      panel.style.top = want.top
      panel.style.height = want.height
      panel.style[want.side] = want.edge
      panel.style[other] = ''
      return 'changed'
    }
    // 校准成功期间保持 watcher 指向当前 root（首次出现/被替换后重绑）——
    // 否则 root 断开检测失去目标，会话切换不再唤醒
    const ensureWatched = (): void => {
      const root = conversationRoot()
      if (root !== watchedRoot) bindResize()
    }
    const loop = (): void => {
      if (!alive) return
      raf = 0
      const result = calibrate()
      if (result === 'missing') {
        // 目标未出现：定时退避重试（每 60ms），成功后转 rAF 稳定收敛
        if (retry === null) retry = setTimeout(() => { retry = null; loop() }, 60)
        return
      }
      ensureWatched()
      if (result === 'changed') stableFrames = 0
      else if (result === 'stable') stableFrames += 1
      if (stableFrames >= 3) {
        parked = true
        return
      }
      raf = requestAnimationFrame(loop)
    }
    const run = (): void => {
      if (!alive || !parked) return
      parked = false
      stableFrames = 0
      if (retry !== null) { clearTimeout(retry); retry = null }
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    // ResizeObserver：只观察 frame 与对话区根（尺寸变化才回调）
    const bindResize = (): void => {
      observer?.disconnect()
      if (typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(run)
      const frame = panelRef.current?.closest('[data-shell-overlay]')?.parentElement ?? null
      if (frame !== null) observer.observe(frame, { box: 'border-box' })
      const root = conversationRoot()
      if (root !== null) {
        observer.observe(root, { box: 'border-box' })
        watchedRoot = root
      }
    }

    // MutationObserver：仅在对话区根元素被移除/替换时唤醒。
    // 行级变化（消息追加/装载/任何子树内部增删）只做 O(1) isConnected
    // 检查后忽略——对话区复用同一容器异步填充的场景由 missing 循环兜底
    // （root 短暂不可用或高度为 0 时校准停不下来，重建完成后自动就位）。
    if (typeof MutationObserver !== 'undefined') {
      domObserver = new MutationObserver(() => {
        if (watchedRoot !== null && !watchedRoot.isConnected) {
          // 根元素已被整体移除（会话/工作区切换）：重新绑定并启动校准
          bindResize()
          run()
        }
        // watchedRoot 为空（初始尚未找到对话区）或仍在文档中：不唤醒。
        // 首次出现由下方 run() 与 missing 循环处理。
      })
      domObserver.observe(document.body, { childList: true, subtree: true })
    }
    bindResize()
    // 初始（含会话切换 effect 重启）：无论 visible 与否先尝试校准——
    // 对话区缺失时 loop 持续等待；找不到 panel（未挂载）时也在 missing
    // 分支不断重试，挂载后自动就位。
    run()
    window.addEventListener('resize', run)
    return () => {
      alive = false
      if (raf !== 0) cancelAnimationFrame(raf)
      if (retry !== null) clearTimeout(retry)
      observer?.disconnect()
      domObserver?.disconnect()
      window.removeEventListener('resize', run)
    }
  }, [panelRef, visible, align, offset, sessionId])
}

/* ================= 阅读间谍 ================= */

/**
 * 阅读位置判定：按 DOM 顺序（= 时间顺序）扫描已渲染行，命中第一条
 * top >= 阅读线的标记即返回——消息行再多也只读到阅读线附近即停，
 * 不会为全部轮次做几何采样。
 * 全部行仍在线下方时取最后一条（最接近视口底）。
 */
function readingRowKey(flow: HTMLElement, portTop: number, line: number, markerSet: ReadonlySet<string>): string | null {
  let lastKey: string | null = null
  for (const row of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    const key = row.dataset.chatAnchorKey
    if (key === undefined) continue
    if (markerSet.has(key)) {
      const top = row.getBoundingClientRect().top - portTop
      if (top >= line) return key
      lastKey = key
    }
  }
  return lastKey
}

/** 阅读间谍：滚动/尺寸变化按 rAF 采样行位置，标记当前所在回合。
 *  返回 [currentKey, forceKey]——forceKey 用于点击跳转瞬间强制激活目标，
 *  滚动稳定后由采样判据接管。 */
export function useReadingSpy(visible: boolean, markers: readonly RailMarker[]): [string | null, (key: string) => void] {
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const currentKeyRef = useRef<string | null>(null)
  const forceKey = (key: string): void => { currentKeyRef.current = key; setCurrentKey(key) }
  // 标记集合（members 展开一次；长会话避免每帧重复构造）
  const markerSetRef = useRef<Set<string>>(new Set())
  markerSetRef.current = new Set(markers.flatMap((m) => m.members))

  useEffect(() => {
    if (!visible || markers.length === 0) { setCurrentKey(null); return }
    let raf = 0
    let disposed = false
    let observer: ResizeObserver | null = null
    let trackedFlow: Element | null = null
    let lastSample = 0

    const sample = (): void => {
      raf = 0
      // 滚动节流：100ms 内不重复全量扫描（长会话行数多，逐帧扫会占满主线程）
      const now = performance.now()
      if (now - lastSample < 100 && currentKeyRef.current !== null) {
        schedule()
        return
      }
      lastSample = now
      const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      const flow = document.querySelector<HTMLElement>('[data-chat-flow]')
      if (scrollport === null || flow === null) { setCurrentKey(null); return }
      if (observer !== null && trackedFlow !== flow) {
        observer.disconnect()
        observer.observe(flow)
        trackedFlow = flow
      }
      const portRect = scrollport.getBoundingClientRect()
      if (portRect.height <= 0) return
      const next = readingRowKey(flow, portRect.top, 0, markerSetRef.current)
      currentKeyRef.current = next
      setCurrentKey((prev) => (prev === next ? prev : next))
    }
    const schedule = (): void => {
      if (!disposed && raf === 0) raf = requestAnimationFrame(sample)
    }

    observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    sample()
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      if (raf !== 0) cancelAnimationFrame(raf)
      observer?.disconnect()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [visible, markers])

  return [currentKey, forceKey]
}

/* ================= 条带翻页 ================= */

/** 行内节点几何：节点 8px + 行距 6px = 行高 14px（minimal 圆点与 codex 刻度槽一致；
 *  与样式 .mgcn-dots gap 6px / 节点 8px、codex 槽高 14px 对齐） */
export const NODE_SIZE = 8
export const ROW_GAP = 6
export const ROW_HEIGHT = NODE_SIZE + ROW_GAP   // 14px：一次翻页的固定步距基准
export const ROWS_PER_PAGE = 5

/** 一次翻页的滚动距离 */
function pageDistance(): number {
  return ROWS_PER_PAGE * ROW_HEIGHT
}

/** 滚动位置钳制到 [0, max] */
function clampScroll(pos: number, max: number): number {
  const ceiling = Math.max(0, max)
  if (pos < 0) return 0
  if (pos > ceiling) return ceiling
  return pos
}

/** 可见性快照：元素是否与条带相交 */
function bandVisibility(list: HTMLElement, els: readonly HTMLElement[]): boolean[] {
  const band = list.getBoundingClientRect()
  return els.map((el) => {
    const r = el.getBoundingClientRect()
    return r.bottom > band.top && r.top < band.bottom
  })
}

/** 入场批次：滚动后新进入条带的元素 key（dir=向下时逆序排列，配合错峰动画） */
function enteringBatch(list: HTMLElement, els: readonly HTMLElement[], before: readonly boolean[], dir: 1 | -1): Map<string, { dir: 1 | -1; order: number }> {
  const band = list.getBoundingClientRect()
  const fresh: string[] = []
  els.forEach((el, i) => {
    if (before[i]) return
    const r = el.getBoundingClientRect()
    const key = el.dataset.megaChatNavKey
    if (key !== undefined && r.bottom > band.top && r.top < band.bottom) fresh.push(key)
  })
  if (dir === 1) fresh.reverse()
  const batch = new Map<string, { dir: 1 | -1; order: number }>()
  fresh.forEach((key, order) => batch.set(key, { dir, order }))
  return batch
}

/** 条带翻页：▲/▼ 步进（固定 5 行/页）+ 溢出检测 + 入场错峰动画 */
export function useBandPaging(
  listRef: RefObject<HTMLDivElement>,
  markers: readonly RailMarker[],
): {
  scrollable: boolean
  revealed: ReadonlyMap<string, { dir: 1 | -1; order: number }> | null
  syncScroll: () => void
  pageBy: (dir: 1 | -1) => void
  canPageUp: boolean
  canPageDown: boolean
} {
  const [scrollable, setScrollable] = useState(false)
  const [, bumpScroll] = useState(0)   // 滚动位置变化仅作重渲染触发
  const [revealed, setRevealed] = useState<ReadonlyMap<string, { dir: 1 | -1; order: number }> | null>(null)
  const revealTimer = useRef<number | null>(null)

  const readBand = (): { top: number; max: number } => {
    const list = listRef.current
    if (list === null) return { top: 0, max: 0 }
    return { top: list.scrollTop, max: Math.max(0, list.scrollHeight - list.clientHeight) }
  }
  const syncScroll = (): void => {
    bumpScroll((n) => n + 1)
  }
  const pageBy = (dir: 1 | -1): void => {
    const list = listRef.current
    if (list === null) return
    const { max } = readBand()
    const target = clampScroll(list.scrollTop + dir * pageDistance(), max)
    if (target === list.scrollTop) return
    const els = Array.from(list.querySelectorAll<HTMLElement>('[data-mega-chat-nav-key]'))
    const before = bandVisibility(list, els)
    list.scrollTop = target
    syncScroll()
    const batch = enteringBatch(list, els, before, dir)
    if (batch.size === 0) return
    setRevealed(batch)
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => setRevealed(null), 320 + batch.size * 35 + 120)
  }

  // 溢出检测：标记或布局变化时重测
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const check = (): void => {
      setScrollable(list.scrollHeight > list.clientHeight + 1)
      syncScroll()
    }
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(list)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers])

  useEffect(() => () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { top, max } = readBand()
  return {
    scrollable,
    revealed,
    syncScroll,
    pageBy,
    canPageUp: scrollable && top > 0,
    canPageDown: scrollable && top < max - 1,  // 1px 容差：滚动到底不再显示 ▼
  }
}
/**
 * 浮现态（minimal/codex 共用）：进入 rail 立即显示；移出后至少停留 1s 再隐藏。
 * peekCls 供 show=peek 模式使用（open 态不隐藏）。
 */
export function usePeekState(): {
  peekVisible: boolean
  showPeek: () => void
  hidePeek: () => void
  peekCls: (mode: string, open: boolean) => string
} {
  const [peekVisible, setPeekVisible] = useState(false)
  const peekTimer = useRef<number | null>(null)
  const showPeek = (): void => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current)
      peekTimer.current = null
    }
    setPeekVisible(true)
  }
  const hidePeek = (): void => {
    if (peekTimer.current === null) {
      peekTimer.current = window.setTimeout(() => {
        peekTimer.current = null
        setPeekVisible(false)
      }, 1000)
    }
  }
  useEffect(() => () => {
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current)
  }, [])
  const peekCls = (mode: string, open: boolean): string => {
    if (mode !== 'peek' || open) return ''
    return peekVisible ? '' : ' mgcn-peek'
  }
  return { peekVisible, showPeek, hidePeek, peekCls }
}

/**
 * 点击浮层之外（非 .mgcn-gear-wrap）→ 关闭 config/search 浮层（minimal/codex 共用）。
 */
export function useClosePopoversOnOutside(
  configOpen: boolean,
  searchOpen: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!configOpen && !searchOpen) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (target === null || !target.closest('.mgcn-gear-wrap')) close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [configOpen, searchOpen, close])
}

/* ================= 卡片预览（风格能力：hoverCards） ================= */

/** 卡片尺寸档位（档 0 选中卡最宽全文本 / 档 1 / 档 2 最窄） */
const CARD_SIZES = [
  { widthPx: 380, fontSize: 13, maxLines: 6 },
  { widthPx: 300, fontSize: 12.5, maxLines: 2 },
  { widthPx: 240, fontSize: 12, maxLines: 1 },
] as const

export interface CardMetrics {
  widthPx: number
  fontSize: number
  maxLines: number
}

/** 距离 → 卡片呈现参数；聚焦窗口外返回 null */
export function cardMetrics(distance: number): CardMetrics | null {
  const magnitude = distance < 0 ? -distance : distance
  if (magnitude > CARD_SIZES.length - 1) return null
  return CARD_SIZES[magnitude] ?? CARD_SIZES[CARD_SIZES.length - 1]
}

/** 距离 → 聚焦档（窗口内 0..2，窗口外 null；圆点缩放层级用） */
export function markerTier(distance: number): number | null {
  const magnitude = distance < 0 ? -distance : distance
  return magnitude > CARD_SIZES.length - 1 ? null : magnitude
}

/** 距离 → 放大倍数：仅选中点放大，邻居/窗口外均为 1 */
export function markerScale(distance: number): number {
  return distance === 0 ? 1.5 : 1
}

/** 卡片窗口：选中标记 ± radius 内的成员 */
function cardSpan(markers: readonly RailMarker[], index: number, radius: number): { dot: RailMarker; distance: number }[] {
  const lo = Math.max(0, index - radius)
  const hi = Math.min(markers.length - 1, index + radius)
  const out: { dot: RailMarker; distance: number }[] = []
  for (let i = lo; i <= hi; i++) {
    out.push({ dot: markers[i], distance: Math.abs(i - index) })
  }
  return out
}

/**
 * 卡片预览：悬停标记弹出级联卡（minimal 能力，enabled=false 时整组失效——
 * 其他风格可无卡片）。
 */
export function useCardPreview(
  markers: readonly RailMarker[],
  align: RailAlign,
  radius: number,
  enabled: boolean,
): {
  focus: FocusState | null
  openCards: (marker: RailMarker, target: HTMLElement) => void
  cancelClear: () => void
  scheduleClear: () => void
} {
  const [focus, setFocus] = useState<FocusState | null>(null)
  const clearTimer = useRef<number | null>(null)

  const cancelClear = (): void => {
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current)
      clearTimer.current = null
    }
  }
  const scheduleClear = (): void => {
    cancelClear()
    clearTimer.current = window.setTimeout(() => setFocus(null), 240)
  }
  const openCards = (marker: RailMarker, target: HTMLElement): void => {
    if (!enabled) return
    const index = markers.findIndex((m) => m.key === marker.key)
    if (index < 0) return
    cancelClear()
    const r = target.getBoundingClientRect()
    const horizontal = align === 'right'
      ? { right: window.innerWidth - r.left + 10 }
      : { left: r.right + 10 }
    setFocus({ key: marker.key, items: cardSpan(markers, index, radius), centerY: r.top + r.height / 2, ...horizontal })
  }

  // 半径（卡片数）变化时重算已打开的预览窗口
  useEffect(() => {
    if (focus === null || !enabled) return
    const index = markers.findIndex((m) => m.key === focus.key)
    if (index < 0) return
    setFocus((prev) => (prev !== null && prev.key === focus.key ? { ...prev, items: cardSpan(markers, index, radius) } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, markers, enabled])

  useEffect(() => () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { focus, openCards, cancelClear, scheduleClear }
}

/* ================= 失败提示 ================= */

/** 跳转失败提示：监听 mega-chat-nav:jump-failed 事件，1.8s 后自动消退 */
export function useFailureNotice(t: Translate): string | null {
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const onFail = (event: Event): void => {
      const code = (event as CustomEvent<string>).detail ?? 'TIMEOUT'
      const known = ['jump.inactive', 'jump.hidden', 'jump.notfound', 'jump.timeout']
      setNotice(t(known.includes(code) ? code : 'jump.timeout'))
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setNotice(null), 1800)
    }
    window.addEventListener('mega-chat-nav:jump-failed', onFail)
    return () => {
      window.removeEventListener('mega-chat-nav:jump-failed', onFail)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [t])

  return notice
}

/* ================= 加载较早记录提示 ================= */

/** 监听跳转编排的扩窗加载状态，显示「正在加载较早记录以定位…（第 N 页）」 */
export function useLoadingNotice(t: Translate): string | null {
  const [state, setState] = useState<{ loading: boolean; pages: number }>({ loading: false, pages: 0 })
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const onLoading = (event: Event): void => {
      const detail = (event as CustomEvent<{ loading: boolean; pages: number }>).detail
      const on = detail?.loading === true
      setState({ loading: on, pages: detail?.pages ?? 0 })
      if (on) {
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState({ loading: false, pages: 0 }), 10_000)  // 兜底：最长 10s
      }
    }
    window.addEventListener('mega-chat-nav:jump-loading', onLoading)
    return () => {
      window.removeEventListener('mega-chat-nav:jump-loading', onLoading)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return state.loading ? t('jump.loading', { n: state.pages }) : null
}

/* ================= 设置订阅 ================= */

/** 设置订阅：全部配置项跟随（align/bandHeight/cardCount/markTone/显示模式/动画方式） */
export function useNavSettings(injected: NavInjected | undefined): {
  style: NavStyle
  align: RailAlign
  bandHeight: BandHeight
  cardCount: CardCount
  cardItems: CardItem[]
  markTone: MarkTone
  scrollBehavior: ScrollMode
  showCount: ShowMode
  showSearch: ShowMode
  showQuickSettings: ShowMode
  showFavorites: ShowMode
  showPaging: ShowMode
  searchScopes: SearchScope[]
  railOffset: number
} {
  const [style, setStyle] = useState<NavStyle>(() => injected?.style() ?? DEFAULT_STYLE)
  const [align, setAlign] = useState<RailAlign>(() => injected?.align() ?? DEFAULT_ALIGN)
  const [bandHeight, setBandHeight] = useState<BandHeight>(() => injected?.bandHeight() ?? DEFAULT_BAND)
  const [cardCount, setCardCount] = useState<CardCount>(() => injected?.cardCount() ?? DEFAULT_CARD_COUNT[DEFAULT_STYLE])
  const [cardItems, setCardItems] = useState<CardItem[]>(() => injected?.cardItems() ?? [...DEFAULT_CARD_ITEMS])
  const [markTone, setMarkTone] = useState<MarkTone>(() => injected?.markTone() ?? DEFAULT_MARK_TONE)
  const [scrollBehavior, setScrollBehavior] = useState<ScrollMode>(() => injected?.scrollBehavior() ?? DEFAULT_SCROLL)
  const [showCount, setShowCount] = useState<ShowMode>(() => injected?.showCount() ?? DEFAULT_SHOW)
  const [showSearch, setShowSearch] = useState<ShowMode>(() => injected?.showSearch() ?? DEFAULT_SHOW)
  const [showQuickSettings, setShowQuickSettings] = useState<ShowMode>(() => injected?.showQuickSettings() ?? DEFAULT_SHOW)
  const [showFavorites, setShowFavorites] = useState<ShowMode>(() => injected?.showFavorites() ?? DEFAULT_SHOW)
  const [showPaging, setShowPaging] = useState<ShowMode>(() => injected?.showPaging() ?? DEFAULT_PAGING[DEFAULT_STYLE])
  const [searchScopes, setSearchScopes] = useState<SearchScope[]>(() => injected?.searchScopes() ?? [...DEFAULT_SEARCH_SCOPES])
  const [railOffset, setRailOffset] = useState<number>(() => injected?.railOffset() ?? 8)
  useEffect(() => {
    if (injected === undefined) return
    return injected.subscribeSettings(() => {
      setStyle(injected.style())
      setAlign(injected.align())
      setBandHeight(injected.bandHeight())
      setCardCount(injected.cardCount())
      setCardItems(injected.cardItems())
      setMarkTone(injected.markTone())
      setScrollBehavior(injected.scrollBehavior())
      setShowCount(injected.showCount())
      setShowSearch(injected.showSearch())
      setShowQuickSettings(injected.showQuickSettings())
      setShowFavorites(injected.showFavorites())
      setShowPaging(injected.showPaging())
      setSearchScopes(injected.searchScopes())
      setRailOffset(injected.railOffset())
    })
  }, [injected])
  return { style, align, bandHeight, cardCount, cardItems, markTone, scrollBehavior, showCount, showSearch, showQuickSettings, showFavorites, showPaging, searchScopes, railOffset }
}

/* ================= 时间工具（卡片/搜索结果相对时间） ================= */

/** 相对时间：同日 HH:MM / 同年 MM-DD HH:MM / 跨年 YYYY-MM-DD HH:MM；非法输入返回空串 */
export function clockText(time: number, now: number): string {
  if (!(time > 0) || !Number.isFinite(time)) return ''
  const stamp = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = pad(stamp.getHours()) + ':' + pad(stamp.getMinutes())
  const ref = new Date(now)
  const sameDay = stamp.getFullYear() === ref.getFullYear()
    && stamp.getMonth() === ref.getMonth()
    && stamp.getDate() === ref.getDate()
  if (sameDay) return hm
  const md = pad(stamp.getMonth() + 1) + '-' + pad(stamp.getDate())
  if (stamp.getFullYear() === ref.getFullYear()) return md + ' ' + hm
  return stamp.getFullYear() + '-' + md + ' ' + hm
}
/* ================= 收藏 ================= */

const FAV_STORAGE_PREFIX = 'mega-chat-nav:favorites:'

function readFavorites(sessionId: string | undefined): Set<string> {
  if (sessionId === undefined) return new Set()
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_PREFIX + sessionId)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function writeFavorites(sessionId: string, keys: Set<string>): void {
  try {
    window.localStorage.setItem(FAV_STORAGE_PREFIX + sessionId, JSON.stringify([...keys]))
  } catch { /* 存储不可用时收藏仅内存态 */ }
}

/** 收藏状态：localStorage 持久化 + 切换动作（跨刷新保留） */
export function useFavorites(sessionId: string | undefined): { favorites: Set<string>; toggle: (key: string) => void } {
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites(sessionId))

  useEffect(() => {
    setFavorites(readFavorites(sessionId))
  }, [sessionId])

  const toggle = (key: string): void => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      if (sessionId !== undefined) writeFavorites(sessionId, next)
      return next
    })
  }

  return { favorites, toggle }
}

/* ================= 性能指标格式化 ================= */

/** 毫秒 → 人类可读时长（1分21秒 / 10秒） */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total >= 60) {
    const m = Math.floor(total / 60)
    const s = total % 60
    return m + '分' + s + '秒'
  }
  return total + '秒'
}

/** 完整指标行：本轮用时 1分21秒 · 首 token 10秒 · 188 tok/s */
export function metricsLine(metrics: { durationMs: number; firstTokenMs: number; tokensPerSec: number }): string {
  const parts: string[] = []
  parts.push('本轮用时 ' + durationText(metrics.durationMs))
  if (metrics.firstTokenMs > 0) parts.push('首 token ' + durationText(metrics.firstTokenMs))
  if (metrics.tokensPerSec > 0) parts.push(metrics.tokensPerSec + ' tok/s')
  return parts.join(' · ')
}
/* ================= 手机模式 ================= */

/** 手机模式：页面宽度小于 breakpoint（默认 1024px），resize 实时跟随 */
export function useMobileMode(breakpoint = 1024): boolean {
  const [mobile, setMobile] = useState<boolean>(() => window.innerWidth < breakpoint)
  useEffect(() => {
    const onResize = (): void => setMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return mobile
}
/* ================= 手机模式搜索按钮（零高 sticky wrapper + absolute 按钮） ================= */

/**
 * 手机模式：向对话滚动容器 [data-conversation-scroll] 头部插入零高 wrapper
 * （width:100%; height:0; sticky top:0; overflow:visible），按钮 absolute 相对
 * wrapper 定位——sticky 粘在滚动视口顶部，按钮不随内容滚走、不占布局空间。
 */
export function useMobileSearchButton(onClick: () => void, enabled: boolean, align: RailAlign, label: string): void {
  useEffect(() => {
    if (!enabled) return
    const host = mobileSearchHost()
    if (host === null) return
    // 零高 wrapper：sticky 粘在滚动容器顶部、不占空间；按钮 absolute 相对 wrapper 定位
    const wrap = document.createElement('div')
    wrap.style.width = '100%'
    wrap.style.height = '0'
    wrap.style.margin = '0'
    wrap.style.position = 'sticky'
    wrap.style.top = '0'
    wrap.style.overflow = 'visible'
    wrap.style.zIndex = '60'
    wrap.style.pointerEvents = 'none'   // wrapper 不拦截，按钮自身可点
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mgcn-config-gear mgcn-mobileSearch'
    btn.setAttribute('aria-label', label)
    btn.style.position = 'absolute'
    btn.style.top = '8px'
    btn.style[align === 'right' ? 'right' : 'left'] = '8px'
    btn.style.zIndex = '60'
    btn.style.pointerEvents = 'auto'
    btn.innerHTML = '<svg class="mgcn-btn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
    btn.addEventListener('click', onClick)
    wrap.appendChild(btn)
    // 保证 wrapper 是父级第一个元素（sticky 相对滚动容器视口顶部）
    host.insertBefore(wrap, host.firstChild)
    return () => {
      wrap.remove()
    }
  }, [enabled, onClick, align, label])
}

/** 跳转动作 + 脉冲态（四风格共用）：返回 [jumpingKey, jump]。
 *  jump(marker)：跳转 + 目标脉冲 + 阅读位强制激活。 */
export function useRailJump(
  sessionId: string | undefined,
  injected: NavInjected | undefined,
  displayMarkers: readonly RailMarker[],
  currentKey: string | null,
  forceKey: (key: string) => void,
): [string | null, (marker: RailMarker) => void] {
  const [jumpingKey, setJumpingKey] = useState<string | null>(null)
  const jump = (marker: RailMarker): void => {
    if (sessionId === undefined || injected === undefined) return
    setJumpingKey(marker.key)
    forceKey(marker.key)   // 点击瞬间强制激活目标（正文滚动稳定后由采样判据接管）
    const currentMarker = currentKey === null ? undefined : displayMarkers.find((m) => m.key === currentKey)
    injected.jump(sessionId, marker.key, marker.seq, currentMarker?.seq)
    window.setTimeout(() => setJumpingKey((k) => (k === marker.key ? null : k)), 600)
  }
  return [jumpingKey, jump]
}
