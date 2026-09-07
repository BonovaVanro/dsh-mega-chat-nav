/**
 * dsh 版本校验器（纯函数，零依赖：宿主侧 / 单测均可用）。
 *
 * 语义（对齐官方 deepseek-harness tag 线，如 dsh-v0.1.1-rc.2）：
 * - 比较按语义化版本：主/次/修订号数值比较优先；
 * - 同基线预发布排序：alpha < rc（标识符字典序），数字标识按数值比较；
 * - 正式版（无预发布）高于同基线任意预发布（0.1.1 > 0.1.1-rc.2）；
 * - 支持操作符：>  <  =（另附 >=  <=）；
 * - 通配：仅 '=' 支持，如 '0.1.1-*' 匹配该基线的任意预发布（0.1.1-rc.1 / 0.1.1-rc.2 …）；
 *   '*' 作为标识段时吞掉其后的全部剩余标识。
 */
export type DshCmpOp = '>' | '>=' | '<' | '<=' | '='

/** 兼容策略：当前 dsh 版本与目标的比较约束。 */
export interface DshCompatPolicy {
  op: DshCmpOp
  /**
   * 目标版本（可含通配，如 0.1.1-*，仅 op='=' 生效）。
   * 支持数组：命中其中任一版本即通过，如 ['0.1.1-*', '0.1.2-rc.1']。
   */
  target: string | readonly string[]
}

export interface DshVersionParts {
  /** [major, minor, patch] */
  base: [number, number, number]
  /** 预发布标识数组（rc、alpha、数字…）；无预发布 = null */
  pre: string[] | null
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** 解析 dsh 版本串；非法返回 null（不支持 x.y / 纯数字 etc.）。 */
export function parseDshVersion(v: string): DshVersionParts | null {
  const m = VERSION_RE.exec(v.trim())
  if (!m) return null
  const pre = m[4] !== undefined ? m[4].split('.') : null
  if (pre !== null && pre.some((s) => s === '')) return null
  return { base: [Number(m[1]), Number(m[2]), Number(m[3])], pre }
}

function compareIdent(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) {
    const x = Number(a)
    const y = Number(b)
    return x === y ? 0 : x < y ? -1 : 1
  }
  if (na) return -1 // 数字标识 < 字母标识
  if (nb) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

function comparePre(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdent(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

/**
 * 语义化比较：a < b → -1；相等 → 0；a > b → 1；任一无法解析 → NaN。
 */
export function compareDshVersions(a: string, b: string): number {
  const pa = parseDshVersion(a)
  const pb = parseDshVersion(b)
  if (pa === null || pb === null) return NaN
  for (let i = 0; i < 3; i++) {
    if (pa.base[i] !== pb.base[i]) return pa.base[i] < pb.base[i] ? -1 : 1
  }
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1 // 正式版高于同基线任意预发布
  if (pb.pre === null) return -1
  return comparePre(pa.pre, pb.pre)
}

/** 操作符比较（非法版本一律 false）。 */
export function checkDshVersion(current: string, op: DshCmpOp, target: string): boolean {
  const c = compareDshVersions(current, target)
  if (Number.isNaN(c)) return false
  switch (op) {
    case '>':
      return c > 0
    case '>=':
      return c >= 0
    case '<':
      return c < 0
    case '<=':
      return c <= 0
    default:
      return c === 0
  }
}

/** 标识段匹配：'*' 吞掉 ≥1 个剩余标识；静态段全等（全数字按数值比较）。 */
function matchIdents(cur: string[], pat: string[]): boolean {
  const f = (i: number, j: number): boolean => {
    if (i === cur.length && j === pat.length) return true
    if (j === pat.length) return false
    if (pat[j] === '*') {
      if (i >= cur.length) return false // * 至少匹配 1 个
      for (let k = i + 1; k <= cur.length; k++) {
        if (f(k, j + 1)) return true
      }
      return false
    }
    if (i >= cur.length) return false
    if (compareIdent(pat[j], cur[i]) !== 0) return false
    return f(i + 1, j + 1)
  }
  return f(0, 0)
}

/**
 * 通配相等（仅配合 op='='）：pattern 形如 0.1.1-*（任意预发布）、0.1.1-rc.*、
 * 0.1.*（任意小版本）等；'*' 匹配 ≥1 个标识。例：0.1.1-* 命中 0.1.1-rc.1 / 0.1.1-rc.2。
 */
export function wildcardEqual(version: string, pattern: string): boolean {
  const pv = parseDshVersion(version)
  if (pv === null) return false
  const dash = pattern.indexOf('-')
  const basePat = (dash >= 0 ? pattern.slice(0, dash) : pattern).split('.')
  const prePat = dash >= 0 ? pattern.slice(dash + 1).split('.') : null
  if (basePat.length !== 3) return false
  const baseHasStar = basePat.some((t) => t === '*')
  for (let i = 0; i < 3; i++) {
    const t = basePat[i]
    if (t === '*') continue
    if (!/^\d+$/.test(t)) return false
    if (Number(t) !== pv.base[i]) return false
  }
  if (prePat === null) {
    // 无预发布子句：基线精确时要求同为正式版；基线含通配（0.1.*）则任意预发布也算命中
    return baseHasStar || pv.pre === null
  }
  if (pv.pre === null) return false // 模式含预发布通配：当前必须有预发布
  return matchIdents(pv.pre, prePat)
}

/** 单项命中：target 含 '*' 时仅接受 op='=' 的通配比较，否则按操作符数值比较。 */
function entryPasses(current: string, op: DshCmpOp, target: string): boolean {
  if (target.includes('*')) {
    if (op !== '=') return false
    return wildcardEqual(current, target)
  }
  return checkDshVersion(current, op, target)
}

/** 策略校验：target 为数组时命中任一即通过；通配（如 0.1.1-*）仅在 op='=' 时参与。 */
export function checkDshPolicy(current: string, policy: DshCompatPolicy): boolean {
  const targets = Array.isArray(policy.target) ? policy.target : [policy.target]
  return targets.some((t) => entryPasses(current, policy.op, t))
}

/** 不兼容时的控制台提示文案（xxx = 检测到的当前 dsh 版本）。 */
export function dshCompatMessage(pluginName: string, currentDshVersion: string): string {
  return pluginName + ' 可能不适配 dsh ' + currentDshVersion + ' 版本，请慎重使用'
}