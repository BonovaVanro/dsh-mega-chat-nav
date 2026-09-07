// 跳转编排（client 装配层自研）：定位目标行——按方向分流（向下滚动 / 向上补历史），
// 等待渲染并滚动；失败回退。结果码与词条绑定（jump-failed 事件契约）。
//
// 关键语义：chat.nodes 只是「虚拟渲染窗口」（DOM 渲染行），目标行在已加载范围内
// 但未渲染时**不能**当作「需要加载更早历史」——必须按目标 seq 与渲染窗口的关系分流。

/** 跳转循环所需的会话快照面 */
export interface JumpSnapshot {
  openState: string
  hasMore: boolean
  loadingOlder: boolean
  rows: Iterable<{ key: string; anchorSeq: number; visibility?: string }>
}

/** 外部端口：会话读写、DOM 行查找、滚动与时钟（由浏览器半装配） */
export interface JumpPorts {
  snap: () => JumpSnapshot | undefined
  loadMore: () => Promise<void>
  active: () => boolean
  locate: (key: string) => HTMLElement | null
  reveal: (row: HTMLElement, mode: 'smooth' | 'instant') => void
  /** 会话滚动容器（虚拟渲染按 scrollTop 触发） */
  scrollport: () => HTMLElement | null
  now: () => number
  sleep: (ms: number) => Promise<void>
  report?: (code: JumpFailureCode, fallback?: boolean) => void
  /** 扩窗加载进度（loading 状态 + 已加载页数），驱动「正在加载较早记录」提示 */
  onLoading?: (loading: boolean, pages: number) => void
}

export type JumpFailureCode = 'VIEW_INACTIVE' | 'TARGET_HIDDEN' | 'NOT_FOUND' | 'TIMEOUT'

interface JumpResult {
  ok: boolean
  code?: JumpFailureCode
  fallback?: boolean
}

interface JumpOptions {
  totalTimeoutMs?: number
  maxPages?: number
  rowWaitMs?: number
  pollMs?: number
}

const BUDGET = {
  totalTimeoutMs: 30_000,
  maxPages: 300,
  rowWaitMs: 8_000,
  pollMs: 60,
}

/** 行是否为可渲染锚点行 */
function isVisibleRow(row: { visibility?: string }): boolean {
  return row.visibility !== 'hidden'
}

/** 快照中是否已含目标行 */
function hasTarget(rows: Iterable<{ key: string; visibility?: string }>, key: string): boolean {
  for (const row of rows) {
    if (isVisibleRow(row) && row.key === key) return true
  }
  return false
}

/** 渲染窗口的锚点序号极值；空窗口返回 null */
function seqRange(rows: Iterable<{ anchorSeq: number }>): { min: number; max: number } | null {
  let min: number | null = null
  let max: number | null = null
  for (const row of rows) {
    if (min === null || row.anchorSeq < min) min = row.anchorSeq
    if (max === null || row.anchorSeq > max) max = row.anchorSeq
  }
  return min === null || max === null ? null : { min, max }
}

/** 当前窗口最小锚点序号；空窗口返回 null */
function smallestSeq(rows: Iterable<{ anchorSeq: number }>): number | null {
  const range = seqRange(rows)
  return range === null ? null : range.min
}

/** 回退目标：排除指定 key 的最近可渲染行（取最新锚点序号） */
function retreatTo(
  rows: Iterable<{ key: string; anchorSeq: number; visibility?: string }>,
  excludeKey: string,
): { key: string; anchorSeq: number } | null {
  let best: { key: string; anchorSeq: number } | null = null
  for (const row of rows) {
    if (row.visibility === 'hidden') continue
    if (row.key === excludeKey) continue
    if (best === null || row.anchorSeq > best.anchorSeq) best = { key: row.key, anchorSeq: row.anchorSeq }
  }
  return best
}

/** 等待某行渲染（预算内轮询）；视图失活返回 null */
async function waitForRow(ports: JumpPorts, rowKey: string, pollMs: number, rowWaitMs: number): Promise<HTMLElement | null> {
  for (let waited = 0; waited <= rowWaitMs; waited += pollMs) {
    if (!ports.active()) return null
    const row = ports.locate(rowKey)
    if (row !== null) return row
    await ports.sleep(pollMs)
  }
  return null
}

/**
 * 滚动定位：按方向逐屏滚动（触发虚拟渲染）直至目标行出现或到达边界。
 * 若快照渲染窗口已含目标但 DOM 尚未挂载（渲染延迟），放慢等待 DOM。
 * 返回命中的行；未命中返回 null。
 */
async function scrollLocate(
  ports: JumpPorts,
  key: string,
  dir: 1 | -1,
  maxSteps: number,
  stepMs: number,
): Promise<HTMLElement | null> {
  const port = ports.scrollport()
  if (port === null) return null
  for (let i = 0; i < maxSteps; i++) {
    const row = ports.locate(key)
    if (row !== null) return row
    const before = port.scrollTop
    const step = Math.max(200, Math.round(port.clientHeight * 0.4))
    port.scrollBy({ top: dir * step })
    await ports.sleep(stepMs)
    const floor = Math.max(0, port.scrollHeight - port.clientHeight)
    if (Math.abs(port.scrollTop - before) < 2) {
      // 到边界：反向回扫若干步（虚拟渲染滞后可能已滚过头）
      if (dir === 1) {
        for (let i = 0; i < 10; i++) {
          const row = ports.locate(key)
          if (row !== null) return row
          port.scrollBy({ top: -Math.round(port.clientHeight * 0.4) })
          await ports.sleep(stepMs)
        }
      }
      return null
    }
    // 滚动后：虚拟渲染窗口已覆盖目标（数据窗口含目标行）→ 放慢等待 DOM 挂载
    const snap = ports.snap()
    if (snap !== undefined && hasTarget(snap.rows, key)) {
      const rendered = await waitForRow(ports, key, Math.max(100, stepMs), 2500)
      if (rendered !== null) return rendered
      return null
    }
  }
  return null
}

/**
 * 跳转到 key 对应行：
 *   - 目标已在渲染窗口 → 等待 DOM 并滚动；
 *   - 目标在下方/窗口内（targetSeq ≥ 渲染窗口最小值）→ 向下滚动定位（无需加载）；
 *   - 目标更早（targetSeq < 渲染窗口最小值 或未知）→ 预算内 loadOlder 补历史，每页后向上滚动定位；
 *   - 全部失败 → 回退最近可渲染行。
 */
export async function goTo(
  ports: JumpPorts,
  key: string,
  options: JumpOptions = {},
  mode: 'smooth' | 'instant' = 'smooth',
  targetSeq?: number,
  currentSeq?: number,
): Promise<JumpResult> {
  const budget = { ...BUDGET, ...options }
  const fail = (code: JumpFailureCode, fallback = false): JumpResult => {
    ports.report?.(code, fallback)
    return fallback ? { ok: false, code, fallback: true } : { ok: false, code }
  }

  if (!ports.active()) return fail('VIEW_INACTIVE')

  const deadline = ports.now() + budget.totalTimeoutMs
  let pages = 0
  let lastNotified = -1
  const notifyLoading = (loading: boolean, count: number): void => {
    const key2 = loading ? count : -1
    if (key2 === lastNotified) return
    lastNotified = key2
    ports.onLoading?.(loading, count)
  }

  // 阶段一：确保目标进入渲染窗口
  for (;;) {
    const snap = ports.snap()
    if (snap === undefined) { notifyLoading(false, 0); return fail('VIEW_INACTIVE') }
    if (hasTarget(snap.rows, key)) { notifyLoading(false, 0); break }
    if (ports.now() > deadline) { notifyLoading(false, 0); return fail('TIMEOUT') }

    // 明确在下方（目标比当前阅读位置晚）：向下滚动定位，绝不加载。
    // 方向判定优先用当前阅读位置 seq（渲染窗口极值含虚拟缓冲，不可靠）
    if (targetSeq !== undefined) {
      const range = seqRange(snap.rows)
      const below = currentSeq !== undefined
        ? targetSeq > currentSeq
        : range !== null && targetSeq > range.max
      if (below) {
        const found = await scrollLocate(ports, key, 1, 500, budget.pollMs * 2)
        if (found !== null) {
          ports.reveal(found, mode)
          return { ok: true }
        }
        notifyLoading(false, 0)
        return fail('TARGET_HIDDEN')
      }
    }

    // 其余情况：先向上滚动定位（目标可能已加载但位于虚拟缓冲/视口上方未渲染），
    // 仅在目标距渲染窗口较近时尝试，避免无谓的大范围滚动
    if (!snap.loadingOlder) {
      const range = seqRange(snap.rows)
      const closeEnough = targetSeq === undefined || range === null || targetSeq >= range.min - 40
      if (closeEnough) {
        const up = await scrollLocate(ports, key, -1, 40, budget.pollMs * 2)
        if (up !== null) {
          notifyLoading(false, 0)
          ports.reveal(up, mode)
          return { ok: true }
        }
      }
    }

    // 更早方向：补历史
    if (snap.openState !== 'open') {
      if (snap.openState === 'error') { notifyLoading(false, 0); return fail('VIEW_INACTIVE') }
      await ports.sleep(budget.pollMs)
      continue
    }
    if (snap.hasMore !== true) { notifyLoading(false, 0); return fail('NOT_FOUND') }
    if (pages >= budget.maxPages) { notifyLoading(false, 0); return fail('TIMEOUT') }
    notifyLoading(true, pages + 1)
    if (snap.loadingOlder) {
      await ports.sleep(budget.pollMs)
      continue
    }
    const before = smallestSeq(snap.rows)
    await ports.loadMore()
    pages += 1
    notifyLoading(true, pages)
    // loadOlder 的 Promise resolve 可能早于数据落地：轮询等待窗口最小 seq 真正前移
    let after = before
    for (let waited = 0; waited <= 5000; waited += budget.pollMs) {
      const s2 = ports.snap()
      const cur = smallestSeq(s2 === undefined ? [] : s2.rows)
      if (cur !== null && (before === null || cur < before)) { after = cur; break }
      await ports.sleep(budget.pollMs)
    }
    if (after === null || (before !== null && after >= before)) {
      // 加载无进展：最后向上滚动定位一次再判失败
      const up = await scrollLocate(ports, key, -1, 40, budget.pollMs * 2)
      if (up !== null) {
        notifyLoading(false, 0)
        ports.reveal(up, mode)
        return { ok: true }
      }
      notifyLoading(false, 0)
      return fail('NOT_FOUND')
    }
    // 循环继续：新加载的行在视口上方，顶部迭代会再向上滚动定位
  }

  // 阶段二：等待渲染并滚动；隐藏则回退
  const row = await waitForRow(ports, key, budget.pollMs, budget.rowWaitMs)
  if (row !== null) {
    ports.reveal(row, mode)
    return { ok: true }
  }

  // 目标已入渲染窗口但 DOM 未挂载（虚拟渲染延迟）：双向滚动定位兜底
  const snap0 = ports.snap()
  if (snap0 !== undefined && hasTarget(snap0.rows, key)) {
    const located = await scrollLocate(ports, key, -1, 60, budget.pollMs * 2)
      ?? await scrollLocate(ports, key, 1, 60, budget.pollMs * 2)
    if (located !== null) {
      ports.reveal(located, mode)
      return { ok: true }
    }
  }

  const snap = ports.snap()
  const fallback = retreatTo(snap === undefined ? [] : snap.rows, key)
  if (fallback !== null) {
    const fbRow = await waitForRow(ports, fallback.key, budget.pollMs, budget.rowWaitMs)
    if (fbRow !== null) {
      ports.reveal(fbRow, mode)
      return fail('TARGET_HIDDEN', true)
    }
  }
  return fail('TARGET_HIDDEN', false)
}