/**
 * 活动会话解析 / 可见性 / 桥接发布所有权测试。
 *
 * 背景（官方契约演进）：官方把「当前会话」移出会话服务——0.1.5-rc.2 的列表快照
 * 还有 current，0.1.6-alpha.2 已移除（官方客户端组件自己一处都不读它）。插件的
 * 取值方式因此**只有一条路**：会话作用域槽位由框架注入 sessionId（见
 * session-bridge.tsx，与官方 TurnNavigator 同思路，该契约在 rc 线与 alpha 线一致）。
 *
 * 背景（线上回归）：会话切换时新旧桥接实例在同一提交里交接——新实例渲染写入新 id、
 * 旧实例卸载执行清理。若清理无条件清空存储，就会把新 id 抹掉且此后无通知，表现为
 * 「切换会话后导航条不显示，直到某次重渲染（例如在输入框打字）才出现」。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { railVisible, resolveActiveSession } from '../src/client/components/rail/useRail.ts'
import {
  getActiveSession,
  publishActiveSession,
  subscribeActiveSession,
} from '../src/client/session-bridge.tsx'

afterEach(() => {
  // 存储是模块级的：逐个用例后复位，避免相互污染
  publishActiveSession(undefined)
})

describe('resolveActiveSession：唯一来源 = 会话作用域桥接', () => {
  it('桥接上报的 id 直接采用', () => {
    expect(resolveActiveSession('sess-1')).toBe('sess-1')
  })

  it('脏数据守卫：空串与非法类型一律视为缺席', () => {
    expect(resolveActiveSession(undefined)).toBeUndefined()
    expect(resolveActiveSession('')).toBeUndefined()
    expect(resolveActiveSession(42)).toBeUndefined()
    expect(resolveActiveSession({ id: 'x' })).toBeUndefined()
    expect(resolveActiveSession(null)).toBeUndefined()
  })
})

describe('railVisible：会话在 + 非空态 + 对话视图在', () => {
  it('三个条件齐备才显示', () => {
    expect(railVisible('sess-1', false, true)).toBe(true)
  })

  it('会话缺席（桥接未挂载 / 未选会话）不显示', () => {
    expect(railVisible(undefined, false, true)).toBe(false)
  })

  it('新会话空态不显示（会话快照 blank）', () => {
    expect(railVisible('sess-1', true, true)).toBe(false)
  })

  it('非对话视图不显示（Trajectory 视图 / 会话未加载）', () => {
    expect(railVisible('sess-1', false, false)).toBe(false)
  })
})

describe('session bridge：发布 / 释放的所有权（切会话不显示的回归）', () => {
  it('会话切换交接：旧实例释放不得清掉新实例写入的 id', () => {
    const releaseA = publishActiveSession('sess-a')
    const releaseB = publishActiveSession('sess-b')
    expect(getActiveSession()).toBe('sess-b')
    releaseA()                                   // 旧实例卸载（本用例即线上回归点）
    expect(getActiveSession()).toBe('sess-b')    // 修复前这里会变成 undefined
    releaseB()
    expect(getActiveSession()).toBeUndefined()
  })

  it('真正退出会话时清空（无人接管 → 释放生效）', () => {
    const release = publishActiveSession('sess-c')
    release()
    expect(getActiveSession()).toBeUndefined()
  })

  it('同一会话内重复发布幂等：同值不重复通知', () => {
    publishActiveSession('sess-d')
    let notifications = 0
    const off = subscribeActiveSession(() => { notifications += 1 })
    const release = publishActiveSession('sess-d')   // 同值
    expect(notifications).toBe(0)
    release()                                        // 释放者即当前值持有者 → 清空
    expect(notifications).toBe(1)
    expect(getActiveSession()).toBeUndefined()
    off()
  })

  it('发布新值通知订阅者一次，且订阅可解绑', () => {
    let notifications = 0
    const off = subscribeActiveSession(() => { notifications += 1 })
    const release = publishActiveSession('sess-e')
    expect(notifications).toBe(1)
    off()
    release()
    expect(notifications).toBe(1)   // 解绑后不再收到
  })

  it('已释放的句柄重复调用无副作用（幂等，不误伤后续会话）', () => {
    const releaseStale = publishActiveSession('sess-f')
    releaseStale()
    releaseStale()
    expect(getActiveSession()).toBeUndefined()
    const releaseNew = publishActiveSession('sess-g')
    releaseStale()                 // 迟到的旧释放
    expect(getActiveSession()).toBe('sess-g')
    releaseNew()
  })
})
