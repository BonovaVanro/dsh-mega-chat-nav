/**
 * Host half of the dsh-mega-chat-nav plugin — runs in the DSH host process.
 * Registers the `msgNavMessages` session projection unit (the ordered list
 * of user questions, each tagged with its turn) and the plugin's durable
 * settings namespace. Both registries are optional capabilities, so each
 * registration rides `ctx.inject`: without them the host half contributes
 * nothing and the browser strip falls back to live-window questions and
 * default rail alignment.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parse as parseYamlDocument } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import { msgNavProjectionDefinition } from './projection.ts'
import { registerSearchRoute } from './search.ts'
import { megaChatNavSettingsNamespace, NavSettingsSchema } from './settings.ts'
import { checkDshPolicy, dshCompatMessage, type DshCompatPolicy } from './compat.ts'

/** Cordis plugin name. */
export const name = 'dsh-mega-chat-nav'

/**
 * 兼容策略：0.1.5-rc 线（'= 0.1.5-rc.*'）。
 * - 布局契约：conversation 仍为 main 槽的 keyed 条目
 *   （DOM 为 [data-slot="main.conversation"]），导航条钉位依赖此契约；
 * - 0.1.5-rc 线是本分支对外承诺的唯一目标线；本分支的改动对它是纯增量，
 *   线上用户不必被迫升级；
 * - 其余版本线（含尚未发布的预发布线）不作兼容声明；适配事实见 CHANGELOG；
 * - 0.1.2 / 0.1.1 线分别由 0.1.2 / 0.1.1 分支负责。
 */
const DSCH_COMPAT_POLICY: DshCompatPolicy = { op: '=', target: '0.1.5-rc.*' }

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

/** mega-settings 的 namespace 与其「兼容性校验」开关字段（mega 家族契约）。 */
export const MEGA_SETTINGS_NS = 'mega-settings'
const COMPAT_CHECK_FIELD = 'compatCheck'

/** 读取 mega-settings 配置的最小面（仅为结构型约束，避免硬依赖其类型）。 */
interface SettingsReaderLike {
  get(ns: string): unknown
}

/**
 * 解析设置文档所在位置：`$DSH_HOME/settings.yaml`，无该环境变量时 `~/.dsh/settings.yaml`。
 *
 * 与官方文件 provider 同源：它按 `resolveDshHome()` + `settings.yaml` 定位，并 watch
 * 该文档、把外部编辑热发布——所以「用户直接编辑 YAML 关闭校验」本就是受支持的用法，
 * 我们读同一个文档才不会与其读写脱节。
 *
 * @returns 设置文档的绝对路径
 */
export function settingsDocumentPath(): string {
  const home = process.env.DSH_HOME?.trim()
  const base = home !== undefined && home.length > 0 ? home : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  return join(base, 'settings.yaml')
}

/**
 * 从设置文档里读 `compatCheck`（**文件兜底通道**）。
 *
 * 为什么需要它：宿主 settings 服务的 `get(ns)` 只认**已注册**的 namespace
 * （实现为 `registrations.get(ns)?.resolved`）。未安装 mega-settings 时该 namespace
 * 无人注册，服务侧读不到——可用户仍可能手写配置要求跳过校验。文档由官方 provider
 * 持有（含外部编辑热发布），因此这一层直接读文档即可，且与服务通道同源。
 *
 * @param path - 设置文档路径；省略时按 {@link settingsDocumentPath} 解析
 * @returns 文档中显式写下的布尔值；缺失/无法解析/任何异常一律 undefined（交回缺省）
 */
export function readCompatCheckFromFile(path?: string): boolean | undefined {
  try {
    const file = path ?? settingsDocumentPath()
    if (!existsSync(file)) return undefined
    const doc = parseYamlDocument(readFileSync(file, 'utf8')) as Record<string, unknown> | null
    const section = doc?.[MEGA_SETTINGS_NS]
    if (typeof section !== 'object' || section === null) return undefined
    const value = (section as Record<string, unknown>)[COMPAT_CHECK_FIELD]
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * mega 家族契约：是否执行 dsh 版本兼容校验。
 *
 * mega-settings 提供全局开关 `compatCheck`（缺省 true），约定**各 mega 插件自行读取**，
 * 关闭后插件启动时跳过版本校验与提醒。两条通道按序尝试：
 *
 * 1. **服务通道**：`settings.get('mega-settings')`——mega-settings 已加载时生效；
 * 2. **文件通道**：直接读设置文档——mega-settings 缺席时仍尊重用户手写的配置。
 *
 * 两条都读不到时按**缺省 true**：宁可多提醒，也不因读不到配置而漏掉不兼容警示。
 *
 * @param settings - 宿主 settings 服务；缺席时跳过服务通道
 * @param path - 设置文档路径（测试注入用）；省略时按环境解析
 * @returns true = 照常校验并提醒；false = 用户已关闭，跳过
 */
export function compatCheckEnabled(settings: SettingsReaderLike | undefined, path?: string): boolean {
  if (settings !== undefined) {
    try {
      const config = settings.get(MEGA_SETTINGS_NS) as Record<string, unknown> | undefined
      const value = config?.[COMPAT_CHECK_FIELD]
      if (typeof value === 'boolean') return value
    } catch {
      /* 服务通道不可用：转文件通道 */
    }
  }
  return readCompatCheckFromFile(path) ?? true
}

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (inner) => {
    inner.sessionProjections.register(msgNavProjectionDefinition)
  })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(megaChatNavSettingsNamespace, NavSettingsSchema)
    // dsh 版本兼容校验：检测失败或不合规只打印警示，不阻断插件加载。
    // 读 mega-settings 的 compatCheck 开关决定是否执行（mega 家族契约）。
    try {
      if (compatCheckEnabled(settingsCtx.settings as unknown as SettingsReaderLike)) {
        const dshVer = detectDshVersion()
        if (dshVer !== null && !checkDshPolicy(dshVer, DSCH_COMPAT_POLICY)) {
          console.warn(dshCompatMessage(name, dshVer))
        }
      }
    } catch {
      /* 校验器自身异常不应影响插件 */
    }
  })
  try {
    registerSearchRoute(ctx)
  } catch (e) {
    console.error('[dsh-mega-chat-nav] search route failed:', e)
  }
}