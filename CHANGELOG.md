# Changelog

## 0.1.5-rc.2-update.2（适配 dsh v0.1.6-alpha.2）

[中文](#cn-v0.1.5-rc.2-update.2) | [English](#en-v0.1.5-rc.2-update.2)

官方在 **0.1.6-alpha.2** 里移除了 `SessionListState.current`，导航条一直用它取「当前是哪个会话」，因此在 0.1.6-alpha.2 上整个不再显示。本版本改按官方对外提供的写法取值，在 0.1.5-rc 与 0.1.6-alpha.2 上行为一致、共用同一份安装包。

<h3 id="cn-v0.1.5-rc.2-update.2">问题修复</h3>

- **dsh 0.1.6-alpha.2 上导航条整个不显示**：插件原本从会话列表快照的 `SessionListState.current` 读当前会话，官方在 0.1.6-alpha.2 里把它移除了（连同 `currentAddress`），插件读不到会话就什么都不画。现改用官方对外提供的 `sessionId`——会话作用域槽位由框架注入，官方自带的回合导航轨也用它。

<h3 id="cn-v0.1.5-rc.2-update.2">对 0.1.5-rc.2 的影响</h3>

- 新写法在 0.1.5-rc 上同样成立（该接口两版一致），因此**直接迁移自 0.1.5 线**，无需为 0.1.6-alpha.2 单独出包；上面这个问题也只发生在 0.1.6-alpha.2 上。
- 导航条的数据、跳转、搜索等逻辑均未改动，**0.1.5-rc.2 功能与上一版一致**。

<h3 id="cn-v0.1.5-rc.2-update.2">兼容性校验开关</h3>

- 按 mega 家族约定支持 mega 设置页的「mega 系插件兼容性校验」开关：关闭后本插件启动时不再校验 dsh 版本、也不再打印提醒。
- **未安装 mega-settings 时同样有效**：此时改为直接读设置文档的 `mega-settings.compatCheck`，你手写的配置一样会被尊重。
- 两处都读不到时按缺省**照常校验**——宁可多提醒一次，也不因读不到配置而漏掉不兼容警示。

<h3 id="cn-v0.1.5-rc.2-update.2">导航条高亮修正</h3>

- **导航条没有任何节点被高亮**：当前内容窗口里只剩助手回复与插入消息（提问已滚出上方）时，导航条整条不亮。现在会按「读到第几轮」落到对应节点，不再无高亮。
- **插入消息命中却不亮**：同回合里运行中追加的那条插入消息，被判定为命中时却仍无节点高亮——现在会点亮**它所属回合**的节点（点击仍定位到该回合首条提问，与之前一致）。

dsh **0.1.6-alpha.2** removed `SessionListState.current`, which the rail had been using to find the current session, so the rail stopped appearing on 0.1.6-alpha.2 altogether. This release reads the session the way dsh officially provides it, behaves identically on the 0.1.5-rc line and 0.1.6-alpha.2, and ships as a single build.

<h3 id="cn-v0.1.5-rc.2-update.2">体验优化</h3>

- **刷新时导航条先闪到页面最左**：导航条位置由布局校准算出，首帧校准未完成时它按初始位置画在了页面最左边。现在位置算出前不绘制，就位后再淡入；刷新、切换会话、调整对齐或偏移都不再出现这一跳。

<h3 id="en-v0.1.5-rc.2-update.2">Bug fixes</h3>

- **The rail disappeared entirely on dsh 0.1.6-alpha.2**: the plugin used to read the current session from the session-list snapshot's `SessionListState.current`. dsh 0.1.6-alpha.2 removed that field (along with `currentAddress`), so with no session to read the rail drew nothing. It now uses the officially provided `sessionId` — injected by the framework into session-scoped slots, the same one the built-in turn navigator uses.

<h3 id="en-v0.1.5-rc.2-update.2">Impact on 0.1.5-rc.2</h3>

- The new way works on 0.1.5-rc as well (the interface is the same on both versions), so it was **migrated straight from the 0.1.5 line** with no separate build for 0.1.6-alpha.2; the problem above only occurs on 0.1.6-alpha.2.
- The rail's data, jumping and search logic are untouched, so **0.1.5-rc.2 behaves exactly as in the previous version**.

<h3 id="en-v0.1.5-rc.2-update.2">Compatibility check switch</h3>

- The plugin now honours the mega settings page switch "mega-family compatibility check" as the family convention requires: with the switch off it skips the dsh version check and its console notice at startup.
- **It works without mega-settings installed too**: the value is then read straight from the settings document's `mega-settings.compatCheck`, so a hand-written configuration is respected as well.
- When neither source is readable the check still runs by default — a redundant notice is preferable to a missed incompatibility warning.

<h3 id="en-v0.1.5-rc.2-update.2">Rail highlight fixes</h3>

- **No node was highlighted at all**: when the current window held only an assistant reply and the inserted message (the question had scrolled above), the whole rail stayed dark. It now falls back to the turn being read and lights that node.
- **A hit on the inserted message did not light up**: the extra message admitted into a running turn was recognised as the reading position yet no node lit. It now lights the node of **its own turn** (clicking still goes to that turn's first question, as before).

<h3 id="en-v0.1.5-rc.2-update.2">Improvements</h3>

- **The rail flashed at the far left on refresh**: its position is computed by the layout calibration, and until that finished it was drawn at its initial position — the left edge of the page. It is now left undrawn until the position is known and fades in once placed; refresh, session switches and alignment/offset changes no longer show the jump.

## 0.1.5-rc.2-update.1（长会话跳转 + 虎鲸刻度）

[中文](#cn-v0.1.5-rc.2-update.1) | [English](#en-v0.1.5-rc.2-update.1)

本版本修复**长会话里往前跳转**的老问题——加载很久还提示超时、跳过去不到位；同时修正虎鲸（Harness）风格刻度的未加载显示。

<h3 id="cn-v0.1.5-rc.2-update.1">问题修复</h3>

- **跳转会超时**：长会话往前跳几十轮时，历史要一页页拉，中途还老提示「加载历史超时」。现在加载快得多（一次拉的量是原来的 4 倍），只要还在往目标推进就不会被判超时，提示也不会中途消失；如果正文自己正在加载，跳转会接上去而不是干等。
- **跳过去没到位**：有时往上跳一点就停住、或先冲过一屏再退回。现在会一直平滑地滚到目标行，长距离也不会先跳一下再补动画；落位后会确认真的停稳，没停稳就校正——落位过程不再出现忽上忽下。
- **动画设置无效**：设置里选「平滑」以前经常没效果（直接瞬移）。现在按设置生效：平滑就是一路滚过去，瞬时就是直接到位。
- **失败提示全是「超时」**：不管是没找到、还是视图不可用，以前一律显示「加载历史超时」。现在各自显示对应原因；已经落到邻近内容时算跳转成功，不再报错。
- **虎鲸刻度把没加载的轮次画成已加载**：包括末尾那个还没加载的轮次，以及「只加载了一半」（正文进来了、你的提问还在更早历史里）的轮次。现在只有该轮提问真的在当前内容里，才显示为已加载。
- **虎鲸刻度未加载的短横线长度不对**：悬停时不会变长，被旁边刻度带动时也不会跟着收窄，看起来比旁边的横线短一截，甚至出现「悬停的这条比下一条还短」。现在长度按比例变化，悬停时始终是最长的那条。

新增 36 条自动化测试，全量 108 条通过。

<h3 id="cn-v0.1.5-rc.2-update.1">体验优化</h3>

- 往前跳转时的中间滚动更快、等待更少。
- 加载提示简化为「加载中…」，不再显示一个不会变化的页码。
- 跳转目标的闪烁提示每次跳转只出现一次，不会在滚动过程中反复闪。

<h3 id="en-v0.1.5-rc.2-update.1">Bug fixes</h3>

This release fixes long-standing problems with **jumping backwards in long sessions** — loading that ended in a timeout, and jumps that fell short — and corrects how the Harness style shows unloaded turns.

- **Jumps timed out**: jumping dozens of turns back paged history one small chunk at a time and often ended in a "loading history timed out" message. Loading is now much faster (each step pulls 4× as much), a jump is no longer declared timed out while it is still making progress, the notice no longer disappears mid-load, and a jump now joins an in-flight load instead of waiting for it.
- **Jumps fell short or overshot**: the view sometimes stopped just above the target, or flew past and snapped back. It now scrolls smoothly all the way to the target — long distances included, with no jump-then-correct — and confirms it actually settled, correcting itself if not.
- **The animation setting did nothing**: choosing "smooth" often behaved like an instant jump. The setting now applies: smooth scrolls there, instant jumps there.
- **Every failure said "timed out"**: missing targets and inactive views all reported a timeout. Each failure now reports its own reason, and landing on nearby content counts as success instead of an error.
- **Harness rail marked unloaded turns as loaded**: this covered both the last not-yet-loaded turn and "half-loaded" turns whose answer had arrived while the question was still in earlier history. A turn now counts as loaded only when its question is really in the current content.
- **Harness unloaded ticks had the wrong length**: they did not grow on hover and did not shrink with their neighbours, so they looked shorter than the lines beside them — a hovered one could even end up shorter than the next one. Lengths now scale proportionally, and the hovered tick is always the longest.

36 new automated tests; all 108 pass.

<h3 id="en-v0.1.5-rc.2-update.1">Improvements</h3>

- Intermediate scrolling while jumping back is faster, with less waiting.
- The loading notice is simply "Loading…" — no page number that never changes.
- The confirmation flash on the target appears once per jump instead of repeating during the scroll.

## 0.1.5-rc.2（适配 dsh v0.1.5-rc.\*）

[中文](#cn-v0.1.5-rc.2) | [English](#en-v0.1.5-rc.2)

官方 `0.1.5-rc.1` → `0.1.5-rc.2` 为**整线版本重发**（编译产物、类型与入口零变化，仅依赖声明版本号升级），插件代码无需适配改动；本版本同时修复虎鲸风格的悬停提示问题。

<h3 id="cn-v0.1.5-rc.2">问题修复</h3>

- **虎鲸风格悬停时出现原生浏览器提示**：刻度按钮带有原生 HTML `title` 属性，悬停时浏览器会额外渲染一个原生 tooltip，与插件自身的悬停预览卡片内容重复、样式突兀；现移除该属性（`aria-label` 保留，无障碍能力不受影响）。其余三种风格无此问题。

### 其他变更

- **适配目标**：dsh v0.1.5-rc.\*（0.1.5 rc 线：rc.1 / rc.2 …）；dev 构建基线 6 个官方包同步升级至 `0.1.5-rc.2`（peer 范围 `>=0.1.5-rc.1 <0.1.5` 与兼容策略 `= 0.1.5-rc.*` 同时覆盖 rc.1 / rc.2，未收窄）。
- **验证**：完整构建 + 72 用例测试全过（rc.2 依赖下）。

<h3 id="en-v0.1.5-rc.2">Bug fixes</h3>

- **Native browser tooltip appeared when hovering the Harness style**: the tick buttons carried a native HTML `title` attribute, so the browser rendered an extra native tooltip on top of the plugin's own hover preview card — duplicate content with jarring styling. The attribute is now removed (`aria-label` is kept, so accessibility is unaffected). The other three styles were never affected.

### Other changes

- **Target**: dsh v0.1.5-rc.\* (the 0.1.5 rc line: rc.1 / rc.2 …); the 6 official dev dependencies moved to `0.1.5-rc.2` (the peer range `>=0.1.5-rc.1 <0.1.5` and the compat policy `= 0.1.5-rc.*` still cover both rc.1 and rc.2, and were not narrowed).
- **Verification**: full build + all 72 tests pass against rc.2.

## 0.1.5-rc.1-fix.1（修复版 · 适配 dsh v0.1.5-rc.\*）

[中文](#cn-v0.1.5-rc.1-fix.1) | [English](#en-v0.1.5-rc.1-fix.1)

本版本修复两处**既有问题**（自功能实现以来即存在，并非 `0.1.5-rc.1` 引入）：搜索「内容范围」设置不生效、贴底跳转定位失败。

<h3 id="cn-v0.1.5-rc.1-fix.1">问题修复</h3>

- **搜索「内容范围」失效**：检索缓存键未包含内容范围，改动勾选后对同一关键词的检索会命中旧范围的缓存（表现为「去掉了助手勾选仍能搜到助手」）；缓存键补入 scopes（排序入键，集合相同共享缓存）。
- **注入内容被当作「用户」范围**：`plugin` / `agent-instructions` / `skill-catalog` 等来源的消息与压缩替换副本不再参与搜索（按 append 语义 + `source.kind` 严格判定）。
- **贴底跳转定位失败**：平滑滚动期间官方「回到底部」跟随会把滚动拉回底部，离底部近的轮次（如倒数第五轮）因此失败；现于平滑模式且当前贴底时首帧上移 2px 脱离该判定。

### 体验优化

- 助手消息仅索引**前 400 字**，超长回复的后段不参与搜索；提问侧不截断。
- 前端渲染前按当前勾选再过滤一层：任何越界命中（陈旧响应、缓存意外）都不会显示。

### 其他变更

- **测试**：新增 `tests/search.spec.ts`（13 用例：范围过滤 / 400 字边界 / 缓存键 / 前端过滤）。
- **文档**：README 中英 FAQ 补 400 字索引说明。

<h3 id="en-v0.1.5-rc.1-fix.1">Bug fixes</h3>

This release fixes two **long-standing issues** that have existed since the features were first implemented (not introduced in `0.1.5-rc.1`): the search content-scope setting having no effect, and jumps failing when the view is docked at the bottom.

- **Search scope had no effect**: the search cache key did not include the content scopes, so re-searching the same keyword after changing the selection returned results filtered by the old scopes (assistant hits still appeared after unchecking it). The cache key now includes the scopes.
- **Injected content was indexed as "user"**: messages from `plugin` / `agent-instructions` / `skill-catalog` sources and compaction copies no longer take part in search (strict append semantics + `source.kind` check).
- **Jumps failed near the bottom**: the official "back to bottom" follow pulled the smooth scroll back down, breaking jumps to turns close to the bottom; the rail now nudges 2px away from the bottom on the first frame when docked there.

### Improvements

- Assistant messages are indexed up to the first **400 characters** only; user messages are not truncated.
- The client filters hits by the current selection before rendering, so out-of-scope hits are never shown.

### Other changes

- **Tests**: added `tests/search.spec.ts` (13 cases: scope filtering / 400-char boundary / cache key / client-side filtering).
- **Docs**: FAQ entries about the 400-character index limit (zh/en).

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
