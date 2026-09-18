/**
 * 会话桥接：把「当前会话」从**会话作用域**接出来，供根作用域的浮层导航条读取。
 *
 * 为什么需要它：导航条挂在 `shell.overlay`（视口级浮层，不被滚动容器裁剪），
 * 那是 root 作用域，拿不到框架给会话作用域槽位的 `sessionId` 标准 prop。
 * 0.1.5-rc.2 与 0.1.6-alpha.1 还能从 `SessionListState.current` 读当前会话，
 * 但 alpha.2 把 `current` / `currentAddress` 一起移除（官方注释：
 * 「view selection remains outside the Controller」），于是根作用域再也读不到。
 *
 * 官方自己的回合导航轨（TurnNavigator）就是会话作用域组件——不读任何列表字段。
 * 本模块把同一思路搬过来：在会话作用域挂一个**无渲染**的条目，报出所在会话，
 * 浮层按订阅读取。老版本仍保留 `current` 作为回退，因此三个版本通吃。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

/** 当前会话 id 的订阅存储（模块级：注册期与渲染期共享同一份） */
let active: string | undefined
const listeners = new Set<() => void>()

/**
 * 发布活动会话并返回该次发布的**释放句柄**。
 *
 * 为什么需要句柄：会话切换时新旧桥接实例会在同一提交里交接（新实例渲染写入新 id、
 * 旧实例卸载执行清理）。若清理无条件清空存储，就会把新实例刚写入的 id 抹掉，
 * 且此后没有通知——表现为「切换会话后导航条不显示，直到某次重渲染才出现」
 * （例如在输入框打字）。因此清理只在「存储里仍是本次发布的值」时才生效。
 *
 * @param sessionId - 本次发布的活动会话
 * @returns 释放函数（值已被他人接管时为空操作）
 */
export function publishActiveSession(sessionId: string | undefined): () => void {
  if (active !== sessionId) {
    active = sessionId
    for (const listener of listeners) listener()
  }
  const mine = sessionId
  return () => {
    if (active !== mine) return   // 已被新实例接管：不越权清空
    active = undefined
    for (const listener of listeners) listener()
  }
}

/** 读取活动会话（会话作用域桥接缺席时为 undefined） */
export function getActiveSession(): string | undefined {
  return active
}

/** 订阅活动会话变化 */
export function subscribeActiveSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 响应式读取活动会话（根作用域浮层用）；桥接未挂载时为 undefined */
export function useActiveSession(): string | undefined {
  return useSyncExternalStore(subscribeActiveSession, getActiveSession, getActiveSession)
}

/** 桥接组件 props：框架给会话作用域槽位的标准 prop（只用到 sessionId） */
export interface SessionBridgeProps {
  sessionId?: string
}

/**
 * 会话作用域桥接条目：只上报所在会话，不渲染任何内容。
 *
 * 挂在 `conversation.input.overlay`（list + session 作用域 + 纯 renderSlot）：
 * 该槽位在 0.1.5-rc.2 / alpha.1 / alpha.2 三版都存在且都被渲染，
 * 返回 null 不占位、不影响输入区布局。
 */
export function SessionBridge(props: SessionBridgeProps): ReactNode {
  const sessionId = props.sessionId
  // 每次渲染同步最新值（幂等：同值不通知）
  publishActiveSession(sessionId)
  // 本次发布的生命周期只在**同一会话**内有效：sessionId 变化或组件卸载即释放；
  // 释放是「有条件」的（见 publishActiveSession），新实例已接管时不会误清空
  useEffect(() => publishActiveSession(sessionId), [sessionId])
  return null
}
