// @vitest-environment jsdom
// 设置控制器测试：0.1.7 路径级写入（ConfigFormLike.mutate）+ 乐观提交 + 写穿缓存 + 逐风格独立段
// （jsdom 环境：写穿缓存用到 localStorage）
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NavSettingsController, ALIGN_OPTIONS, BAND_OPTIONS, SCROLL_OPTIONS,
  DEFAULT_ALIGN, DEFAULT_BAND, DEFAULT_CARD_COUNT, DEFAULT_SCROLL,
  type ConfigFormLike, type ConfigFormSnapshotLike, type NavSettingsSection, type SettingsPathOp,
} from '../src/client/settings.ts'
import type { BandHeight, RailAlign } from '../src/client/settings.ts'
import { MEGA_CHAT_NAV_ENTRY_ID } from '../src/shared/domain.ts'

/** 假表单：记录每次 mutate 的 ops 与 revision 围栏（0.1.7 写入的唯一凭据） */
interface FakeForm {
  snapshot: ConfigFormSnapshotLike<NavSettingsSection>
  listeners: Set<() => void>
  mutates: Array<{ ops: readonly SettingsPathOp[]; expectedRevision: number | undefined }>
  /** mutate 的 resolve 值（false = 宿主拒绝写入） */
  accept: boolean
  /** true = mutate 以 reject 收场（传输失败） */
  fail: boolean
}

/** 造一份宿主配置值：general 段 + 逐风格段 */
function configSection(general: NavSettingsSection['general'], styles: NavSettingsSection['styles'] = {}): NavSettingsSection {
  return { general, styles }
}

/** 造一个假 ConfigFormLike：可配置 status / value / user / revision / writable 与写入结果 */
function makeForm(
  value: NavSettingsSection | undefined,
  opts: {
    status?: ConfigFormSnapshotLike<NavSettingsSection>['status']
    user?: unknown
    /** 缺省 1；显式传 undefined 表示宿主尚未给出 revision（loading） */
    revision?: number | undefined
    writable?: boolean
    accept?: boolean
    fail?: boolean
  } = {},
): FakeForm {
  return {
    snapshot: {
      status: opts.status ?? 'ready',
      value,
      user: opts.user,
      revision: 'revision' in opts ? opts.revision : 1,
      writable: opts.writable ?? true,
    },
    listeners: new Set(),
    mutates: [],
    accept: opts.accept ?? true,
    fail: opts.fail ?? false,
  }
}

/** 假表单的公开面：结构上即 ConfigFormLike（无 bind 键 → 走 0.1.7 的直连分支） */
function formLike(form: FakeForm): ConfigFormLike<NavSettingsSection> {
  return {
    getSnapshot: () => form.snapshot,
    subscribe: (listener: () => void) => {
      form.listeners.add(listener)
      return () => { form.listeners.delete(listener) }
    },
    mutate: (ops, expectedRevision) => {
      form.mutates.push({ ops, expectedRevision })
      return form.fail ? Promise.reject(new Error('transport down')) : Promise.resolve(form.accept)
    },
  }
}

/** 宿主推来新快照：替换值并通知订阅者 */
function publish(form: FakeForm, value: NavSettingsSection | undefined): void {
  form.snapshot = { ...form.snapshot, value }
  for (const listener of form.listeners) listener()
}

/** 让 mutate 的 then/catch 回调有机会执行 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// 写穿缓存存在 localStorage：用例之间必须隔离，否则上一个用例的未确认写入会
// 被下一个用例的控制器当成"待重放意图"恢复出来（正是本特性要覆盖的场景）
beforeEach(() => {
  localStorage.clear()
})

describe('配置常量', () => {
  it('选项与默认值', () => {
    expect(ALIGN_OPTIONS).toEqual(['left', 'right'])
    expect(DEFAULT_ALIGN).toBe('left')
    // 0.1.7：命名空间 = profile entry id（不再是自造字符串）
    expect(MEGA_CHAT_NAV_ENTRY_ID).toBe('ui-mega-chat-nav')
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
    controller.flushWrites()
    expect(controller.getSnapshot().align).toBe('left')
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
  })

  it('section 未就绪时回退默认值', () => {
    // loading：宿主还没给出 value，也无 revision → 全部回退默认值
    const form = makeForm(undefined, { status: 'loading', revision: undefined })
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    expect(controller.getSnapshot().align).toBe(DEFAULT_ALIGN)
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
  })

  it('挂载读取嵌套配置并在变更后通知', () => {
    const form = makeForm(configSection({ style: 'minimal', align: 'right' }, { minimal: { bandHeight: 'tall' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
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
    publish(form, configSection({ align: 'left' }, { minimal: { bandHeight: 'tall' } }))
    expect(controller.getSnapshot().align).toBe('left')
    expect(seen).toEqual(['left'])
    unsubscribe()
    publish(form, configSection({ align: 'right' }, { minimal: { bandHeight: 'tall' } }))
    expect(seen).toEqual(['left'])
  })

  it('挂载读取节点栏高度并在变更后通知', () => {
    const form = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    expect(controller.getSnapshot().bandHeight).toBe('standard')

    const seen: BandHeight[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().bandHeight))
    publish(form, configSection({ align: 'left' }, { minimal: { bandHeight: 'compact' } }))
    expect(seen).toEqual(['compact'])
  })

  it('非法值忽略（回退默认）', () => {
    const form = makeForm(configSection({ align: 'center' as unknown, scrollBehavior: 'fast' as unknown }, { minimal: { bandHeight: 'wide' as unknown } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    expect(controller.getSnapshot().align).toBe(DEFAULT_ALIGN)
    expect(controller.getSnapshot().bandHeight).toBe(DEFAULT_BAND)
    expect(controller.getSnapshot().scrollBehavior).toBe(DEFAULT_SCROLL)
  })

  it('写入是路径级 mutate：每次只提交被改字段，revision 用当前快照', () => {
    const form = makeForm(configSection({ style: 'minimal', align: 'left', scrollBehavior: 'smooth' }, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setAlign('right')
    controller.setBandHeight('tall')
    controller.setScrollMode('instant')
    controller.flushWrites()
    // 0.1.7 不再整段回写：宿主按 path merge，故每个 op 只带一个字段
    expect(form.mutates.map((m) => m.ops)).toEqual([
      [{ op: 'set', path: ['general', 'align'], value: 'right' }],
      [{ op: 'set', path: ['styles', 'minimal', 'bandHeight'], value: 'tall' }],
      [{ op: 'set', path: ['general', 'scrollBehavior'], value: 'instant' }],
    ])
    expect(form.mutates.every((m) => m.ops.length === 1)).toBe(true)
    // 第二个实参 = 当前快照的 revision（写入围栏）
    expect(form.mutates.map((m) => m.expectedRevision)).toEqual([1, 1, 1])
    // 乐观提交：本地状态已是用户所选
    expect(controller.getSnapshot().align).toBe('right')
    expect(controller.getSnapshot().bandHeight).toBe('tall')
    expect(controller.getSnapshot().scrollBehavior).toBe('instant')
  })

  it('general 段各 setter 各写自己的 path（含取整钳制）', () => {
    const form = makeForm(configSection({}))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setShowCount('hide')
    controller.setShowSearch('peek')
    controller.setShowQuickSettings('hide')
    controller.setShowFavorites('hide')
    controller.setRailOffset(20.4)
    controller.setRailOffset(99)
    controller.setSearchScopes(['tool'])
    controller.setStyle('codex')
    controller.flushWrites()
    expect(form.mutates.map((m) => m.ops[0])).toEqual([
      { op: 'set', path: ['general', 'showCount'], value: 'hide' },
      { op: 'set', path: ['general', 'showSearch'], value: 'peek' },
      { op: 'set', path: ['general', 'showQuickSettings'], value: 'hide' },
      { op: 'set', path: ['general', 'showFavorites'], value: 'hide' },
      // railOffset 连改两次（20.4 → 99）：防抖合并为一次，携带最终钳制值 32
      { op: 'set', path: ['general', 'railOffset'], value: 32 },
      { op: 'set', path: ['general', 'searchScopes'], value: ['user', 'tool'] },
      { op: 'set', path: ['general', 'style'], value: 'codex' },
    ])
    expect(form.mutates).toHaveLength(7)
  })

  it('乐观更新立即通知（UI 即时刷新，不等 mutate 回执）', () => {
    const form = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().align + ':' + controller.getSnapshot().bandHeight))
    controller.setAlign('right')
    controller.flushWrites()
    expect(seen).toEqual(['right:standard'])
    controller.setBandHeight('tall')
    controller.flushWrites()
    expect(seen).toEqual(['right:standard', 'right:tall'])
    // 通知先于宿主回执：此时 mutate 已被调用但尚未 settle
    expect(form.mutates).toHaveLength(2)
  })

  it('存储覆盖标记 overridden', () => {
    const form = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }), { user: { general: { align: 'left' } } })
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    expect(controller.getSnapshot().overridden).toBe(true)
  })

  it('搜索内容用户必选：setSearchScopes 强制保留 user', () => {
    const form = makeForm(configSection({}, { minimal: { bandHeight: 'standard' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setSearchScopes(['assistant'])
    controller.flushWrites()
    expect(controller.getSnapshot().searchScopes).toEqual(['user', 'assistant'])
    expect(form.mutates).toEqual([
      { ops: [{ op: 'set', path: ['general', 'searchScopes'], value: ['user', 'assistant'] }], expectedRevision: 1 },
    ])
  })

  it('重复挂载只绑定一次；写入只经唯一表单的 revision', () => {
    const formA = makeForm(configSection({ align: 'right' }, { minimal: { bandHeight: 'standard' } }), { revision: 7 })
    const formB = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }), { revision: 9 })
    const controller = new NavSettingsController()
    controller.attach(formLike(formA))
    controller.attach(formLike(formB))
    // 首份表单独占：不重复订阅，状态也不会被第二份快照覆盖
    expect(formA.listeners.size).toBe(1)
    expect(formB.listeners.size).toBe(0)
    expect(controller.getSnapshot().align).toBe('right')
    controller.setAlign('left')
    controller.flushWrites()
    expect(formA.mutates).toEqual([
      { ops: [{ op: 'set', path: ['general', 'align'], value: 'left' }], expectedRevision: 7 },
    ])
    expect(formB.mutates).toEqual([])
  })

  it('宿主不可写时不发 mutate（乐观更新仍即时生效）', () => {
    const form = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }), { writable: false })
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getSnapshot().align + ':' + controller.getSnapshot().bandHeight))
    controller.setAlign('right')
    controller.setBandHeight('tall')
    controller.flushWrites()
    expect(form.mutates).toEqual([])
    expect(seen).toEqual(['right:standard', 'right:tall'])
    expect(controller.getSnapshot().bandHeight).toBe('tall')
  })

  it('mutate 被拒或失败只告警，不抛错也不回撤本地状态', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 宿主拒绝（resolve false）→ console.warn
      const refused = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }), { accept: false })
      const a = new NavSettingsController()
      a.attach(formLike(refused))
      expect(() => a.setAlign('right')).not.toThrow()
      a.flushWrites()
      await flush()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(a.getSnapshot().align).toBe('right')

      // 传输失败（reject）→ console.error
      const broken = makeForm(configSection({ align: 'left' }, { minimal: { bandHeight: 'standard' } }), { fail: true })
      const b = new NavSettingsController()
      b.attach(formLike(broken))
      expect(() => b.setAlign('right')).not.toThrow()
      b.flushWrites()
      await flush()
      expect(error).toHaveBeenCalledTimes(1)
      expect(b.getSnapshot().align).toBe('right')
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })

  it('每风格配置段独立：codex 从 styles.codex 取值，默认不落 minimal', () => {
    // minimal 段被自定义（tall/1 卡），codex 段尚未配置 → codex 风格读自己的默认值
    const form = makeForm(configSection({ style: 'codex', align: 'right' }, { minimal: { bandHeight: 'tall', cardCount: 1 } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    const snap = controller.getSnapshot()
    expect(snap.style).toBe('codex')
    expect(snap.bandHeight).toBe(DEFAULT_BAND)      // codex 段未配置 → 默认 standard
    expect(snap.cardCount).toBe(DEFAULT_CARD_COUNT.codex) // codex 段未配置 → 默认 1 张卡
    // 切回 minimal 仍取 minimal 段自定义值（切换后立即载入该风格自己的配置）
    controller.setStyle('minimal')
    controller.flushWrites()
    expect(controller.getSnapshot().bandHeight).toBe('tall')
    expect(controller.getSnapshot().cardCount).toBe(1)
  })

  it('codex 风格写入只落 styles.codex，不染指 minimal 段', () => {
    const form = makeForm(configSection({ style: 'codex' }, { minimal: { bandHeight: 'tall' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setBandHeight('compact')
    controller.setCardCount(3)
    controller.setCardItems(['turn'])
    controller.setMarkTone('soft')
    controller.setShowPaging('show')
    controller.flushWrites()
    expect(form.mutates.map((m) => m.ops)).toEqual([
      [{ op: 'set', path: ['styles', 'codex', 'bandHeight'], value: 'compact' }],
      [{ op: 'set', path: ['styles', 'codex', 'cardCount'], value: 3 }],
      [{ op: 'set', path: ['styles', 'codex', 'cardItems'], value: ['turn'] }],
      [{ op: 'set', path: ['styles', 'codex', 'markTone'], value: 'soft' }],
      [{ op: 'set', path: ['styles', 'codex', 'showPaging'], value: 'show' }],
    ])
    // 每个 op 的 path 都指向当前风格段，别的风格段一个字节都不写
    const codexOnly = form.mutates.every((m) => m.ops.every((op) => op.path[0] === 'styles' && op.path[1] === 'codex'))
    expect(codexOnly).toBe(true)
    // 乐观提交只动本地状态：宿主快照保持原样，minimal 段未被新增字段
    expect(form.snapshot.value?.styles?.minimal).toEqual({ bandHeight: 'tall' })
    expect(form.snapshot.value?.styles?.codex).toBeUndefined()
  })

  it('deepseek 风格写入只落 styles.deepseek，不染指 minimal/codex 段', () => {
    const form = makeForm(configSection({ style: 'deepseek' }, { minimal: { bandHeight: 'tall' } }))
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setBandHeight('compact')
    controller.flushWrites()
    // deepseek 用户的条带高度写进 styles.deepseek（曾误落 minimal 段导致单次点击被宿主回读撤销）
    expect(form.mutates).toEqual([
      { ops: [{ op: 'set', path: ['styles', 'deepseek', 'bandHeight'], value: 'compact' }], expectedRevision: 1 },
    ])
    const [write] = form.mutates
    expect(write.ops[0].path).toEqual(['styles', 'deepseek', 'bandHeight'])
    // 本地乐观提交立即生效
    expect(controller.getSnapshot().bandHeight).toBe('compact')
    // 宿主回读（styles.deepseek 已更新）不再回撤：派生值与状态一致 → 无监听通知
    let notices = 0
    controller.subscribe(() => { notices += 1 })
    publish(form, configSection({ style: 'deepseek' }, { minimal: { bandHeight: 'tall' }, deepseek: { bandHeight: 'compact' } }))
    expect(controller.getSnapshot().bandHeight).toBe('compact')
    expect(notices).toBe(0)
  })

  it('翻页标记按风格独立：minimal 默认常显、codex 默认隐藏；写入只落当前风格段', () => {
    // minimal：未配置时默认 show（历史常显行为）
    const minimalForm = makeForm(configSection({ style: 'minimal' }, { minimal: { bandHeight: 'standard' } }))
    const minimal = new NavSettingsController()
    minimal.attach(formLike(minimalForm))
    expect(minimal.getSnapshot().showPaging).toBe('show')
    // codex：未配置时默认 hide
    const codexForm = makeForm(configSection({ style: 'codex' }, { codex: { bandHeight: 'standard' } }))
    const codex = new NavSettingsController()
    codex.attach(formLike(codexForm))
    expect(codex.getSnapshot().showPaging).toBe('hide')
    // minimal 用户切隐藏 → 只写 styles.minimal.showPaging
    minimal.setShowPaging('hide')
    minimal.flushWrites()
    expect(minimal.getSnapshot().showPaging).toBe('hide')
    expect(minimalForm.mutates).toEqual([
      { ops: [{ op: 'set', path: ['styles', 'minimal', 'showPaging'], value: 'hide' }], expectedRevision: 1 },
    ])
    // codex 用户切显示 → 只写 styles.codex.showPaging，minimal 那份表单不受影响
    codex.setShowPaging('show')
    codex.flushWrites()
    expect(codex.getSnapshot().showPaging).toBe('show')
    expect(codexForm.mutates).toEqual([
      { ops: [{ op: 'set', path: ['styles', 'codex', 'showPaging'], value: 'show' }], expectedRevision: 1 },
    ])
    expect(minimalForm.mutates).toHaveLength(1)
  })
})

describe('乐观写穿（宿主 reconcile 期间刷新不丢配置）', () => {
  const CACHE_KEY = 'dsh-mega-chat-nav.optimistic.v1'
  const host = configSection({ style: 'minimal', align: 'left' }, { minimal: { bandHeight: 'standard' } })

  it('写入后宿主未确认：本地即时生效且意图落进缓存', () => {
    localStorage.clear()
    const form = makeForm(host)
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setAlign('right')
    controller.flushWrites()
    expect(controller.getSnapshot().align).toBe('right')
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')).toEqual({ 'general.align': 'right' })
    controller.dispose()
  })

  it('宿主快照仍为旧值时重建控制器（模拟刷新）：从缓存恢复并自动重提交', async () => {
    localStorage.clear()
    const first = makeForm(host)
    const c1 = new NavSettingsController()
    c1.attach(formLike(first))
    c1.setAlign('right')
    c1.flushWrites()
    c1.dispose()
    // 刷新：新的表单实例，宿主还没追平（值仍是 left）
    const second = makeForm(host)
    const c2 = new NavSettingsController()
    c2.attach(formLike(second))
    expect(c2.getSnapshot().align).toBe('right')
    c2.flushWrites()
    await flush()
    expect(second.mutates).toEqual([
      { ops: [{ op: 'set', path: ['general', 'align'], value: 'right' }], expectedRevision: 1 },
    ])
    c2.dispose()
  })

  it('宿主确认（快照追平）后摘下意图并清空缓存', async () => {
    localStorage.clear()
    const form = makeForm(host)
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setAlign('right')
    controller.flushWrites()
    await flush()
    publish(form, configSection({ style: 'minimal', align: 'right' }, { minimal: { bandHeight: 'standard' } }))
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(controller.getSnapshot().align).toBe('right')
    controller.dispose()
  })

  it('宿主拒绝写入时保留意图（刷新后仍会重试）', async () => {
    localStorage.clear()
    const form = makeForm(host, { accept: false })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setAlign('right')
    controller.flushWrites()
    await flush()
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')).toEqual({ 'general.align': 'right' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    controller.dispose()
  })

  it('pending 期间 overridden 为真（设置页据此显示已改）', () => {
    localStorage.clear()
    const form = makeForm(host)
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    expect(controller.getSnapshot().overridden).toBe(false)
    controller.setAlign('right')
    controller.flushWrites()
    expect(controller.getSnapshot().overridden).toBe(true)
    controller.dispose()
  })

  it('快速连点同一开关：只发一次宿主写且携带最终值（防抖合并）', () => {
    localStorage.clear()
    const form = makeForm(host)
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    // 来回快速切换：UI 立即停在最终值
    controller.setAlign('right')
    controller.setAlign('left')
    controller.setAlign('right')
    controller.setAlign('left')
    expect(controller.getSnapshot().align).toBe('left')
    // 防抖窗口未到：一次宿主写都还没发（避免宿主串行回放整串中间值）
    expect(form.mutates).toHaveLength(0)
    controller.flushWrites()
    expect(form.mutates).toEqual([
      { ops: [{ op: 'set', path: ['general', 'align'], value: 'left' }], expectedRevision: 1 },
    ])
    controller.dispose()
  })

  it('写入未落定期间宿主回推中间值：不摘覆盖（dirty 代次门控）', async () => {
    localStorage.clear()
    const form = makeForm(host)
    const controller = new NavSettingsController()
    controller.attach(formLike(form))
    controller.setAlign('right')
    controller.flushWrites()
    // 写入尚未落定（防抖窗口内）时宿主推来旧值：覆盖必须保留，UI 不被顶回
    publish(form, configSection({ style: 'minimal', align: 'left' }, { minimal: { bandHeight: 'standard' } }))
    expect(controller.getSnapshot().align).toBe('right')
    controller.flushWrites()
    await flush()
    // 落定后宿主追平 → 覆盖摘下、值保持
    publish(form, configSection({ style: 'minimal', align: 'right' }, { minimal: { bandHeight: 'standard' } }))
    expect(controller.getSnapshot().align).toBe('right')
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    controller.dispose()
  })
})
