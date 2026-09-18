/**
 * mega 家族契约：compatCheck 开关（mega-settings 提供，各插件自行读取）。
 *
 * 语义：true（缺省）= 插件启动时照常校验 dsh 版本并在不合规时提醒；
 * false = 用户已关闭「mega 系插件兼容性校验」，插件跳过校验与提醒。
 *
 * 两条读取通道：
 *  1. 服务通道 ctx.settings.get('mega-settings')——mega-settings 已加载时生效；
 *  2. 文件通道 直接读设置文档——未安装 mega-settings 时仍尊重用户手写的配置
 *    （官方文件 provider 本身 watch 该文档并热发布外部编辑，属受支持用法）。
 * 两条都读不到时按缺省 true —— 宁可多提醒，也不因读不到配置而漏掉不兼容警示。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compatCheckEnabled, MEGA_SETTINGS_NS, readCompatCheckFromFile, settingsDocumentPath } from '../src/index.ts'

/** 造一个只实现 get(ns) 的最小 settings 面 */
function reader(value: unknown, opts: { throw?: boolean } = {}): { get(ns: string): unknown; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    get(ns: string): unknown {
      asked.push(ns)
      if (opts.throw) throw new Error('namespace not registered')
      return value
    },
  }
}

/** 写一个临时设置文档，返回其路径 */
function doc(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mgcn-settings-'))
  const file = join(dir, 'settings.yaml')
  writeFileSync(file, content, 'utf8')
  return file
}

const DOC_OFF = [
  'ui-theme:',
  '  dark: true',
  MEGA_SETTINGS_NS + ':',
  '  compatCheck: false',
  '  searchEnabled: true',
  'dsh-mega-chat-nav:',
  '  compatCheck: true',   // 同名键在别的段里，不应被误读
].join('\n')

describe('compatCheckEnabled：服务通道（mega-settings 已加载）', () => {
  it('宿主 settings 缺席且无文档 → 按缺省 true（照常校验）', () => {
    expect(compatCheckEnabled(undefined, join(tmpdir(), 'mgcn-not-exists', 'settings.yaml'))).toBe(true)
  })

  it('开关为 true → 校验', () => {
    expect(compatCheckEnabled(reader({ compatCheck: true }), '')).toBe(true)
  })

  it('开关为 false → 跳过校验与提醒', () => {
    expect(compatCheckEnabled(reader({ compatCheck: false }), '')).toBe(false)
  })

  it('服务返回非对象 / 缺字段 → 交给文件通道与缺省', () => {
    expect(compatCheckEnabled(reader(undefined), join(tmpdir(), 'mgcn-none', 'x.yaml'))).toBe(true)
    expect(compatCheckEnabled(reader({}), join(tmpdir(), 'mgcn-none', 'x.yaml'))).toBe(true)
  })

  it('服务通道抛错时不中断，回退文件通道', () => {
    expect(compatCheckEnabled(reader(undefined, { throw: true }), doc(DOC_OFF))).toBe(false)
  })

  it('读取的是 mega-settings 这个 namespace（契约字段名）', () => {
    const r = reader({ compatCheck: true })
    compatCheckEnabled(r, '')
    expect(r.asked).toEqual([MEGA_SETTINGS_NS])
    expect(MEGA_SETTINGS_NS).toBe('mega-settings')
  })
})

describe('readCompatCheckFromFile：文件通道（未装 mega-settings）', () => {
  it('文档里显式 false → 关闭', () => {
    expect(readCompatCheckFromFile(doc(DOC_OFF))).toBe(false)
  })

  it('文档里显式 true → 开启', () => {
    expect(readCompatCheckFromFile(doc('mega-settings:\n  compatCheck: true\n'))).toBe(true)
  })

  it('缺少该字段 / 缺少该段 / 文件不存在 → undefined（交回缺省 true）', () => {
    expect(readCompatCheckFromFile(doc('mega-settings:\n  searchEnabled: true\n'))).toBeUndefined()
    expect(readCompatCheckFromFile(doc('ui-theme:\n  dark: true\n'))).toBeUndefined()
    expect(readCompatCheckFromFile(join(tmpdir(), 'mgcn-none', 'settings.yaml'))).toBeUndefined()
  })

  it('只读 mega-settings 段里的同名键，不被其他段的 compatCheck 误导', () => {
    const file = doc('dsh-mega-chat-nav:\n  compatCheck: false\n')
    expect(readCompatCheckFromFile(file)).toBeUndefined()
  })

  it('非布尔值（字符串 "false" 等）视为未配置', () => {
    expect(readCompatCheckFromFile(doc('mega-settings:\n  compatCheck: "false"\n'))).toBeUndefined()
  })

  it('文档内容损坏 → undefined，不抛错', () => {
    expect(readCompatCheckFromFile(doc('mega-settings: [unclosed\n  - :::\n'))).toBeUndefined()
  })

  it('未装 mega-settings 时：文件通道即可让用户跳过校验（本轮需求的落点）', () => {
    expect(compatCheckEnabled(undefined, doc(DOC_OFF))).toBe(false)
  })
})

describe('settingsDocumentPath：与官方文件 provider 同源', () => {
  it('默认指向 $DSH_HOME/settings.yaml 或 ~/.dsh/settings.yaml', () => {
    const p = settingsDocumentPath()
    expect(p.endsWith('settings.yaml')).toBe(true)
    const home = process.env.DSH_HOME
    if (home !== undefined && home.trim().length > 0) expect(p.startsWith(home.trim())).toBe(true)
    else expect(p).toMatch(/[\\/]\.dsh[\\/]settings\.yaml$/)
  })
})
