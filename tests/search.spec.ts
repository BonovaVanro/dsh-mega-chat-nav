// host 侧搜索三件事的回归防护：内容范围过滤 / 助手文本上限 / 检索缓存键
import { describe, expect, it } from 'vitest'
import { searchEvents, searchCacheKey } from '../src/search.ts'
import { filterHitsByScopes, scopeOfRole } from '../src/client/components/rail/search.tsx'

/** 构造 SourcedEvent（ev + historic）；测试只关心这几个字段 */
function ev(type: string, seq: number, data: unknown, surfaceOp?: string) {
  return { ev: { type, seq, time: 1000 + seq, surfaceOp, data }, historic: false }
}
const userMsg = (seq: number, text: string, source = 'user', surfaceOp?: string) =>
  ev('user/message', seq, { id: 'u' + seq, source: { kind: source }, content: [{ type: 'text', text }] }, surfaceOp)
const assistantMsg = (seq: number, text: string) =>
  ev('assistant/message', seq, { turn: 1, step: 1, message: { content: [{ type: 'text', text }] } })
const toolCall = (seq: number, args: string) =>
  ev('tool/call', seq, { callId: 'c' + seq, name: 'bash', arguments: args })

describe('search: 内容范围过滤', () => {
  // 真机日志里 28 条 user/message 中就有 7 条来源不是 user（plugin / skill-catalog / agent-instructions）
  const events = [
    userMsg(1, 'needle real user'),
    userMsg(2, 'needle plugin inject', 'plugin'),
    userMsg(3, 'needle skill catalog', 'skill-catalog'),
    userMsg(4, 'needle agent instructions', 'agent-instructions'),
    userMsg(5, 'needle compaction copy', 'user', 'replace'),
    userMsg(6, 'needle steering', 'steering'),
    assistantMsg(7, 'needle assistant'),
    toolCall(8, 'needle tool args'),
  ] as never
  const hit = (scopes: string[]) => searchEvents(events, 'needle', 20, scopes).hits

  it('仅 user：只命中真实提问与插话，注入内容 / 压缩副本 / 助手 / 工具都不入', () => {
    expect(hit(['user']).map((h) => h.role + '#' + h.seq).sort()).toEqual(['steering#6', 'user#1'])
  })

  it('注入内容在任何范围下都不命中', () => {
    const all = hit(['user', 'assistant', 'tool'])
    expect(all).toHaveLength(4)
    for (const seq of [2, 3, 4, 5]) expect(all.some((h) => h.seq === seq)).toBe(false)
  })

  it('助手与工具按各自范围过滤', () => {
    expect(hit(['user', 'assistant']).some((h) => h.role === 'assistant')).toBe(true)
    expect(hit(['user', 'assistant']).some((h) => h.role === 'tool')).toBe(false)
    expect(hit(['user', 'tool']).some((h) => h.role === 'tool')).toBe(true)
  })
})

describe('search: 助手消息文本上限（400 字）', () => {
  const count = (events: unknown[]) => searchEvents(events as never, 'needle', 10, ['user', 'assistant']).hits.length

  it('关键词在 400 字内命中、超出不命中', () => {
    expect(count([userMsg(1, 'q'), assistantMsg(2, '甲'.repeat(300) + 'needle')])).toBe(1)
    expect(count([userMsg(1, 'q'), assistantMsg(2, '乙'.repeat(499) + 'needle')])).toBe(0)
  })

  it('恰好结束于第 400 字命中、结束于第 401 字不命中', () => {
    expect(count([userMsg(1, 'q'), assistantMsg(2, '丙'.repeat(394) + 'needle')])).toBe(1)
    expect(count([userMsg(1, 'q'), assistantMsg(2, '丁'.repeat(395) + 'needle')])).toBe(0)
  })

  it('用户消息不截断（提问侧整段可搜）', () => {
    expect(searchEvents([userMsg(1, '戊'.repeat(499) + 'needle')] as never, 'needle', 10, ['user']).hits).toHaveLength(1)
  })

  it('emoji 不被切断（按 code point 截断）', () => {
    expect(count([userMsg(1, 'q'), assistantMsg(2, '😀'.repeat(400) + 'needle')])).toBe(0)
  })
})

describe('search: 前端保险过滤（client 侧，按当前勾选再挡一层）', () => {
  const hit = (role: string, key: string) => ({ key, seq: 1, time: 1, role, turn: 1, historic: false, snippet: 'x', hitStart: 0, hitLen: 1 })

  it('未勾选的范围被过滤掉（含 host 越界返回的场景）', () => {
    const hits = [hit('user', 'a'), hit('assistant', 'b'), hit('tool', 'c')]
    expect(filterHitsByScopes(hits, ['user']).map((h) => h.key)).toEqual(['a'])
    expect(filterHitsByScopes(hits, ['user', 'tool']).map((h) => h.key)).toEqual(['a', 'c'])
    expect(filterHitsByScopes(hits, ['user', 'assistant']).map((h) => h.key)).toEqual(['a', 'b'])
  })

  it('steering 归用户范围', () => {
    expect(scopeOfRole('steering')).toBe('user')
    expect(filterHitsByScopes([hit('steering', 's')], ['user']).map((h) => h.key)).toEqual(['s'])
  })

  it('范围内无命中时返回空（不残留越界项）', () => {
    expect(filterHitsByScopes([hit('assistant', 'b')], ['user'])).toEqual([])
  })
})

describe('search: 检索缓存键', () => {
  it('内容范围不同 → 键不同（修复"去掉助手仍搜到助手"）', () => {
    expect(searchCacheKey('s1', 'needle', 0, ['user', 'assistant', 'tool']))
      .not.toBe(searchCacheKey('s1', 'needle', 0, ['user']))
  })

  it('范围集合相同而顺序不同 → 键相同（共享缓存）', () => {
    expect(searchCacheKey('s1', 'q', 0, ['user', 'tool'])).toBe(searchCacheKey('s1', 'q', 0, ['tool', 'user']))
  })

  it('会话 / 关键词 / 条数仍参与区分', () => {
    const base = searchCacheKey('s1', 'q', 0, ['user'])
    expect(base).not.toBe(searchCacheKey('s2', 'q', 0, ['user']))
    expect(base).not.toBe(searchCacheKey('s1', 'q2', 0, ['user']))
    expect(base).not.toBe(searchCacheKey('s1', 'q', 50, ['user']))
  })
})
