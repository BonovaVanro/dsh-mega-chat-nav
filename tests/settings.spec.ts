// 设置控制器测试：嵌套配置（general + styles.minimal）的读取/回退/写入
import { describe, expect, it } from 'vitest'
import type { SettingsScopeSnapshot, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NavSettingsController, ALIGN_OPTIONS, BAND_OPTIONS, SCROLL_OPTIONS, DEFAULT_ALIGN, DEFAULT_BAND, DEFAULT_CARD_COUNT, DEFAULT_SCROLL, MGCN_NS, type SettingsScopeBinderLike } from '../src/client/settings.ts'
import type { BandHeight, RailAlign, ScrollMode } from '../src/client/settings.ts'

type StyleSec = { bandHeight?: unknown; cardCount?: unknown }
type Section = {
  general?: { style?: unknown; align?: unknown; scrollBehavior?: unknown; showCount?: unknown; showQuickSettings?: unknown }
  styles?: { minimal?: StyleSec; codex?: StyleSec }
}

interface FakeScope {
  snapshot: SettingsScopeSnapshot<Section>
  listeners: Set<() => void>
  setCalls: Array<[string, unknown]>
}

function readyScope(general: Section['general'], styles: Section['styles'], user: Section | undefined = undefined): SettingsScopeSnapshot<Section> {
  return { status: 'ready', value: { general, styles }, base: undefined, user, revision: 1, writable: true, mode: 'host' }
}

function makeScope(snapshot: SettingsScopeSnapshot<Section>): FakeScope {
  return { snapshot, listeners: new Set(), setCalls: [] }
}

function makeBinder(scope: FakeScope): SettingsScopeBinderLike {
  return {
    bind: <T>(_spec: SettingsScopeSpec<T>) => ({
      getSnapshot: () => scope.snapshot as unknown as SettingsScopeSnapshot<T>,
      subscribe: (listener: () => void) => {
        scope.listeners.add(listener)
        return () => { scope.listeners.delete(listener) }
      },
      set: (field, value) => {
        scope.setCalls.push([field, value])
        return Promise.resolve()
      },
      unset: () => Promise.resolve(),
    }),
  }
}

function change(scope: FakeScope, snapshot: SettingsScopeSnapshot<Section>): void {
  scope.snapshot = snapshot
  for (const listener of scope.listeners) listener()
}

/** mock 全局 fetch 记录 host 桥写入；返回恢复函数 */
function mockBridge(): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; body: unknown }> = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined })
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('配置常量', () => {
  it('选项与默认值', () => {
    expect(ALIGN_OPTIONS).toEqual(['left', 'right'])
    expect(DEFAULT_ALIGN).toBe('left')
    expect(MGCN_NS).toBe('mega-chat-nav')
    expect(BAND_OPTIONS).toEqual(['compact', 'standard', 'tall'])
    expect(DEFAULT_BAND).toBe('standard')
    expect(SCROLL_OPTIONS).toEqual(['smooth', 'instant'])
    expect(DEFAULT_SCROLL).toBe('smooth')
  })
})

describe('NavSettingsController', () => {
  it('未挂载时用默认值；写入为空操作', () => {
    const controller = new NavSettingsController()
    const snap = controller.getSnapshot()
    expect(snap.style).toBe('minimal')
    expect(snap.align).toBe('left')
    expect(snap.bandHeight).toBe(DEFAULT_BAND)
    controller.setAlign('right')
    controller.setBandHeight('tall')
    expect(controller.getSnapshot().align).toBe('left')
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
  })

  it('section 未就绪时回退默认值', () => {
    const scope = makeScope({ status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: true, mode: 'host' })
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    expect(controller.getSnapshot().align).toBe(DEFAULT_ALIGN)
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
  })

  it('挂载读取嵌套配置并在变更后通知', () => {
    const scope = makeScope(readyScope({ style: 'minimal', align: 'right' }, { minimal: { bandHeight: 'tall' } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    expect(controller.getSnapshot()).toEqual({
      style: 'minimal', align: 'right', bandHeight: 'tall', cardCount: DEFAULT_CARD_COUNT.minimal,
      cardItems: ['turn', 'duration', 'favorite'],
      markTone: 'deep',
      scrollBehavior: DEFAULT_SCROLL, showCount: 'show', showSearch: 'show', showQuickSettings: 'show', showFavorites: 'show',
      showPaging: 'show',
      searchScopes: ['user', 'assistant', 'tool'],
      railOffset: 8,
      overridden: false,
    })

    const seen: RailAlign[] = []
    const unsubscribe = controller.subscribe(() => seen.push(controller.getSnapshot().align))
    change(scope, readyScope({ align: 'left' }, { minimal: { bandHeight: 'tall' } }))
    expect(controller.getSnapshot().align).toBe('left')
    expect(seen).toEqual(['left'])
    unsubscribe()
    change(scope, readyScope({ align: 'right' }, { minimal: { bandHeight: 'tall' } }))
    expect(seen).toEqual(['left'])
  })

  it('挂载读取节点栏高度并在变更后通知', () => {
    const scope = makeScope(readyScope({ align: 'left' }, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    expect(controller.getSnapshot().bandHeight).toBe('standard')

    const seen: BandHeight[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().bandHeight))
    change(scope, readyScope({ align: 'left' }, { minimal: { bandHeight: 'compact' } }))
    expect(seen).toEqual(['compact'])
  })

  it('非法值忽略（回退默认）', () => {
    const scope = makeScope(readyScope({ align: 'center' as unknown, scrollBehavior: 'fast' as unknown }, { minimal: { bandHeight: 'wide' as unknown } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    expect(controller.getSnapshot().align).toBe(DEFAULT_ALIGN)
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
    expect(controller.getSnapshot().scrollBehavior).toBe(DEFAULT_SCROLL)
  })

  it('用户选择整段写回宿主文档（host 桥 + revision 围栏）', async () => {
    const bridge = mockBridge()
    try {
      const scope = makeScope(readyScope({ style: 'minimal', align: 'left', scrollBehavior: 'smooth' }, { minimal: { bandHeight: 'standard' } }))
      const controller = new NavSettingsController()
      controller.attach(makeBinder(scope))
      controller.setAlign('right')
      controller.setBandHeight('tall')
      controller.setScrollMode('instant')
      await flush()
      expect(bridge.calls).toHaveLength(3)
      expect(bridge.calls[0].url).toBe('/mega-chat-nav/settings')
      expect(bridge.calls[0].body).toEqual({
        patch: { general: { style: 'minimal', align: 'right', scrollBehavior: 'smooth', showCount: 'show', showSearch: 'show', showQuickSettings: 'show', showFavorites: 'show', searchScopes: ['user', 'assistant', 'tool'], railOffset: 8 } },
        revision: 1,
      })
      expect(bridge.calls[1].body).toEqual({
        patch: { styles: { minimal: { bandHeight: 'tall', cardCount: DEFAULT_CARD_COUNT.minimal, cardItems: ['turn', 'duration', 'favorite'], markTone: 'deep', showPaging: 'show' } } },
        revision: 1,
      })
      expect(bridge.calls[2].body).toEqual({
        patch: { general: { style: 'minimal', align: 'right', scrollBehavior: 'instant', showCount: 'show', showSearch: 'show', showQuickSettings: 'show', showFavorites: 'show', searchScopes: ['user', 'assistant', 'tool'], railOffset: 8 } },
        revision: 1,
      })
    } finally {
      bridge.restore()
    }
  })

  it('乐观更新立即通知（UI 即时刷新，无需等 host 写回）', () => {
    const scope = makeScope(readyScope({ align: 'left' }, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().align + ':' + controller.getSnapshot().bandHeight))
    controller.setAlign('right')
    expect(seen).toEqual(['right:standard'])
    controller.setBandHeight('tall')
    expect(seen).toEqual(['right:standard', 'right:tall'])
  })

  it('存储覆盖标记 overridden', () => {
    const scope = makeScope(readyScope({ align: 'left' }, { minimal: { bandHeight: 'standard' } }, { general: { align: 'left' } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    expect(controller.getSnapshot().overridden).toBe(true)
  })

  it('搜索内容用户必选：setSearchScopes 强制保留 user', async () => {
    const bridge = mockBridge()
    try {
      const scope = makeScope(readyScope({}, { minimal: { bandHeight: 'standard' } }))
      const controller = new NavSettingsController()
      controller.attach(makeBinder(scope))
      controller.setSearchScopes(['assistant'])
      await flush()
      expect(controller.getSnapshot().searchScopes).toEqual(['user', 'assistant'])
      expect(bridge.calls[0].body).toEqual({
        patch: { general: { style: 'minimal', align: 'left', scrollBehavior: 'smooth', showCount: 'show', showSearch: 'show', showQuickSettings: 'show', showFavorites: 'show', searchScopes: ['user', 'assistant'], railOffset: 8 } },
        revision: 1,
      })
    } finally {
      bridge.restore()
    }
  })

  it('重复挂载只绑定一次；写入只经唯一 scope 的 revision', async () => {
    const bridge = mockBridge()
    try {
      const scopeA = makeScope(readyScope({ align: 'right' }, { minimal: { bandHeight: 'standard' } }))
      const scopeB = makeScope(readyScope({ align: 'left' }, { minimal: { bandHeight: 'standard' } }))
      const controller = new NavSettingsController()
      controller.attach(makeBinder(scopeA))
      controller.attach(makeBinder(scopeB))
      controller.setAlign('left')
      await flush()
      expect(bridge.calls).toHaveLength(1)
      expect(scopeA.setCalls).toEqual([])
      expect(scopeB.setCalls).toEqual([])
    } finally {
      bridge.restore()
    }
  })

  it('每风格配置段独立：codex 从 styles.codex 取值，默认不落 minimal', () => {
    // minimal 段被自定义（tall/1 卡），codex 段尚未配置 → codex 风格读自己的默认值
    const scope = makeScope(readyScope({ style: 'codex', align: 'right' }, { minimal: { bandHeight: 'tall', cardCount: 1 } }))
    const controller = new NavSettingsController()
    controller.attach(makeBinder(scope))
    const snap = controller.getSnapshot()
    expect(snap.style).toBe('codex')
    expect(snap.bandHeight).toBe(DEFAULT_BAND)      // codex 段未配置 → 默认 standard
    expect(snap.cardCount).toBe(DEFAULT_CARD_COUNT.codex) // codex 段未配置 → 默认 1 张卡
    // 切回 minimal 仍取 minimal 段自定义值
    controller.setStyle('minimal')
    expect(controller.getSnapshot().bandHeight).toBe('tall')
    expect(controller.getSnapshot().cardCount).toBe(1)
  })

  it('codex 风格写入只落 styles.codex，不染指 minimal 段', async () => {
    const bridge = mockBridge()
    try {
      const scope = makeScope(readyScope({ style: 'codex' }, { minimal: { bandHeight: 'tall' } }))
      const controller = new NavSettingsController()
      controller.attach(makeBinder(scope))
      controller.setBandHeight('compact')
      controller.setCardCount(3)
      await flush()
      // 每个 patch 的 styles 只含 codex 键
      expect(bridge.calls[0].body.patch).toEqual({ styles: { codex: { bandHeight: 'compact', cardCount: DEFAULT_CARD_COUNT.codex, cardItems: ['turn', 'duration', 'favorite'], markTone: 'deep', showPaging: 'hide' } } })
      expect(bridge.calls[1].body.patch).toEqual({ styles: { codex: { bandHeight: 'compact', cardCount: 3, cardItems: ['turn', 'duration', 'favorite'], markTone: 'deep', showPaging: 'hide' } } })
      // patch 只含 codex 键；scope 快照未被本地写入触碰（minimal 段仍在宿主侧原样）
      const codexOnly = bridge.calls.every((c) => Object.keys(c.body.patch.styles).length === 1 && c.body.patch.styles.codex !== undefined)
      expect(codexOnly).toBe(true)
      expect(scope.snapshot.value?.styles?.minimal).toEqual({ bandHeight: 'tall' })
      expect(scope.snapshot.value?.styles?.codex).toBeUndefined()
    } finally {
      bridge.restore()
    }
  })

  it('deepseek 风格写入只落 styles.deepseek，不染指 minimal/codex 段', async () => {
    const bridge = mockBridge()
    try {
      const scope = makeScope(readyScope({ style: 'deepseek' }, { minimal: { bandHeight: 'tall' } }))
      const controller = new NavSettingsController()
      controller.attach(makeBinder(scope))
      controller.setBandHeight('compact')
      await flush()
      // deepseek 用户的条带高度写进 styles.deepseek（曾误落 minimal 段导致单次点击被宿主回读撤销）
      const patch = bridge.calls[0].body.patch as { styles?: Record<string, unknown> }
      expect(Object.keys(patch.styles ?? {})).toEqual(['deepseek'])
      expect((patch.styles as { deepseek: { bandHeight: string } }).deepseek.bandHeight).toBe('compact')
      expect((patch.styles as { minimal?: unknown }).minimal).toBeUndefined()
      expect((patch.styles as { codex?: unknown }).codex).toBeUndefined()
      // 本地乐观提交立即生效
      expect(controller.getSnapshot().bandHeight).toBe('compact')
      // 宿主回读（styles.deepseek 已更新）不再回撤：订阅回调派生的值与状态一致 → 无监听通知
      let notices = 0
      controller.subscribe(() => { notices += 1 })
      change(scope, readyScope({ style: 'deepseek' }, { minimal: { bandHeight: 'tall' }, deepseek: { bandHeight: 'compact' } }))
      expect(controller.getSnapshot().bandHeight).toBe('compact')
      expect(notices).toBe(0)
    } finally {
      bridge.restore()
    }
  })

  it('翻页标记按风格独立：minimal 默认常显、codex 默认隐藏；写入只落当前风格段', async () => {
    const bridge = mockBridge()
    try {
      // minimal：未配置时默认 show（历史常显行为）
      const scopeA = makeScope(readyScope({ style: 'minimal' }, { minimal: { bandHeight: 'standard' } }))
      const controllerA = new NavSettingsController()
      controllerA.attach(makeBinder(scopeA))
      expect(controllerA.getSnapshot().showPaging).toBe('show')
      // codex：未配置时默认 hide
      const scopeB = makeScope(readyScope({ style: 'codex' }, { codex: { bandHeight: 'standard' } }))
      const controllerB = new NavSettingsController()
      controllerB.attach(makeBinder(scopeB))
      expect(controllerB.getSnapshot().showPaging).toBe('hide')
      // minimal 用户切隐藏 → 写入 styles.minimal（不带 codex 段）
      controllerA.setShowPaging('hide')
      await flush()
      expect(controllerA.getSnapshot().showPaging).toBe('hide')
      expect(bridge.calls[0].body).toEqual({
        patch: { styles: { minimal: { bandHeight: 'standard', cardCount: DEFAULT_CARD_COUNT.minimal, cardItems: ['turn', 'duration', 'favorite'], markTone: 'deep', showPaging: 'hide' } } },
        revision: 1,
      })
      // codex 用户切显示 → 写入 styles.codex
      controllerB.setShowPaging('show')
      await flush()
      expect(controllerB.getSnapshot().showPaging).toBe('show')
      expect(bridge.calls[1].body.patch.styles.codex.showPaging).toBe('show')
      expect(bridge.calls[1].body.patch.styles.minimal).toBeUndefined()
    } finally {
      bridge.restore()
    }
  })
})