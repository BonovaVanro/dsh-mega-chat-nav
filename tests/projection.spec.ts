import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { msgNavProjectionDefinition as unit } from '../src/projection.ts'
import type { NavItem } from '../src/projection.ts'

interface FoldState {
  turn: number
  questions: NavItem[]
}

function turnStart(turn: number, seq: number): SessionEvent {
  return { type: 'turn/start', seq, time: seq * 10, data: { turn } } as SessionEvent
}

function question(seq: number, id: string, text: string, over: { surfaceOp?: string; sourceKind?: string } = {}): SessionEvent {
  return {
    type: 'user/message', seq, time: seq * 10, surfaceOp: over.surfaceOp ?? 'append',
    data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: over.sourceKind ?? 'user' } },
  } as unknown as SessionEvent
}

function fold(events: readonly SessionEvent[]): FoldState {
  let state = unit.init() as FoldState
  for (const event of events) state = unit.apply(state, event) as FoldState
  return state
}

describe('投影折叠（msgNavMessages）', () => {
  it('初始为空（turn 0）', () => {
    expect(unit.init()).toEqual({ turn: 0, questions: [], metrics: {} })
  })

  it('记录 append 源 user 提问并归属回合', () => {
    const state = fold([turnStart(1, 4), question(7, 'msg-1', 'hello')])
    expect(state.questions).toEqual([{ turn: 1, id: 'msg-1', seq: 7, time: 70, text: 'hello' }])
  })

  it('提问归属其所在回合', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'first'), turnStart(2, 20), question(25, 'b', 'second')])
    expect(state.questions.map(q => [q.turn, q.id])).toEqual([[1, 'a'], [2, 'b']])
  })

  it('同回合多问按事件序保留', () => {
    const state = fold([turnStart(3, 10), question(11, 'a', 'one'), question(12, 'b', 'two')])
    expect(state.questions.map(q => q.id)).toEqual(['a', 'b'])
    expect(state.questions.every(q => q.turn === 3)).toBe(true)
  })

  it('跳过 replace 副本（压缩检查点）', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real'), question(30, 'b', 'cp', { surfaceOp: 'replace' })])
    expect(state.questions.map(q => q.id)).toEqual(['a'])
  })

  it('跳过非 user 源（注入上下文/插件副本）', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real'), question(8, 'b', 'inj', { sourceKind: 'agent' }), question(9, 'c', 'cp', { sourceKind: 'plugin' })])
    expect(state.questions.map(q => q.id)).toEqual(['a'])
  })

  it('无关事件类型不入索引', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real'), { type: 'assistant/message', seq: 8, time: 80, data: {} } as unknown as SessionEvent])
    expect(state.questions).toHaveLength(1)
  })

  it('无关事件返回同引用（Object.is 闸门）', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real')])
    expect(unit.apply(state, { type: 'step/end', seq: 8, time: 80, data: { turn: 1, step: 1 } } as SessionEvent)).toBe(state)
  })

  it('重复回合号返回同引用', () => {
    const state = fold([turnStart(1, 4)])
    expect(unit.apply(state, turnStart(1, 9))).toBe(state)
  })

  it('被过滤消息返回同引用', () => {
    const state = fold([turnStart(1, 4)])
    expect(unit.apply(state, question(7, 'x', 'cp', { surfaceOp: 'replace' }))).toBe(state)
    expect(unit.apply(state, question(8, 'y', 'ctx', { sourceKind: 'agent' }))).toBe(state)
  })

  it('无 turn/start 的早期提问归 turn 0', () => {
    const state = fold([question(1, 'early', 'pre-turn')])
    expect(state.questions[0]?.turn).toBe(0)
  })

  it('无文本块时 text 为空串', () => {
    const event = { type: 'user/message', seq: 7, time: 70, surfaceOp: 'append', data: { id: 'img', role: 'user', content: [{ type: 'image' }], source: { kind: 'user' } } } as unknown as SessionEvent
    const state = fold([turnStart(1, 4), event])
    expect(state.questions[0]?.text).toBe('')
  })

  it('wire 视图即提问列表', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real')])
    expect(unit.wire?.view(state)).toEqual(state.questions)
  })

  it('状态经 schema 往返一致（持久化边界）', () => {
    const state = fold([turnStart(1, 4), question(7, 'a', 'real')])
    expect(unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('stateVersion 非负整数', () => {
    expect(Number.isInteger(unit.stateVersion)).toBe(true)
    expect(unit.stateVersion).toBeGreaterThanOrEqual(0)
  })
})