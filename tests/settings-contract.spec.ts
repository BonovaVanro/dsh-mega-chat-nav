/**
 * Config schema 与 compat 读取的**契约回归**（走真实 schema 解析）。
 *
 * 为什么必须单独有这个套件：其余 compat 用例都用手工构造的 config 对象，
 * **绕过 schema** —— 于是下面两类致命回归全都测不出来：
 *  1. schema 字段被加回 `.default(true)` → "未设置"变成显式 true → 家族公共文件那一层永远读不到；
 *  2. 忘记解包 volatile 引用 → 直接读包装对象拿到 undefined → 自身显式层永远读不到。
 * 两处任一失守，"一处关闭、全体静音"就是死的（真实踩过，故钉死在此）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config as NavConfig, compatCheckEnabled } from '../src/index.ts'

/** apply 实收的形态：Config['~standard'].validate(raw).value */
function parsed(raw: unknown): unknown {
  const face = NavConfig as unknown as { '~standard': { validate(i: unknown): { value: unknown } } }
  return face['~standard'].validate(raw).value
}

/** 按官方 isVolatile 语义解包（对象且带 get） */
function plain(raw: unknown): Record<string, unknown> {
  const v = parsed(raw)
  if (typeof v === 'object' && v !== null && typeof (v as { get?: unknown }).get === 'function') {
    return (v as { get(): unknown }).get() as Record<string, unknown>
  }
  return v as Record<string, unknown>
}

let dir = ''
const familyFile = (): string => join(dir, 'mega.json')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mgcn-contract-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('契约 1：schema 不得给 compatCheck 补默认值', () => {
  it('未设置时解析结果里 compatCheck 必须是 undefined（够到家族层的前提）', () => {
    expect(plain({}).compatCheck).toBeUndefined()
  })

  it('若被加回 .default(true)，本用例会失败并指明后果', () => {
    // 这条断言就是命门：一旦有人给字段加 default，家族公共文件将永远读不到
    expect(plain({}).compatCheck).not.toBe(true)
  })

  it('显式值原样解析（true / false 都要保留）', () => {
    expect(plain({ compatCheck: true }).compatCheck).toBe(true)
    expect(plain({ compatCheck: false }).compatCheck).toBe(false)
  })
})

describe('契约 2：apply 实收的是 volatile 引用包装，必须解包', () => {
  it('解析结果是带 get() 的引用包装（不是普通对象）', () => {
    const value = parsed({ compatCheck: false }) as { get?: unknown }
    expect(typeof value.get).toBe('function')
  })

  it('直接读包装对象的字段拿不到值（不解包就永远读不到自身层）', () => {
    expect((parsed({ compatCheck: false }) as Record<string, unknown>).compatCheck).toBeUndefined()
  })

  it('解包后读得到显式值', () => {
    expect(plain({ compatCheck: false }).compatCheck).toBe(false)
  })
})

describe('端到端：传 apply 实收的对象（不是手工构造的裸对象）', () => {
  it('未设自身 + 家族文件 false -> 静音（三态的未设分支）', () => {
    writeFileSync(familyFile(), '{"compatCheck": false}')
    expect(compatCheckEnabled(parsed({}), familyFile())).toBe(false)
  })

  it('自身显式 true 压制家族 false（三态的显式分支）', () => {
    writeFileSync(familyFile(), '{"compatCheck": false}')
    expect(compatCheckEnabled(parsed({ compatCheck: true }), familyFile())).toBe(true)
  })

  it('自身显式 false 独立生效', () => {
    writeFileSync(familyFile(), '{"compatCheck": true}')
    expect(compatCheckEnabled(parsed({ compatCheck: false }), familyFile())).toBe(false)
  })

  it('两处都没有 -> 缺省 true', () => {
    expect(compatCheckEnabled(parsed({}), join(dir, 'absent.json'))).toBe(true)
  })
})