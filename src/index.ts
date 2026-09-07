/**
 * Host half of the dsh-mega-chat-nav plugin — runs in the DSH host process.
 * Registers the `msgNavMessages` session projection unit (the ordered list
 * of user questions, each tagged with its turn) and the plugin's durable
 * settings namespace. Both registries are optional capabilities, so each
 * registration rides `ctx.inject`: without them the host half contributes
 * nothing and the browser strip falls back to live-window questions and
 * default rail alignment.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { msgNavProjectionDefinition } from './projection.ts'
import { registerSearchRoute } from './search.ts'
import { megaChatNavSettingsNamespace, NavSettingsSchema } from './settings.ts'
import { checkDshPolicy, dshCompatMessage, type DshCompatPolicy } from './compat.ts'

/** Cordis plugin name. */
export const name = 'dsh-mega-chat-nav'

/**
 * 兼容策略（按需修改）：
 * - '= 0.1.1-*' = 支持 dsh-v0.1.1 整条预发布线（0.1.1-rc.1 / rc.2）；
 * - target 支持数组：命中任一即通过，如 ['0.1.1', '0.1.2-rc.1']；
 * - 关系约束示例：{ op: '>=', target: '0.1.1-rc.2' }。
 */
const DSCH_COMPAT_POLICY: DshCompatPolicy = { op: '=', target: '0.1.1-*' }

const dshRequire = createRequire(import.meta.url)

/** 探测当前 dsh 版本：@deepseek-ai/dsh 本体 → dsh → dsh-client-runtime（与 tag 线 lockstep） */
function detectDshVersion(): string | null {
  for (const pkg of ['@deepseek-ai/dsh', 'dsh', '@deepseek-ai/dsh-client-runtime']) {
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

export function apply(ctx: Context): void {
  // dsh 版本兼容校验：检测失败或不合规只打印警示，不阻断插件加载
  try {
    const dshVer = detectDshVersion()
    if (dshVer !== null && !checkDshPolicy(dshVer, DSCH_COMPAT_POLICY)) {
      console.warn(dshCompatMessage(name, dshVer))
    }
  } catch {
    /* 校验器自身异常不应影响插件 */
  }
  ctx.inject(['sessionProjections'], (inner) => {
    inner.sessionProjections.register(msgNavProjectionDefinition)
  })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(megaChatNavSettingsNamespace, NavSettingsSchema)
  })
  try {
    registerSearchRoute(ctx)
  } catch (e) {
    console.error('[dsh-mega-chat-nav] search route failed:', e)
  }
}