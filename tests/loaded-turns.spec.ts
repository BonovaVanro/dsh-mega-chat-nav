/**
 * 「已加载回合」判定单测（src/client/index.ts 的 loadedTurnsOf）。
 *
 * 导航点代表**该轮的用户提问**，所以「已加载」= 该提问气泡在当前窗口里真的存在
 * （该回合有可见的 user 行）。这条规则踩过三次坑，故逐条钉死：
 *  1) 直接用官方索引 navigation.items() → 末尾那个尚未加载的轮次也被画成已加载；
 *  2) 改成「只保留拿到可见回合号的行」→ 行字段口径对不上时得到空集，
 *     表现是**所有**轮次都画成未加载（线上实测回归）；
 *  3) 官方判据要求「该回合有可见节点」→ **半截回合**（助手/工具行在窗口内、
 *     用户气泡还在窗口外）也被算作已加载。
 */
import { describe, it, expect } from 'vitest'
import { loadedTurnsOf } from '../src/client/index.ts'

/** 一行：location 为主路径，data.turn 为兜底路径 */
function row(
  turn: number | null,
  visibility: string,
  kind = 'user',
  viaData = false,
): { visibility?: string; kind?: string; location?: unknown; data?: unknown } {
  if (turn === null) return { visibility, kind, location: { kind: 'session' } }
  return viaData
    ? { visibility, kind, data: { turn } }
    : { visibility, kind, location: { kind: 'step', turn: { turn } } }
}

describe('loadedTurnsOf', () => {
  it('只把「可见提问行」所在的回合算已加载', () => {
    const turns = loadedTurnsOf([28, 29, 30], [row(29, 'visible'), row(30, 'visible'), row(28, 'visible')])
    expect([...turns].sort((a, b) => a - b)).toEqual([28, 29, 30])
  })

  it('半截回合（只有助手/工具行在窗口内）→ 未加载', () => {
    // 31 的助手行可见，但它的用户提问还没进窗口
    const turns = loadedTurnsOf([30, 31], [
      row(30, 'visible'),
      row(31, 'visible', 'assistant-step'),
      row(31, 'visible', 'tool'),
    ])
    expect(turns.has(31)).toBe(false)
    expect(turns.has(30)).toBe(true)
  })

  it('窗口里只有隐藏提问行 → 无可见证据，保持索引原样（不反向误判）', () => {
    // 只有 hidden 行时无法判断「谁加载了谁没加载」，此时宁可沿用索引，
    // 也不要把所有轮次一刀切成未加载
    const turns = loadedTurnsOf([30], [row(30, 'hidden')])
    expect(turns.has(30)).toBe(true)
  })

  it('既有可见提问行、也有隐藏提问行 → 只认可见的那些', () => {
    const turns = loadedTurnsOf([30, 31], [row(30, 'visible'), row(31, 'hidden')])
    expect(turns.has(30)).toBe(true)
    expect(turns.has(31)).toBe(false)
  })

  it('窗口里一个提问行都取不到 → 保持索引原样（绝不退化成全部未加载）', () => {
    const indexed = [28, 29, 30, 31]
    const rows = [row(null, 'visible'), { visibility: 'visible', kind: 'assistant-step' }]
    expect([...loadedTurnsOf(indexed, rows)].sort((a, b) => a - b)).toEqual([28, 29, 30, 31])
  })

  it('没有任何行 → 保持索引原样', () => {
    expect([...loadedTurnsOf([1, 2, 3], [])].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('索引为空（旧快照没有 navigation）→ 按可见提问行重建', () => {
    const turns = loadedTurnsOf([], [row(5, 'visible'), row(6, 'visible')])
    expect([...turns].sort((a, b) => a - b)).toEqual([5, 6])
  })

  it('回合号可从节点载荷兜底读取（location 形态不一致时）', () => {
    const turns = loadedTurnsOf([7, 8], [row(7, 'visible', 'user', true), row(8, 'hidden', 'user', true)])
    expect(turns.has(7)).toBe(true)
    expect(turns.has(8)).toBe(false)
  })

  it('visibility 缺省视为可见；非 user 行不参与判定', () => {
    expect(loadedTurnsOf([5], [{ kind: 'user', location: { kind: 'turn', turn: { turn: 5 } } }]).has(5)).toBe(true)
    expect(loadedTurnsOf([6], [{ kind: 'steering', location: { kind: 'turn', turn: { turn: 6 } } }]).size).toBe(1)  // 无提问证据 → 索引原样
  })

  it('判定就是「可见提问行」本身：索引只作有无索引的开关，不参与加减', () => {
    // 索引里没有、但窗口里有可见提问 → 算已加载（它就是加载出来的那一条）
    expect([...loadedTurnsOf([1], [row(1, 'visible'), row(2, 'visible')])].sort((a, b) => a - b)).toEqual([1, 2])
    // 索引里有、但窗口里没有可见提问 → 只有索引的空壳，剔除
    expect([...loadedTurnsOf([1, 2], [row(1, 'visible')])]).toEqual([1])
  })
})
