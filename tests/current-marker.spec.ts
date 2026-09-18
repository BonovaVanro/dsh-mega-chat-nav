// @vitest-environment jsdom
/**
 * current（导航条高亮）判定测试。
 *
 * 线上回归：底部窗口里只有助手回复 / 运行中追加的插入消息时，视口内**没有任何提问行**
 * 被渲染，旧判据直接返回 null → 整条导航轨无高亮。修法对齐官方 turnAtLine 的思路：
 * 提问行优先，其次用「阅读线处行的所属回合」（`data-chat-turn`，每个聊天行都有）
 * 落到「我读到第几轮」的节点。
 */
import { describe, expect, it } from 'vitest'
import { markerOwnerIndex, readingRowKey } from '../src/client/components/rail/useRail.ts'
import type { RailMarker } from '../src/client/components/shared/types.ts'

/** 造一条行：anchorKey 可选（无则等于没有锚点，如 pending 回显），turn 为所属回合 */
function row(opts: { top: number; turn?: number | null; anchorKey?: string }): HTMLElement {
  const el = document.createElement('div')
  if (opts.anchorKey !== undefined) el.dataset.chatAnchorKey = opts.anchorKey
  if (opts.turn !== undefined && opts.turn !== null) el.dataset.chatTurn = String(opts.turn)
  el.getBoundingClientRect = () => ({ top: opts.top, bottom: opts.top + 40, left: 0, right: 0, width: 100, height: 40, x: 0, y: opts.top, toJSON: () => ({}) }) as DOMRect
  return el
}

function flow(rows: readonly HTMLElement[]): HTMLElement {
  const el = document.createElement('div')
  for (const r of rows) el.appendChild(r)
  return el
}

/** 标记：turn 为 null 表示无回合归属的条目（不应被回退选中） */
function marker(turn: number | null, key: string, members: readonly string[] = [key]): RailMarker {
  return { turn, key, seq: turn ?? 0, time: 0, texts: [key], members, metrics: undefined } as unknown as RailMarker
}

const T1 = marker(1, 'k1', ['k1', 'k1-steering'])
const T2 = marker(2, 'k2', ['k2'])
const NO_TURN = marker(null, 'k0', ['k0'])

/** 判据需要「成员→节点」索引；测试里按标记现造（与 hook 内一致） */
const idx = (...ms: readonly RailMarker[]): ReturnType<typeof markerOwnerIndex> => markerOwnerIndex(ms)
const read = (f: HTMLElement, ms: readonly RailMarker[]): string | null => readingRowKey(f, 0, 0, ms, idx(...ms))

describe('readingRowKey：current 判定（锚点优先 + 回合回退）', () => {
  it('锚点行在视口内 → 直接命中（快路径不变）', () => {
    const f = flow([row({ top: -200, turn: 1, anchorKey: 'k1' }), row({ top: 10, turn: 2, anchorKey: 'k2' })])
    expect(read(f, [T1, T2])).toBe('k2')
  })

  it('锚点行都在视口上方 → 取最后一条（原有兜底不变）', () => {
    const f = flow([row({ top: -300, turn: 1, anchorKey: 'k1' }), row({ top: -100, turn: 2, anchorKey: 'k2' })])
    expect(read(f, [T1, T2])).toBe('k2')
  })

  it('同回合的插入消息锚点也算命中该节点', () => {
    const f = flow([row({ top: 20, turn: 1, anchorKey: 'k1-steering' })])
    expect(read(f, [T1, T2])).toBe('k1')
  })

  it('回归场景：视口内只有助手 / 插入消息行（无锚点）→ 回退到该行的所属回合', () => {
    // 提问行已滚出上方或未渲染；可见的是 turn 2 的助手回复
    const f = flow([row({ top: -500, turn: 1 }), row({ top: 30, turn: 2 })])
    expect(read(f, [T1, T2])).toBe('k2')
  })

  it('回归场景：阅读线处是插入消息（turn 1）→ 点亮 turn 1 的节点', () => {
    const f = flow([row({ top: 15, turn: 1 })])
    expect(read(f, [T1, T2])).toBe('k1')
  })

  it('回退时取「行所属回合」之前最近的节点（回合号可能跳号）', () => {
    const t5 = marker(5, 'k5', ['k5'])
    const f = flow([row({ top: 25, turn: 5 })])
    expect(read(f, [T1, t5])).toBe('k5')
    const f2 = flow([row({ top: 25, turn: 4 })])   // 4 无对应节点 → 落到 1
    expect(read(f2, [T1, t5])).toBe('k1')
  })

  it('无回合归属的条目不会被回退选中', () => {
    const f = flow([row({ top: 25, turn: 7 })])
    expect(read(f, [NO_TURN])).toBeNull()
  })

  it('完全取不到回合信息 → 仍返回 null（无从判断时才熄火）', () => {
    const f = flow([row({ top: 25 })])
    expect(read(f, [T1, T2])).toBeNull()
  })

  it('空 flow → null', () => {
    expect(read(flow([]), [T1, T2])).toBeNull()
  })
})
