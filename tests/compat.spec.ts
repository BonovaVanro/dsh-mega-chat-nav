import { describe, it, expect } from 'vitest'
import {
  parseDshVersion,
  compareDshVersions,
  checkDshVersion,
  wildcardEqual,
  checkDshPolicy,
  dshCompatMessage,
  type DshCmpOp,
} from '../src/compat.ts'

describe('compat: parseDshVersion', () => {
  it('常规与预发布版本', () => {
    expect(parseDshVersion('0.1.1-rc.2')).toEqual({ base: [0, 1, 1], pre: ['rc', '2'] })
    expect(parseDshVersion('0.1.3-alpha.1')).toEqual({ base: [0, 1, 3], pre: ['alpha', '1'] })
    expect(parseDshVersion('0.1.0')).toEqual({ base: [0, 1, 0], pre: null })
  })

  it('非法串返回 null', () => {
    expect(parseDshVersion('')).toBeNull()
    expect(parseDshVersion('v0.1.1')).toBeNull()
    expect(parseDshVersion('0.1')).toBeNull()
    expect(parseDshVersion('a.b.c')).toBeNull()
    expect(parseDshVersion('0.1.1-')).toBeNull()
  })
})

describe('compat: compareDshVersions', () => {
  const cases: [string, string, number][] = [
    ['0.1.1-rc.2', '0.1.1-rc.2', 0],
    ['0.1.1-rc.2', '0.1.1-rc.1', 1],
    ['0.1.1-rc.1', '0.1.1-rc.2', -1],
    ['0.1.2-alpha.5', '0.1.2-alpha.1', 1],
    ['0.1.2-alpha.5', '0.1.2-rc.1', -1], // alpha < rc
    ['0.1.2-rc.1', '0.1.1-rc.2', 1], // 基线优先
    ['0.1.2-rc.1', '0.1.3-alpha.1', -1],
    ['0.1.1-rc.2', '0.1.1', -1], // 正式版更高
    ['0.1.1', '0.1.1-rc.2', 1],
    ['0.1.10', '0.1.9', 1], // 数值比较
  ]
  for (const [a, b, want] of cases) {
    it(a + ' vs ' + b + ' → ' + want, () => {
      expect(compareDshVersions(a, b)).toBe(want)
    })
  }

  it('非法版本返回 NaN', () => {
    expect(Number.isNaN(compareDshVersions('0.1.1', 'oops'))).toBe(true)
  })
})

describe('compat: checkDshVersion 操作符', () => {
  it('等于/不等于', () => {
    expect(checkDshVersion('0.1.1-rc.2', '=', '0.1.1-rc.2')).toBe(true)
    expect(checkDshVersion('0.1.1-rc.2', '=', '0.1.1-rc.1')).toBe(false)
  })

  it('大于/小于', () => {
    expect(checkDshVersion('0.1.2-rc.1', '>', '0.1.1-rc.2')).toBe(true)
    expect(checkDshVersion('0.1.1-rc.1', '<', '0.1.1-rc.2')).toBe(true)
    expect(checkDshVersion('0.1.1-rc.2', '>', '0.1.1-rc.2')).toBe(false)
  })

  it('大于等于/小于等于', () => {
    expect(checkDshVersion('0.1.1-rc.2', '>=', '0.1.1-rc.2')).toBe(true)
    expect(checkDshVersion('0.1.1-rc.1', '>=', '0.1.1-rc.2')).toBe(false)
    expect(checkDshVersion('0.1.1-rc.1', '<=', '0.1.1-rc.2')).toBe(true)
  })

  it('非法版本一律 false', () => {
    for (const op of ['>', '<', '='] as DshCmpOp[]) {
      expect(checkDshVersion('bad', op, '0.1.1-rc.2')).toBe(false)
      expect(checkDshVersion('0.1.1-rc.2', op, 'bad')).toBe(false)
    }
  })
})

describe('compat: 通配 wildcardEqual（= 0.1.1-* 支持 rc.1 / rc.2）', () => {
  it('0.1.1-* 命中该基线任意预发布', () => {
    expect(wildcardEqual('0.1.1-rc.1', '0.1.1-*')).toBe(true)
    expect(wildcardEqual('0.1.1-rc.2', '0.1.1-*')).toBe(true)
    expect(wildcardEqual('0.1.1-alpha.3', '0.1.1-*')).toBe(true)
  })

  it('0.1.1-* 不命中其他基线/正式版', () => {
    expect(wildcardEqual('0.1.2-rc.1', '0.1.1-*')).toBe(false)
    expect(wildcardEqual('0.1.1', '0.1.1-*')).toBe(false) // 无预发布
    expect(wildcardEqual('0.1.0-rc.8', '0.1.1-*')).toBe(false)
  })

  it('细化通配：0.1.1-rc.* 仅命中 rc 线', () => {
    expect(wildcardEqual('0.1.1-rc.1', '0.1.1-rc.*')).toBe(true)
    expect(wildcardEqual('0.1.1-rc.2', '0.1.1-rc.*')).toBe(true)
    expect(wildcardEqual('0.1.1-alpha.1', '0.1.1-rc.*')).toBe(false)
  })

  it('基线通配 0.1.* 命中任意小版本', () => {
    expect(wildcardEqual('0.1.0-rc.8', '0.1.*')).toBe(true)
    expect(wildcardEqual('0.1.2-rc.1', '0.1.*')).toBe(true)
    expect(wildcardEqual('0.2.0', '0.1.*')).toBe(false)
  })

  it('无通配模式等价精确相等', () => {
    expect(wildcardEqual('0.1.1-rc.2', '0.1.1-rc.2')).toBe(true)
    expect(wildcardEqual('0.1.1', '0.1.1')).toBe(true)
  })
})

describe('compat: checkDshPolicy + 提示文案', () => {
  it('通配仅对 = 生效', () => {
    expect(checkDshPolicy('0.1.1-rc.2', { op: '=', target: '0.1.1-*' })).toBe(true)
    expect(checkDshPolicy('0.1.1-rc.1', { op: '=', target: '0.1.1-*' })).toBe(true)
    expect(checkDshPolicy('0.1.1-rc.2', { op: '>', target: '0.1.1-*' })).toBe(false)
    expect(checkDshPolicy('0.1.2-rc.1', { op: '=', target: '0.1.1-*' })).toBe(false)
  })

  it('非通配按操作符', () => {
    expect(checkDshPolicy('0.1.1-rc.2', { op: '>=', target: '0.1.1-rc.2' })).toBe(true)
    expect(checkDshPolicy('0.1.1-rc.1', { op: '>=', target: '0.1.1-rc.2' })).toBe(false)
  })

  it('target 数组：命中任一即通过（含通配项）', () => {
    expect(checkDshPolicy('0.1.1-rc.2', { op: '=', target: ['0.1.0-rc.8', '0.1.1-*'] })).toBe(true)
    expect(checkDshPolicy('0.1.1-rc.1', { op: '=', target: ['0.1.1-*', '0.1.2-rc.1'] })).toBe(true)
    expect(checkDshPolicy('0.1.2-rc.1', { op: '=', target: ['0.1.1-*', '0.1.2-rc.1'] })).toBe(true)
  })

  it('target 数组：全部不命中则失败', () => {
    expect(checkDshPolicy('0.1.3-alpha.1', { op: '=', target: ['0.1.1-*', '0.1.2-rc.1'] })).toBe(false)
    expect(checkDshPolicy('0.1.1-rc.2', { op: '>', target: ['0.1.1-*', '0.1.3-*'] })).toBe(false) // 通配项仅 = 生效
  })

  it('target 数组配合关系操作符逐项比较', () => {
    expect(checkDshPolicy('0.1.2-rc.1', { op: '>=', target: ['0.1.1-rc.2', '0.1.2-rc.1'] })).toBe(true)
    expect(checkDshPolicy('0.1.1-rc.1', { op: '>=', target: ['0.1.1-rc.2', '0.1.2-rc.1'] })).toBe(false)
  })

  it('提示文案含插件名与当前 dsh 版本', () => {
    expect(dshCompatMessage('dsh-mega-chat-nav', '0.1.1-rc.2')).toBe(
      'dsh-mega-chat-nav 可能不适配 dsh 0.1.1-rc.2 版本，请慎重使用',
    )
  })
})
