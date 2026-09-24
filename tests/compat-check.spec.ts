/**
 * mega 家族契约：compatCheck 开关（各 mega 插件读**自己的配置**）。
 *
 * 语义：true（缺省）= 插件启动时照常校验 dsh 版本并在不合规时提醒；
 * false = 用户已关闭「mega 系插件兼容性校验」，插件跳过校验与提醒。
 *
 * 0.1.7 的读取入口只有一处：apply(ctx, config) 第二参里的 compatCheck
 * （配置承载在 profile patch entry 的 config 段）。
 * 两条旧通道均已随迁移移除，不再有回退：
 *  - settings.yaml 文件通道（0.1.5-rc 线；0.1.7 该文档不再是配置中心）；
 *  - settings.get('mega-settings') 跨插件服务通道（0.1.7 契约改为各读自己的配置，
 *    mega-settings 自身也只读 config.compatCheck）。
 * 读不到时按缺省 true —— 宁可多提醒，也不因读不到配置而漏掉不兼容警示。
 */
import { describe, expect, it } from 'vitest'
import { compatCheckEnabled } from '../src/index.ts'

/**
 * 家族公共配置路径：指向一个**必定不存在**的文件。
 * 本套件只验证"自身配置层"的语义，不能被开发机上的真实 ~/.dsh/mega.json 影响——
 * 那是套件外部的状态（家族层优先级另有 tests/family-compat.spec.ts 专测）。
 */
const ABSENT = 'D:\\__nonexistent__\\mega.json'

describe('compatCheckEnabled：显式配置定论', () => {
  it('compatCheck 为 true → 照常校验', () => {
    expect(compatCheckEnabled({ compatCheck: true }, ABSENT)).toBe(true)
  })

  it('compatCheck 为 false → 跳过校验与提醒', () => {
    expect(compatCheckEnabled({ compatCheck: false }, ABSENT)).toBe(false)
  })

  it('与其它配置字段共存时互不影响', () => {
    expect(compatCheckEnabled({ compatCheck: false, general: { style: 'codex' } }, ABSENT)).toBe(false)
    expect(compatCheckEnabled({ general: { style: 'codex' } }, ABSENT)).toBe(true)
  })
})

describe('compatCheckEnabled：非布尔一律不作结论', () => {
  it('字符串 "false" / 0 / null 都不算关闭（只有 true|false 生效）', () => {
    // YAML 里手写引号会被解析成字符串；这类"看起来像关闭"的值不能真的关掉校验
    expect(compatCheckEnabled({ compatCheck: 'false' }, ABSENT)).toBe(true)
    expect(compatCheckEnabled({ compatCheck: 0 }, ABSENT)).toBe(true)
    expect(compatCheckEnabled({ compatCheck: null }, ABSENT)).toBe(true)
    expect(compatCheckEnabled({ compatCheck: 'yes' }, ABSENT)).toBe(true)
  })

  it('缺字段 / 空对象 / 非对象 → 缺省 true', () => {
    expect(compatCheckEnabled({}, ABSENT)).toBe(true)
    expect(compatCheckEnabled({ searchEnabled: false }, ABSENT)).toBe(true)
    expect(compatCheckEnabled('nope', ABSENT)).toBe(true)
    expect(compatCheckEnabled(42, ABSENT)).toBe(true)
  })

  it('未收到配置（apply 第二参缺席）→ 缺省 true', () => {
    expect(compatCheckEnabled(undefined, ABSENT)).toBe(true)
    expect(compatCheckEnabled(undefined, ABSENT)).toBe(true)
    expect(compatCheckEnabled(null, ABSENT)).toBe(true)
  })
})
