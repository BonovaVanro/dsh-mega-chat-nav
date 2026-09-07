/**
 * The `msgNavMessages` session projection unit: a pure fold of the session
 * event log into the ordered list of user questions, each tagged with the
 * turn that claimed it. Registered on `ctx.sessionProjections` by the host
 * half (src/index.ts); persistence, replay, and client delivery are the
 * projection seam's (session-projection-cache checkpoints the state, the
 * api-proxy carriers seed + push the wire view).
 *
 * Fold rules mirror the chat messageDefinition classification: an
 * append-origin `user/message` with a human (`user`) source is a question;
 * replacement copies (compaction checkpoints) and injected context are not.
 * Turns come from `turn/start` boundaries, so retry/goal-continuation turns
 * without a question simply produce no entry — dots may skip turn numbers,
 * staying exactly aligned with the Trajectory view's turn labels.
 *
 * @module dsh-mega-chat-nav/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** 注册本投影单元到框架的合并扩展表（接口声明于 /types 出口，须在声明处合并） */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    msgNavMessages: QuestionIndexState
  }
  interface SessionProjectionMap {
    msgNavMessages: NavItem[]
  }
}

/** 投影条目：一条 user/message 提问的轻量索引（正文零驻留） */
export interface NavItem {
  /** 归属回合号（turn/start 之后的第一个提问） */
  turn: number
  /** 消息稳定 id（跳转锚点推导源） */
  id: string
  /** 事件 seq（排序与锚点序号） */
  seq: number
  /** Unix 毫秒时间戳 */
  time: number
  /** 首文本块（悬停/级联卡正文） */
  text: string
  /** 该轮性能指标（view 附加；缺数据时省略） */
  metrics?: { durationMs: number; firstTokenMs: number; tokensPerSec: number }
}

/** Fold state: the last opened turn plus every question recorded so far. */
/** 一轮的性能指标（由 turn/start、assistant/chunk、assistant/message 折叠） */
interface TurnMetric {
  /** 轮开始时间（turn/start） */
  startedAt: number
  /** 首个内容增量块时间（assistant/chunk 首 text/reasoning delta）；未流式时为 null */
  firstTokenAt: number | null
  /** 轮结束时间（assistant/message）；未完成时为 null */
  finishedAt: number | null
  /** 累计输出 token（assistant/message 的 usage.outputTokens 求和） */
  outputTokens: number
}

interface QuestionIndexState {
  /** Turn of the last `turn/start` (0 before any; turns are 1-based). */
  turn: number
  /** Every recorded question, in event order. */
  questions: NavItem[]
  /** 每轮性能指标（turn 号 → 指标） */
  metrics: Record<number, TurnMetric>
}

const navEntrySchema = z.object({
  turn: z.number(),
  id: z.string(),
  seq: z.number(),
  time: z.number(),
  text: z.string(),
  metrics: z.object({
    durationMs: z.number(),
    firstTokenMs: z.number(),
    tokensPerSec: z.number(),
  }).optional(),
})

const turnMetricSchema = z.object({
  startedAt: z.number(),
  firstTokenAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  outputTokens: z.number(),
})

const msgNavMessagesStateSchema = z.object({
  turn: z.number(),
  questions: z.array(navEntrySchema),
  metrics: z.record(z.number(), turnMetricSchema),
}).strict()

/** Validates the wire payload before it leaves the host. */
const msgNavMessagesViewSchema = z.array(navEntrySchema)

/** First text block of a user message; empty string when absent. */
function messageText(content: readonly { type?: string; text?: string }[] | undefined): string {
  const block = content?.find((part) => typeof part?.text === 'string')
  return block?.text ?? ''
}

/** The `msgNavMessages` unit registered on `ctx.sessionProjections`. */
export const msgNavProjectionDefinition: Omit<ProjectionDefinition<'msgNavMessages', QuestionIndexState>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<'msgNavMessages', QuestionIndexState>['wire']>
} = {
  key: 'msgNavMessages',
  stateVersion: 2,
  stateSchema: msgNavMessagesStateSchema,
  init: () => ({ turn: 0, questions: [], metrics: {} }),
  apply: (state: QuestionIndexState, event) => {
    // Every uninteresting event returns the same reference (Object.is gates
    // the change feed and the persisted-cache dirty check).
    switch (event.type) {
      case 'turn/start': {
        if (event.data.turn === state.turn) return state
        const metrics = { ...state.metrics }
        metrics[event.data.turn] = { startedAt: event.time, firstTokenAt: null, finishedAt: null, outputTokens: 0 }
        return { ...state, turn: event.data.turn, metrics }
      }
      case 'user/message': {
        if (event.surfaceOp !== 'append') return state
        if (event.data.source?.kind !== 'user') return state
        const entry: NavItem = {
          turn: state.turn,
          id: String(event.data.id),
          seq: event.seq,
          time: event.time,
          text: messageText(event.data.content),
        }
        return { ...state, questions: [...state.questions, entry] }
      }
      case 'assistant/chunk': {
        // 只记录每轮首个内容增量块（首 token 时间）；后续增量块不产生新 state
        const turn = event.data.turn
        const chunk = event.data.chunk
        const current = state.metrics[turn]
        if (current === undefined) return state
        if (current.firstTokenAt !== null) return state
        if (chunk?.type !== 'text-delta' && chunk?.type !== 'reasoning-delta') return state
        const metrics = { ...state.metrics, [turn]: { ...current, firstTokenAt: event.time } }
        return { ...state, metrics }
      }
      case 'assistant/message': {
        const turn = event.data.turn
        const current = state.metrics[turn]
        if (current === undefined) return state
        const output = typeof event.data.usage?.outputTokens === 'number' ? event.data.usage.outputTokens : 0
        if (output === 0 && current.finishedAt !== null) return state
        const metrics = {
          ...state.metrics,
          [turn]: { ...current, finishedAt: event.time, outputTokens: current.outputTokens + output },
        }
        return { ...state, metrics }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: msgNavMessagesViewSchema,
    view: (state: QuestionIndexState) => state.questions.map((q) => {
      const m = state.metrics[q.turn]
      if (m === undefined || m.finishedAt === null || m.startedAt <= 0) return q
      const durationMs = m.finishedAt - m.startedAt
      if (durationMs <= 0) return q
      const firstTokenMs = m.firstTokenAt !== null ? m.firstTokenAt - m.startedAt : 0
      const tokensPerSec = durationMs > 0 ? Math.round((m.outputTokens * 1000) / durationMs) : 0
      return { ...q, metrics: { durationMs, firstTokenMs, tokensPerSec } }
    }),
  },
}