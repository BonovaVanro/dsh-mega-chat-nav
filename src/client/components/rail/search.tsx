// 搜索浮层：输入防抖 → host 检索 → 结果（tag 用户/AI + 轮次标题 + 两行预览 + 历史提示）
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from '../shared/types.ts'
import { clockText } from './useRail.ts'

export interface SearchHit {
  key: string
  seq: number
  time: number
  role: string
  /** 命中消息所在轮次（host 由 turn/start 计数；未定位为 0） */
  turn: number
  /** 命中是否来自更早历史 */
  historic: boolean
  snippet: string
  hitStart: number
  hitLen: number
}

export interface SearchBoxProps {
  sessionId?: string
  t: Translate
  /** 搜索内容范围（多选；host 按此过滤） */
  scopes: readonly string[]
  /** 点击命中：key = 完整 DOM 锚点 key（host 按消息 kind 拼好）；seq = 方向判定序号 */
  onJump: (key: string, seq: number) => void
  onClose: () => void
  /** 查询为空时显示的内容（如全部轮次列表）；缺省显示空区域 */
  emptyContent?: ReactNode
}

/** 检索：携带 AbortController 的 host 请求（scopes 过滤由 host 执行） */
/**
 * 检索 + 统一排序：host 按日志顺序返回，此处统一按轮次倒序（最新轮在上；
 * 同轮按 seq 倒序——最新消息在前）。minimal/codex 浮层、deepseek 面板与移动抽屉共用，
 * 保证三种风格与搜索抽屉的命中顺序一致。
 */
export function fetchHits(sessionId: string | undefined, query: string, scopes: readonly string[], signal: AbortSignal): Promise<SearchHit[]> {
  const url = '/mega-chat-nav/search?session=' + encodeURIComponent(sessionId ?? '')
    + '&q=' + encodeURIComponent(query)
    + '&scopes=' + encodeURIComponent(scopes.join(','))   // 不传 limit → host 返回全部命中
  return fetch(url, { signal })
    .then((resp) => resp.json() as Promise<{ ok?: boolean; hits?: SearchHit[] }>)
    .then((data) => {
      const hits = data.ok === true ? (data.hits ?? []) : []
      return hits.sort((x, y) => (y.turn - x.turn) || (y.seq - x.seq))
    })
}

/** 角色 → 标签文本（用户/助手/工具；steering 归用户侧） */
function roleTag(role: string, t: Translate): string {
  if (role === 'assistant') return t('search.tag.assistant')
  if (role === 'tool') return t('search.tag.tool')
  return t('search.tag.user')
}

/** 命中角色 → 搜索范围（steering 归用户侧，与 host 侧 scopeOf 对齐） */
export function scopeOfRole(role: string): 'user' | 'assistant' | 'tool' {
  if (role === 'assistant') return 'assistant'
  if (role === 'tool') return 'tool'
  return 'user'
}

/**
 * 按当前勾选的搜索范围过滤命中——前端保险层。
 * host 已按 scopes 条件检索（未勾选的类型不进结果集），这里再挡一次，
 * 使任何越界命中（陈旧响应、缓存意外）都不会显示出来。
 */
export function filterHitsByScopes(hits: readonly SearchHit[], scopes: readonly string[]): SearchHit[] {
  return hits.filter((hit) => scopes.includes(scopeOfRole(hit.role)))
}

export function SearchBox(props: SearchBoxProps): ReactNode {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const run = useCallback((raw: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const q = raw.trim()
    if (q.length < 1) { setResults([]); setBusy(false); return }
    setBusy(true)
    fetchHits(props.sessionId, q, props.scopes, ac.signal)
      .then((hits) => {
        setResults(hits)   // fetchHits 已按轮次倒序返回
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setResults([])
      })
      .finally(() => setBusy(false))
  }, [props.sessionId, props.scopes])

  const onType = (value: string): void => {
    setQuery(value)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    // 250ms 防抖：连续输入只触发一次检索
    debounceRef.current = window.setTimeout(() => run(value), 250)
  }

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // 前端保险层：host 已按 scopes 检索，这里再按当前勾选挡一次
  const visible = filterHitsByScopes(results, props.scopes)
  const historicCount = visible.filter((hit) => hit.historic).length

  return (
    <div className="mgcn-search" role="dialog" aria-label={props.t('search.placeholder')}>
      <input
        ref={inputRef}
        className="mgcn-search-input"
        value={query}
        placeholder={props.t('search.placeholder')}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') props.onClose() }}
      />
      {busy ? <div className="mgcn-search-busy">…</div> : null}
      {!busy && query.trim() === '' && props.emptyContent !== undefined ? props.emptyContent : null}
      {!busy && visible.length > 0 && historicCount > 0 ? (
        <div className="mgcn-search-historic">{props.t('search.historic', { n: historicCount })}</div>
      ) : null}
      {visible.length > 0 ? (
      <div className="mgcn-search-results">
        {visible.map((hit) => (
          <button
            key={hit.key + ':' + hit.seq}
            type="button"
            className="mgcn-search-hit"
            onClick={() => props.onJump(hit.key, hit.seq)}
          >
            <span className="mgcn-search-title">
              <span className="mgcn-search-titleLeft">
                {hit.turn > 0 ? <span className="mgcn-search-turn">{props.t('search.turnTitle', { turn: hit.turn })}</span> : null}
                <span className={'mgcn-search-tag mgcn-search-tag--' + hit.role}>{roleTag(hit.role, props.t)}</span>
              </span>
              <span className="mgcn-search-titleTime">{clockText(hit.time, Date.now())}</span>
            </span>
            <span className="mgcn-search-body">
              <span className="mgcn-search-text">
                {hit.hitStart >= 0 && hit.hitLen > 0 ? (
                  <>
                    {hit.snippet.slice(0, hit.hitStart)}
                    <mark className="mgcn-search-mark">{hit.snippet.slice(hit.hitStart, hit.hitStart + hit.hitLen)}</mark>
                    {hit.snippet.slice(hit.hitStart + hit.hitLen)}
                  </>
                ) : hit.snippet}
              </span>
            </span>
          </button>
        ))}
      </div>
      ) : null}
    </div>
  )
}