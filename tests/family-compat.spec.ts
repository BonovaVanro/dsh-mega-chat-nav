/**
 * mega 家族**公共配置文件**开关（$DSH_HOME/mega.json 的 compatCheck）。
 *
 * 目的：0.1.7 的配置按 profile 条目分开承载，用户想「一处关闭、全体 mega 插件静音」
 * 时没有公共落点（未装 mega-settings 时更没有设置界面）。该文件是家族约定，
 * 每个成员插件在自身配置未显式设置时读它。
 *
 * 优先级：自身 config.compatCheck（显式）→ 公共文件 → 缺省 true。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compatCheckEnabled, megaFamilyConfigPath, readFamilyCompatCheck } from '../src/index.ts'

let dir = ''
const file = (): string => join(dir, 'mega.json')
const write = (text: string): void => { writeFileSync(file(), text, 'utf8') }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mgcn-mega-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('家族公共配置文件：读取语义', () => {
  it('文件缺失 → undefined（交回缺省）', () => {
    expect(readFamilyCompatCheck(file())).toBeUndefined()
  })

  it('显式 false / true → 原样返回', () => {
    write('{"compatCheck": false}')
    expect(readFamilyCompatCheck(file())).toBe(false)
    write('{"compatCheck": true}')
    expect(readFamilyCompatCheck(file())).toBe(true)
  })

  it('与其它家族字段共存时互不影响', () => {
    write('{"compatCheck": false, "somethingElse": 1}')
    expect(readFamilyCompatCheck(file())).toBe(false)
  })

  it('字段非布尔 → undefined（"false" 字符串不算关闭）', () => {
    write('{"compatCheck": "false"}')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
    write('{"compatCheck": 0}')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
    write('{"compatCheck": null}')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
  })

  it('JSON 损坏 / 顶层不是对象 / 空文件 → undefined，不抛错', () => {
    write('{ not json')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
    write('[1,2]')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
    write('null')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
    write('')
    expect(readFamilyCompatCheck(file())).toBeUndefined()
  })

  it('路径解析与官方同源：DSH_HOME 优先，否则 ~/.dsh', () => {
    const saved = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = 'D:\\some\\dsh-home'
      expect(megaFamilyConfigPath()).toBe(join('D:\\some\\dsh-home', 'mega.json'))
      delete process.env.DSH_HOME
      expect(megaFamilyConfigPath().endsWith(join('.dsh', 'mega.json'))).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
    }
  })
})

describe('家族公共配置文件：优先级', () => {
  it('自身显式值优先于公共文件（true/false 都优先）', () => {
    write('{"compatCheck": false}')
    expect(compatCheckEnabled({ compatCheck: true }, file())).toBe(true)
    write('{"compatCheck": true}')
    expect(compatCheckEnabled({ compatCheck: false }, file())).toBe(false)
  })

  it('自身未设置时跟随公共文件 → 一处关闭、全体静音', () => {
    write('{"compatCheck": false}')
    expect(compatCheckEnabled({ compatCheck: undefined }, file())).toBe(false)
    expect(compatCheckEnabled({}, file())).toBe(false)
    expect(compatCheckEnabled(undefined, file())).toBe(false)
  })

  it('自身非布尔（字符串 "false"）不作结论，继续看公共文件', () => {
    write('{"compatCheck": false}')
    expect(compatCheckEnabled({ compatCheck: 'false' }, file())).toBe(false)
  })

  it('两处都没有 → 缺省 true（照常校验）', () => {
    expect(compatCheckEnabled({}, file())).toBe(true)
    expect(compatCheckEnabled(undefined, file())).toBe(true)
    // 走默认路径时也必须无文件才算"都没配置"；开发机上可能真有 ~/.dsh/mega.json，
    // 故这里显式指向不存在的位置，避免套件依赖运行环境
    expect(compatCheckEnabled(undefined, join(dir, 'nonexistent', 'mega.json'))).toBe(true)
  })
})
