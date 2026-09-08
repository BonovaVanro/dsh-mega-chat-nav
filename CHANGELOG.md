# Changelog

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
