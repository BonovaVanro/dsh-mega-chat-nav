// @vitest-environment jsdom
/**
 * useMarkerData 的真实渲染回归测试（jsdom + react-dom）。
 *
 * 线上回归：把空态判据从「会话列表快照 summary.blank」换成「会话快照 blank」后，
 * 判据变成只在渲染时读一次的**非订阅**值——新会话发出首轮时没人通知，
 * 导航条于是不显示，直到重进会话（重新挂载才重读）。
 *
 * 本文件用真实渲染钉住这条：blank 由订阅驱动，订阅一响可见性必须跟着变。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { useMarkerData } from '../src/client/components/rail/useRail.ts'
import { publishActiveSession } from '../src/client/session-bridge.tsx'
import type { NavInjected } from '../src/client/components/shared/types.ts'

/** 最小注入面：只实现本用例触及的成员，其余按类型占位 */
function fakeInjected(state: {
  blank: boolean
  listeners: Set<() => void>
}): NavInjected {
  return {
    activeSession: { read: () => undefined },
    readBlank: () => state.blank,
    subscribeBlank: (_sessionId, cb) => {
      state.listeners.add(cb)
      return () => { state.listeners.delete(cb) }
    },
    readQuestions: () => [],
    subscribeContent: () => () => {},
    questionProjection: () => undefined,
    navLoadedTurns: () => new Set<number>(),
    subscribeNavLoadedTurns: () => () => {},
  } as unknown as NavInjected
}

/** 把 hook 的 { sessionId, visible } 渲染进 DOM，便于断言 */
function Probe({ injected }: { injected: NavInjected }): unknown {
  const { visible } = useMarkerData(injected)
  return createElement('span', { 'data-visible': String(visible) })
}

// 让 React 知道当前处于测试环境（否则 act 会打印「environment not configured」告警）
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => { await act(async () => {}) }

beforeEach(() => {
  // viewOk 探针：hook 用 [data-chat-flow] 判断是否对话视图
  document.body.innerHTML = '<div data-chat-flow=""></div>'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  publishActiveSession(undefined)
  document.body.innerHTML = ''
})

describe('useMarkerData：空态由订阅驱动（新会话不显示的回归）', () => {
  it('新会话空态：不显示', async () => {
    const state = { blank: true, listeners: new Set<() => void>() }
    publishActiveSession('sess-1')
    const injected = fakeInjected(state)
    await act(async () => { root.render(createElement(Probe, { injected })) })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('false')
  })

  it('首轮发出（blank 翻转）且订阅触发：立刻显示，无需重挂载', async () => {
    const state = { blank: true, listeners: new Set<() => void>() }
    publishActiveSession('sess-2')
    const injected = fakeInjected(state)
    await act(async () => { root.render(createElement(Probe, { injected })) })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('false')

    // 会话发出首轮：blank → false，会话快照订阅回调（宿主行为）
    state.blank = false
    await act(async () => { for (const cb of [...state.listeners]) cb() })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('true')
  })

  it('非空会话：订阅触发也不影响显示（幂等）', async () => {
    const state = { blank: false, listeners: new Set<() => void>() }
    publishActiveSession('sess-3')
    const injected = fakeInjected(state)
    await act(async () => { root.render(createElement(Probe, { injected })) })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('true')
    await act(async () => { for (const cb of [...state.listeners]) cb() })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('true')
  })

  it('会话缺席（桥接未上报）：不显示', async () => {
    const state = { blank: false, listeners: new Set<() => void>() }
    const injected = fakeInjected(state)
    await act(async () => { root.render(createElement(Probe, { injected })) })
    await flush()
    expect(container.querySelector('span')?.getAttribute('data-visible')).toBe('false')
  })
})
