// host 半：全量搜索 lite 路由（读持久化日志，三级快路径 + LRU；不触客户端扩窗）
import type { Context } from '@deepseek-ai/cordis'

export interface SearchHit {
  key: string
  seq: number
  time: number
  role: string
  /** 命中消息所在轮次（turn/start 计数；未定位为 0） */
  turn: number
  /** 命中是否来自更早历史（非当前已加载窗口） */
  historic: boolean
  snippet: string
  hitStart: number
  hitLen: number
}

interface EventLike {
  type?: string
  seq?: number
  time?: number
  data?: { id?: string; content?: unknown; message?: { id?: string; content?: unknown }; source?: { kind?: string } }
}

function eventText(ev: EventLike): string {
  if (ev.type === 'tool/call') {
    // 工具调用：name + 参数 JSON 前段（可被搜索命中）
    const d = ev.data as { name?: unknown; arguments?: unknown } | undefined
    const name = typeof d?.name === 'string' ? d.name : ''
    const args = typeof d?.arguments === 'string' ? d.arguments : ''
    return name.length === 0 && args.length === 0 ? '' : name + ' ' + args.slice(0, 200)
  }
  if (ev.type !== 'user/message' && ev.type !== 'assistant/message') return ''
  const msg = ev.type === 'user/message' ? ev.data : ev.data?.message
  const content = msg?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const b of content) {
      if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
        const txt = (b as { text?: unknown }).text
        if (typeof txt === 'string') parts.push(txt)
      }
    }
    return parts.join(' ')
  }
  return ''
}

function roleOf(ev: EventLike): string {
  if (ev.type === 'user/message') {
    const kind = ev.data?.source?.kind
    return kind === 'steering' ? 'steering' : 'user'
  }
  if (ev.type === 'tool/call') return 'tool'
  return 'assistant'
}

function keyOf(ev: EventLike): string {
  const id = ev.type === 'user/message' ? ev.data?.id : ev.data?.message?.id
  return typeof id === 'string' && id.length > 0 ? id : 'seq:' + (ev.seq ?? 0)
}

function snippetAround(text: string, q: string, radius = 40): { snippet: string; hitStart: number; hitLen: number } | null {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return null
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  const pre = start > 0 ? '…' : ''
  const post = end < text.length ? '…' : ''
  return { snippet: pre + text.slice(start, end) + post, hitStart: idx - start + (start > 0 ? 1 : 0), hitLen: q.length }
}

function makeLru<T>(capacity = 32) {
  const map = new Map<string, T>()
  return {
    get(k: string): T | undefined {
      const v = map.get(k)
      if (v !== undefined) { map.delete(k); map.set(k, v) }
      return v
    },
    set(k: string, v: T): void {
      map.delete(k); map.set(k, v)
      if (map.size > capacity) {
        const first = map.keys().next().value
        if (first !== undefined) map.delete(first)
      }
    },
  }
}

const searchCache = makeLru<{ hits: SearchHit[]; truncated: boolean }>()

/** 访问可选服务：未注入的 cordis 服务在属性读取时抛错，捕获后按缺失处理 */
function tryGet<T>(getter: () => T): T | undefined {
  try { return getter() } catch { return undefined }
}

function readBody(req: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = req as { on?(ev: 'data' | 'end' | 'error', cb: (chunk?: unknown) => void): void }
    const chunks: Buffer[] = []
    r.on?.('data', (chunk) => {
      if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
    })
    r.on?.('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    r.on?.('error', reject)
  })
}

interface SessionsLike { get(id: string): { events?: readonly unknown[] } | undefined }
interface PersistenceLike { readRaw(id: string): unknown }
interface QueryLike { readSession(id: string): { events?: readonly unknown[] } }

/** 事件 + 来源标注 */
interface SourcedEvent {
  ev: EventLike
  /** 来自更早历史（持久化日志 / sessionQuery），而非当前已加载窗口 */
  historic: boolean
}

/**
 * 读取会话事件：合并「已加载窗口」（live）与「更早历史」（持久化日志 →
 * sessionQuery 兜底），按 seq 去重（历史中与 live 重复的丢弃），整体按 seq 排序。
 */
function readEventSources(
  sessionId: string,
  sessions: SessionsLike | undefined,
  persistence: PersistenceLike | undefined,
  query: QueryLike | undefined,
): SourcedEvent[] {
  const live = (sessions?.get(sessionId)?.events ?? []) as unknown as EventLike[]
  const liveSeqs = new Set<number>()
  for (const ev of live) {
    if (typeof ev?.seq === 'number') liveSeqs.add(ev.seq)
  }
  let historic: readonly EventLike[] = []
  try {
    const raw = persistence?.readRaw(sessionId)
    if (Array.isArray(raw)) historic = raw as unknown as EventLike[]
  } catch { /* 下一级 */ }
  if (historic.length === 0) {
    const q = query?.readSession(sessionId)
    if (q && Array.isArray(q.events)) historic = q.events as unknown as EventLike[]
  }
  const out: SourcedEvent[] = live.map((ev) => ({ ev, historic: false }))
  for (const ev of historic) {
    if (typeof ev?.seq === 'number' && liveSeqs.has(ev.seq)) continue
    out.push({ ev, historic: true })
  }
  return out.sort((a, b) => (a.ev.seq ?? 0) - (b.ev.seq ?? 0))
}

/**
 * 命中锚点：直接按消息 kind 拼出完整 DOM 锚点 key（对齐 conversationContextKey 公式）：
 *   - 用户/steering 消息 → '13:input-message' + id
 *   - assistant 消息 → '14:assistant-step' + turn + ':' + step（assistant-step 定义见
 *     dsh-client-ui-conversation；id 为 turn:step 组合）
 * AI 命中的方向判定 seq 取所属轮用户消息序号（AI 行紧跟其用户提问，位置近似）。
 */
/** 事件 → 搜索内容范围 */
function scopeOf(ev: EventLike): 'user' | 'assistant' | 'tool' {
  if (ev.type === 'tool/call') return 'tool'
  if (ev.type === 'assistant/message') return 'assistant'
  return 'user'
}

export function searchEvents(events: readonly SourcedEvent[], q: string, limit: number, scopes: readonly string[] = ['user', 'assistant', 'tool']): { hits: SearchHit[]; truncated: boolean } {
  const hits: SearchHit[] = []
  const needle = q.toLowerCase()
  let turn = 0
  let lastUserSeq = 0
  for (const { ev, historic } of events) {
    if (ev.type === 'turn/start') {
      const t = (ev as { data?: { turn?: unknown } }).data?.turn
      if (typeof t === 'number') turn = t
      continue
    }
    if (ev.type === 'user/message') lastUserSeq = ev.seq ?? 0
    const text = eventText(ev)
    if (!text || !text.toLowerCase().includes(needle)) continue
    if (!scopes.includes(scopeOf(ev))) continue
    const role = roleOf(ev)
    const isAssistant = role === 'assistant'
    const isTool = ev.type === 'tool/call'
    const anchorKey = isTool
      ? '9:tool-call' + String((ev as { data?: { callId?: unknown } }).data?.callId ?? '')
      : isAssistant
        ? '14:assistant-step' + turn + ':' + (ev as { data?: { step?: unknown } }).data?.step
        : '13:input-message' + keyOf(ev)
    const anchorSeq = isAssistant || isTool ? lastUserSeq : ev.seq ?? 0
    const snip = snippetAround(text, q)
    hits.push({
      key: anchorKey,
      seq: anchorSeq,
      time: ev.time ?? 0,
      role,
      turn,
      historic,
      snippet: snip ? snip.snippet : text.slice(0, 60),
      hitStart: snip ? snip.hitStart : -1,
      hitLen: snip ? snip.hitLen : 0,
    })
    if (limit > 0 && hits.length >= limit) break
  }
  return { hits, truncated: limit > 0 && hits.length >= limit }
}

export function registerSearchRoute(ctx: Context): void {
  ctx.inject(['webServer', 'sessions'], (scoped) => {
    const webServer = (scoped as unknown as {
      webServer?: { register(opts: { kind: 'prefix'; path: string; handler(req: unknown, res: unknown): Promise<void> | void }): unknown }
    }).webServer
    const sessions = (scoped as unknown as { sessions?: SessionsLike }).sessions
    if (!webServer || !sessions) return
    ctx.inject(['settings'], (settingsCtx) => {
      const settingsService = (settingsCtx as unknown as {
        settings?: { update(ns: string, patch: object, expectedRevision?: number): Promise<void> }
      }).settings
      if (!settingsService) return
      ctx.effect(() => {
        const dispose = webServer.register({
          kind: 'prefix',
          path: '/mega-chat-nav',
          handler: async (req, res) => {
            const httpRes = res as { statusCode?: number; setHeader?(k: string, v: string): void; end(s: string): void }
            const httpReq = req as { url?: string; method?: string }
            const write = (code: number, body: unknown) => {
              httpRes.statusCode = code
              httpRes.setHeader?.('Content-Type', 'application/json; charset=utf-8')
              httpRes.end(JSON.stringify(body))
            }
            try {
              const url = new URL(httpReq.url ?? '/', 'http://localhost')
              // 嵌套配置写回：scope.set 仅支持 section 内标量，嵌套 section 必须走 host 桥
              if (url.pathname === '/mega-chat-nav/settings') {
                if ((httpReq.method ?? 'GET') !== 'POST') { write(405, { ok: false, error: 'POST required' }); return }
                const raw = await readBody(req)
                let patch: unknown
                let revision: unknown
                try {
                  const body = JSON.parse(raw) as { patch?: unknown; revision?: unknown }
                  patch = body.patch
                  revision = body.revision
                } catch {
                  write(400, { ok: false, error: 'bad json' }); return
                }
                if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
                  write(400, { ok: false, error: 'patch must be an object' }); return
                }
                try {
                  await settingsService.update('mega-chat-nav', patch, typeof revision === 'number' ? revision : undefined)
                } catch (e) {
                  write(409, { ok: false, error: 'settings conflict: ' + String(e) }); return
                }
                write(200, { ok: true })
                return
              }
              if (url.pathname !== '/mega-chat-nav/search') { write(404, { ok: false, error: 'not found' }); return }
              const sessionId = url.searchParams.get('session') ?? ''
              const q = (url.searchParams.get('q') ?? '').trim()
              // limit<=0（含未传）→ 不限条数，返回全部命中
              const rawLimit = url.searchParams.get('limit')
              const limit = rawLimit === null || rawLimit === ''
                ? 0
                : Math.max(0, Math.min(Number(rawLimit) || 0, 500))
              if (!sessionId || q.length < 1) { write(400, { ok: false, error: 'session & q required' }); return }
            // 搜索内容范围（多选）；缺省全选；user 必选强制保留
            const rawScopes = (url.searchParams.get('scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
            const scopes = rawScopes.length > 0
              ? [...new Set(['user', ...rawScopes])].filter((s) => s === 'user' || s === 'assistant' || s === 'tool')
              : ['user', 'assistant', 'tool']
            const cacheKey = sessionId + '|' + q + '|' + limit
            const cached = searchCache.get(cacheKey)
            if (cached) { write(200, { ok: true, ...cached }); return }
            const persistence = tryGet(() => (scoped as unknown as { sessionPersistence?: PersistenceLike }).sessionPersistence)
            const query = tryGet(() => (scoped as unknown as { sessionQuery?: QueryLike }).sessionQuery)
            const result = searchEvents(readEventSources(sessionId, sessions, persistence, query), q, limit, scopes)
            searchCache.set(cacheKey, result)
            write(200, { ok: true, ...result })
          } catch (e) {
            write(500, { ok: false, error: String(e) })
          }
        },
      })
      return dispose as unknown as () => void
      })
    })
  })
}