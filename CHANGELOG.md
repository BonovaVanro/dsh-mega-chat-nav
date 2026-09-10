# Changelog

## 0.1.5-rc.1（适配 dsh v0.1.5-rc.\* · 0.1.5 rc 线）

[中文](#cn-v0.1.5-rc.1) | [English](#en-v0.1.5-rc.1)

作为 `0.1.5` 系列的首个候选版本，本版本汇总了自 `v0.1.2-rc.1` 以来的主要用户和开发者相关变更。

<h3 id="cn-v0.1.5-rc.1">新增功能</h3>

- 搜索跳转补分页加载提示：命中未加载历史时显示「正在加载较早记录以定位（第 N 页）」及加载点动画。移动端搜索抽屉此前只在桌面分支渲染提示、看不到任何进度，现与常态跳转一致（四风格统一）。

### 体验优化

- 跳转提示层级提升（`z-index` 30 → 70）：高于桌面搜索浮层（62），在搜索浮层内点击命中时提示不再被遮挡；仍低于移动抽屉（91，模态语义）。
- 虎鲸（Harness）刻度优化：刻度条 `3px → 2px`，刻度补 `role="button"`；移除刻度上的收藏星标（无样式残留一并清理），收藏仍可通过 ⭐ 筛选与悬停卡切换。

### 问题修复

- **修复导航条左右对齐失效**：dsh 0.1.5-rc.1 将 `conversation` 由独立 Slot 迁移为 `main` 的 keyed 条目，DOM 由 `[data-slot="conversation"] > div[data-phase]` 变为 `[data-slot="main"] → [data-slot="main.conversation"] → div[data-phase]`。钉位锚未跟进导致校准循环停在 missing、内联定位样式不再写入，右侧停靠回落到 CSS 默认 `left: 0`。现改为双契约选择器（新契约优先、旧契约回退），跳转提示的水平对齐基准同步复用该锚。

### 其他变更

- **适配目标**：dsh v0.1.2-rc.1 → **v0.1.5-rc.\***（0.1.5 rc 线），兼容策略锁定 `= 0.1.5-rc.*`（匹配 0.1.5 基线任意 rc 预发布：rc.1 / rc.2 …；不含 alpha 线与正式版；0.1.2 线由 0.1.2 分支负责，0.1.1 维护线由 0.1.1 分支负责）。
- **依赖基线**：peer 声明 0.1.5 rc 线（`>=0.1.5-rc.1 <0.1.5`）、dev 构建基线 `0.1.5-rc.1`；新增 `@deepseek-ai/dsh-llm`（投影首 token 推导）；移除未使用的 `dsh-tools` / `dsh-invariants` / `dsh-session`。
- **投影适配**：`assistant/chunk`（0.1.5 已移除）→ `assistant/attempt` + `assistantStreamFirstTokenTime(stream)`。
- **双半去重**：host 半与 client 半的 28 处同值定义（选项表 / 默认值 / 类型）抽取到 `src/shared/domain.ts` 共享（净减约 140 行），消除默认值漂移风险。
- **清理**：移除未使用词条（`settings.tab`、`config.bandHeight.desc`）、修正 `settings.plugins.tab` 注释笔误、清理早期移植残留的构建产物。

<h3 id="en-v0.1.5-rc.1">Features</h3>

- Search jumps now show paging progress: when a hit lives in unloaded history, a "Loading earlier records to locate (page N)" notice with animated dots appears. The mobile search drawer previously rendered notices only in the desktop branch and showed no progress at all — it now matches normal jumps (unified across all four styles).

### Improvements

- Jump-notice layering raised (`z-index` 30 → 70): above the desktop search popover (62) so it is never covered when jumping from within it; still below the mobile drawer (91, modal semantics).
- Harness tick polish: tick bar `3px → 2px` with `role="button"`; the favorited-tick star was removed (along with its leftover unstyled class) — favorites remain available via the ⭐ filter and the hover cards.

### Bug fixes

- **Fixed the nav rail's left/right alignment**: dsh 0.1.5-rc.1 migrated `conversation` from a standalone Slot into a keyed entry of `main`, changing the DOM from `[data-slot="conversation"] > div[data-phase]` to `[data-slot="main"] → [data-slot="main.conversation"] → div[data-phase]`. The pinning anchor did not follow, so the calibration loop stayed in `missing`, inline positioning styles were never written, and right docking fell back to the CSS default `left: 0`. It now uses a dual-contract selector (new contract first, old contract as fallback), and the jump-notice baseline reuses the same anchor.

### Other changes

- **Target**: dsh v0.1.2-rc.1 → **v0.1.5-rc.\*** (the 0.1.5 rc line), compatibility policy locked to `= 0.1.5-rc.*` (any rc prerelease of the 0.1.5 baseline: rc.1 / rc.2 …; excluding the alpha line and the final release; the 0.1.2 line lives on the 0.1.2 branch, the 0.1.1 maintenance line on the 0.1.1 branch).
- **Dependency baseline**: peer declares the 0.1.5 rc line (`>=0.1.5-rc.1 <0.1.5`), dev baseline `0.1.5-rc.1`; added `@deepseek-ai/dsh-llm` (projection first-token derivation); removed the unused `dsh-tools` / `dsh-invariants` / `dsh-session`.
- **Projection adaptation**: `assistant/chunk` (removed in 0.1.5) → `assistant/attempt` + `assistantStreamFirstTokenTime(stream)`.
- **De-duplication**: 28 identical definitions (option tables / defaults / types) shared by the host and client halves were extracted into `src/shared/domain.ts` (about 140 lines net removed), eliminating default-drift risk.
- **Cleanup**: removed unused locale entries (`settings.tab`, `config.bandHeight.desc`), fixed the `settings.plugins.tab` comment typo, and cleaned build artifacts left over from the earlier port.

## 0.1.2（0.1.2 分支 · 适配 dsh 0.1.1 之后的版本线）

- **适配目标**：dsh v0.1.1-rc.2 → v0.1.2-rc.1（**精确锁定 0.1.2-rc.1**；0.1.1 维护线由 0.1.1 分支负责，本次不含 0.1.3）。
- **包迁移**：`@deepseek-ai/dsh-client-runtime` 停发 → `@deepseek-ai/dsh-client-ui-renderer`；
  `dsh.client.inject` 同步替换；peer/dev 全升 `^0.1.2-rc.1`、cordis `^4.0.2`。
- **host**：版本探测回退 store/ui-renderer；兼容策略 `= 0.1.2-rc.1`（精确锁定）。
- **client**：类型增强迁移（ui-renderer/ui-settings）；`ClientContext` 改 cordis `Context` 别名；
  活窗口行读取改 uiConversation chat target（0.1.2 线 `SessionSnapshot.chat` 移除）；
  搜索读取改 `sessionQuery.observeSession`；`settings.plugins.tab` 用 `slots.inject` 等待官方声明；
  inject 补 `uiConversation`。
- **UI**：隐藏 dsh 官方原生回合导航条（TurnNavigator，语义类名不依赖 hash）。
- **feat**：新增**虎鲸（Harness）**风格——复刻官方回合导航刻度轨 + Codex 式增强
  （hover 波纹展开、current 常亮、跳转脉冲、收藏刻度星标、未加载历史超短横线、柔和/深邃色调）。
- **feat**：四风格统一——收藏无收藏提示（简约/Codex 带边框对齐、蓝鲸无边框）；
  codex 柔和档常态/current 刻度跟随主题色；搜索抽屉结果撑满。
- **fix**：导航 item 重复（chat 快照 nodes 与 legacy 双视图去重）；搜索命中行交叠（官方 button 高度覆盖）；
  三风格不渲染（useRailJump 调用位置 Hooks 规则）。
- **refactor**：tsconfig 开 `noUnusedLocals/Parameters`；抽公共组件 `RailActions` / `MobileDrawer` /
  `useRailJump`（client bundle 减约 14KB）。
- **docs**：README 中英文互跳改 GitHub 绝对路径；补虎鲸风格预览与预览图；声明已适配 dsh 0.1.2-rc.1。
