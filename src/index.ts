/**
 * Host half of the dsh-mega-chat-nav plugin — runs in the DSH host process.
 *
 * 0.1.7 起插件配置的声明方式改为**导出 `Config` schema**：设置命名空间与配置表单由它
 * 自动派生，`ctx.settings.register` 已被官方移除。自身配置经 `apply(ctx, config)`
 * 的**第二参**注入（不是 `ctx.config`——那是 cordis 守卫属性，声明进 inject 会被当成
 * 待就绪的 service 而永久 pending）。
 *
 * 另一项注册（`msgNavMessages` 会话投影）仍是可选能力，走 `ctx.inject`：缺席时宿主
 * 半不贡献投放，浏览器侧回退到「活动窗口内提问」与默认对齐。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { msgNavProjectionDefinition } from './projection.ts'
import { registerSearchRoute } from './search.ts'
import { NavSettingsSchema, type NavSettings } from './settings.ts'
import { checkDshPolicy, dshCompatMessage, type DshCompatPolicy } from './compat.ts'

/** 插件 Config schema（0.1.7 起由加载器据此派生设置命名空间 / 表单 / 校验）。 */
export const Config = NavSettingsSchema

/** 本插件的自身配置形态（= 上述 schema 的解析结果）。 */
export type PluginConfig = NavSettings

/** Cordis plugin name. */
export const name = 'dsh-mega-chat-nav'

/**
 * 兼容策略：0.1.7-rc 与 0.2.0-rc **两条线**（数组 = 命中任一即通过）。
 *
 * 为什么是两条：本次「适配 0.2.0」**没有改动任何插件代码**（只升级了依赖线），
 * 而这份代码在 0.1.7-rc 与 0.2.0-rc 上都是验证过的（tsc + 172 例测试 + 运行时契约核对）。
 * 兼容性是代码的事实，不该随「发到哪条线」而改口。
 *
 * 注：这是**软提醒**（只打日志，不阻止加载）；能不能装由 peer 决定——本包 peer 只声明
 * 0.2.0-rc 线，故 0.1.7 线上不会真的加载到它。
 *
 * 不声明：0.1.5-rc 及更早（那条线是破坏性变更，ctx.settings.register 被移除）、
 * rc 之前的预发布（alpha/beta 统一不声明兼容，仍会打印提示，属设计）。
 */
const DSCH_COMPAT_POLICY: DshCompatPolicy = { op: '=', target: ['0.1.7-rc.*', '0.2.0-rc.*'] }

const dshRequire = createRequire(import.meta.url)

/** 探测当前 dsh 版本：优先 @deepseek-ai/dsh 本体，回退 lockstep 的 0.1.2 线包
 *  （dsh-client-store / dsh-client-ui-renderer，取代已停发的 dsh-client-runtime）。 */
function detectDshVersion(): string | null {
  for (const pkg of ['@deepseek-ai/dsh', 'dsh', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-renderer']) {
    try {
      const pkgJson = dshRequire.resolve(pkg + '/package.json')
      const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: string }
      if (typeof parsed.version === 'string' && parsed.version.length > 0) return parsed.version
    } catch {
      /* 尝试下一候选 */
    }
  }
  return null
}

/** mega 家族契约的「兼容性校验」开关字段（与 mega-settings 的全局开关同名同义）。 */
const COMPAT_CHECK_FIELD = 'compatCheck'

/**
 * mega 家族**公共配置文件**：`$DSH_HOME/mega.json`（无 DSH_HOME 时 `~/.dsh/mega.json`）。
 *
 * 为什么需要它：0.1.7 的配置按 profile 条目分开承载，用户想「一处关闭、全体 mega 插件
 * 静音」时没有任何公共落点（未装 mega-settings 时更是完全没有设置界面）。
 * 该文件是**家族约定**：每个成员插件在自身配置未显式设置 compatCheck 时读它。
 *
 * 与官方 `resolveDshHome` 同源解析，避免两处指向不同目录。
 */
export function megaFamilyConfigPath(): string {
  const home = process.env.DSH_HOME?.trim()
  const base = home !== undefined && home.length > 0
    ? home
    : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  return join(base, 'mega.json')
}

/**
 * 读家族公共配置里的 `compatCheck`。
 *
 * @param path - 配置文件路径（测试注入用）；省略时按 {@link megaFamilyConfigPath}
 * @returns 显式写下的布尔值；文件缺失 / JSON 损坏 / 字段非布尔 一律 undefined（交回缺省）
 */
export function readFamilyCompatCheck(path?: string): boolean | undefined {
  try {
    const file = path ?? megaFamilyConfigPath()
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const value = (parsed as Record<string, unknown>)[COMPAT_CHECK_FIELD]
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 解包 schemastery 的 `Volatile` 引用。
 *
 * 为什么需要：`Config` 上标了 `.volatile()` 的字段在 `apply` 里拿到的是**引用包装**
 * 而非普通值（整对象标 volatile 时，连 `config` 本身都是包装）——必须 `.get()` 才能
 * 读到真实数据。
 *
 * 判定方式：**鸭子类型**（对象且带 `get` 函数）。官方的 `isVolatile` 用的是
 * `Symbol(cosmokit.volatile.write)` 这个**符号键**（`Reflect.ownKeys` 可见），
 * 按字符串 `'write'` 判定会永远失败——那正是本函数最初写错的地方。
 *
 * @param value - 可能是引用包装的配置值
 * @returns 解包后的普通对象；拿不到对象时返回 undefined
 */
function unwrapVolatile(value: unknown): Record<string, unknown> | undefined {
  let current: unknown = value
  // 理论上只有一层包装，循环上限防御异常构造
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) break
    const get = (current as { get?: unknown }).get
    if (typeof get !== 'function') break
    current = (get as () => unknown).call(current)
  }
  return typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : undefined
}

/**
 * mega 家族契约：是否执行 dsh 版本兼容校验。
 *
 * mega 家族契约开关 `compatCheck`（缺省 true），约定**各 mega 插件自行读取**，
 * 关闭后插件启动时跳过版本校验与提醒。按优先级取第一个布尔值：
 *
 * 1. **自身配置**：`apply(ctx, config)` 的第二参——用户在 profile patch 里给本插件条目
 *    写的 `config.compatCheck`（0.1.7 的配置承载位置）；
 * 2. **家族公共配置**：`$DSH_HOME/mega.json` 的 `compatCheck`——**一处关闭、全体静音**
 *    （见 {@link readFamilyCompatCheck}）；这一层让「未装 mega-settings 时也能统一关闭」
 *    成立——那正是它存在的理由；
 * 3. 都读不到 → **缺省 true**：宁可多提醒，也不因读不到配置而漏掉不兼容警示。
 *
 * 两条旧通道在 0.1.7 均已不成立，故不再保留：
 * - `settings.yaml` 文件通道——该文档不再是配置中心（0.1.5-rc 线）；
 * - `settings.get('mega-settings')` 跨插件服务通道——0.1.7 的契约是各读自己的配置，
 *   且该调用还需本插件声明 `'settings'` 注入与 `dsh-settings` 类型增强，纯属历史包袱。
 *
 * @param config - 本插件自身配置（apply 第二参）
 * @param familyPath - 家族公共配置文件路径（测试注入用）
 * @returns true = 照常校验并提醒；false = 用户已关闭，跳过
 */
export function compatCheckEnabled(config?: unknown, familyPath?: string): boolean {
  const unwrapped = unwrapVolatile(config)
  const own = unwrapped?.[COMPAT_CHECK_FIELD]
  if (typeof own === 'boolean') return own
  return readFamilyCompatCheck(familyPath) ?? true
}

/**
 * 插件入口。
 *
 * @param ctx - 宿主插件上下文
 * @param config - 本插件自身配置（0.1.7：由导出的 `Config` schema 解析后经第二参注入）
 */
export function apply(ctx: Context, config?: PluginConfig): void {
  ctx.inject(['sessionProjections'], (inner) => {
    inner.sessionProjections.register(msgNavProjectionDefinition)
  })
  // dsh 版本兼容校验：检测失败或不合规只打印警示，不阻断插件加载。
  // 开关读自身 config.compatCheck（0.1.7 的承载位置）。
  try {
    if (compatCheckEnabled(config)) {
      const dshVer = detectDshVersion()
      if (dshVer !== null && !checkDshPolicy(dshVer, DSCH_COMPAT_POLICY)) {
        console.warn(dshCompatMessage(name, dshVer))
      }
    }
  } catch {
    /* 校验器自身异常不应影响插件 */
  }
  try {
    registerSearchRoute(ctx)
  } catch (e) {
    console.error('[dsh-mega-chat-nav] search route failed:', e)
  }
}