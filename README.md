# mega 导航

[English](https://github.com/BonovaVanro/dsh-mega-chat-nav/blob/main/README.en.md) · **中文**

DSH（DeepSeek Harness）的**会话提问导航条**：在会话一侧显示整场对话的提问导航，无论会话多长都不会触发历史加载，随时跳回任意一轮提问，并支持全文搜索包括未加载历史在内的所有内容。
属于 mega 系列家族成员之一，支持**四种视觉风格**（简约 / Codex / 蓝鲸 / 虎鲸），风格配置各自独立、可随时切换。

## 功能一览

- **零扩窗全量索引**：host 侧投影折叠整段会话日志为紧凑索引，进入会话零翻页、正文零驻留，绝不触发历史扩窗；
- **四种风格**：简约（圆点轨）/ Codex（刻度轨）/ 蓝鲸（用户消息面板）/ 虎鲸（复刻 dsh 原生回合导航刻度轨），风格可在导航条设置中随时切换，每种风格独立保存自己的配置；
- **跳转与跟随**：点击任意节点直达对应提问；当前阅读位置在导航条中实时高亮并自动居中跟随，点击跳转后仍继续跟随正文滚动；
- **翻页浏览**：节点栏条带高度可配（紧凑/标准/高），▲/▼ 或滚轮翻页浏览；
- **全文搜索（含未加载历史）**：host 侧路由读持久化日志，防抖 + 请求中断，命中词高亮，一次直达，不触发历史扩窗；
- **收藏筛选**：⭐ 只看已收藏提问，收藏数据按会话本地保存；
- **停靠与镜像**：导航条可停靠会话左侧/右侧并自动镜像，支持 0–32px 偏移微调；
- **显示模式**：轮次总数/搜索/设置/翻页标记均支持 常显 / 浮现（停留 1 秒）/ 隐藏 三态；
- **配置持久化**：嵌套 schema（通用 + 风格专属），写回持久化，刷新不丢；
- **国际化**：界面词条支持中文 / English，跟随 dsh 通用设置的语言偏好即时切换。

## 流程展示
<div align="center">
  <video autoplay loop muted playsinline src="https://github.com/user-attachments/assets/10a9c2bd-f772-4ea6-9285-b98b63403977"/>
  <br />
  <sub>视频 1 · 流程展示</sub>
</div>
<br />

## 界面预览

<img width="600" height="600" alt="总配置页-预览" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />

### 简约（Minimal）—— 圆点轨

每轮提问一个圆点，悬停弹出级联卡片（1/3/5 张可配）预览提问内容，点击直达；阅读位置圆点实心高亮、实时居中。

<div align="center">
  <img width="352" height="294" alt="简约风格-预览" src="https://github.com/user-attachments/assets/76a5986d-89b9-4853-817b-e82d7370b47d" />
  <br />
  <sub>图 1 · 简约风格</sub>
</div>

### Codex —— 刻度轨

时间线风格：一条引导线贯穿条带，每轮一个水平刻度；悬停刻度横向展开成波纹，阅读位置刻度常亮、柔和档常态跟随主题色。

<div align="center">
  <img width="354" height="232" alt="Codex风格-预览" src="https://github.com/user-attachments/assets/ee01d862-7d84-49ce-a02c-2db1d91597ec" />
  <br />
  <sub>图 2 · Codex风格</sub>
</div>

### 蓝鲸（Chat）—— 用户消息面板

常态一条窄轨（每轮行首短横把手），悬停展开成用户消息列表面板：面板内显示用户消息、当前行高亮、行首短横即跳转把手；支持收藏筛选与就地全文搜索。

<div align="center">
  <img width="211" height="210" alt="蓝鲸风格-预览" src="https://github.com/user-attachments/assets/105f5b1d-6a23-46cb-889f-66151d197d0b" />
  <br />
  <sub>图 3 · 蓝鲸风格</sub>
</div>

### 虎鲸（Harness）—— 复刻官方回合导航刻度轨

复刻 dsh 原生回合导航栏（TurnNavigator）的紧凑刻度轨形态，并叠加增强：每轮一个短横刻度、带内滚动 + 上下渐隐；悬停刻度波纹展开（本尊 + 邻居逐级衰减）、阅读位置常亮、跳转目标品牌脉冲；未加载的历史回合显示超短横线；支持柔和/深邃色调档。点击刻度直达对应回合提问（自动分页加载历史）。

<div align="center">
  <img width="357" height="312" alt="虎鲸风格-预览" src="https://github.com/user-attachments/assets/13182897-334a-4203-b797-0504effdcc47" />
  <br />
  <sub>图 4 · 虎鲸风格</sub>
</div>

### 搜索
<div align="center">
  <img width="258" height="275" alt="简约/Codex风格搜索-预览" src="https://github.com/user-attachments/assets/4e398477-b049-44e6-8bbb-931117a524db" />
  <br />
  <sub>图 5 · 简约/Codex风格搜索</sub>
</div>
<br />

<div align="center">
  <img width="208" height="133" alt="蓝鲸风格搜索-预览" src="https://github.com/user-attachments/assets/912ed1ff-df73-4afc-8ed0-9dc88f6b8665" />
  <br />
  <sub>图 6 · 蓝鲸风格搜索</sub>
</div>

### 设置

<div align="center">
  <img width="187" height="217" alt="简易设置-预览" src="https://github.com/user-attachments/assets/4bea5940-1eeb-4a9a-8aa7-e2e0a352aa3c" />
  <br />
  <sub>图 7 · 简易设置</sub>
</div>
<br />

<div align="center">
  <img width="600" height="600" alt="总配置页-预览" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />
  <br />
  <sub>图 8 · 总配置页</sub>
</div>

当页面宽度小于1024px时，导航栏轻量化为搜索功能，在正文左/右上角点击搜索按钮可呼出搜索抽屉
<div align="center">
  <img width="531" height="472" alt="搜索抽屉-预览" src="https://github.com/user-attachments/assets/c2f525bb-b56f-4c99-885b-1cec88decd82" />
  <br />
  <sub>图 9 · 搜索抽屉</sub>
</div>

## 安装

**已适配 dsh v0.1.5-rc.\***（锁定 0.1.5 rc 线）。提供 GitHub tag / npm / 本地包三种安装方式。

**GitHub tag**

```
dsh plugin --profile web add github:BonovaVanro/dsh-mega-chat-nav#v0.1.5-rc.1
```

**本地包**

```
dsh plugin --profile web add dsh-mega-chat-nav-0.1.5-rc.1.tgz
```

**npm**

```
dsh plugin --profile web add dsh-mega-chat-nav@0.1.5-rc.1
```

卸载：

```
dsh plugin --profile web remove dsh-mega-chat-nav
```

> 说明：插件分 host 与 client 两半。改动 host 侧需要重启 dsh web；纯界面（client）改动刷新页面即可生效。

## 快速上手

1. 在导航条设置中切换**风格**：简约 / Codex / 蓝鲸 / 虎鲸（各风格独立保存配置）；
2. **跳转**：点击导航条任意节点/把手/刻度直达对应提问，阅读位置自动高亮跟随；
3. **搜索**：点 🔍 全文搜索（含未加载历史），可按用户/助手/工具范围过滤；命中词高亮，点击直达；
4. **收藏**：点 ⭐ 只看已收藏提问（在悬停卡或消息面板行首切换收藏）；
5. **停靠侧**：设置中对齐左/右，随停靠侧自动镜像；
6. **收纳**：安装了 mega-settings 时，完整设置页自动收纳进其成员列表（名称 **mega 导航**）；未安装时提供自足完整设置页。

## 适用 dsh 版本与兼容性

- **已适配 dsh 版本：0.1.5-rc.\*（0.1.5 rc 线通配：rc.1 / rc.2 …；不含 alpha 线与正式版；0.1.2 线由 0.1.2 分支负责，0.1.1 维护线由 0.1.1 分支负责）**；
- 宿主启动会按版本策略自检（默认 `= 0.1.5-rc.*`）；检测到其他版本控制台会打印
  `dsh-mega-chat-nav 可能不适配 dsh <版本> 版本，请慎重使用`，插件仍可加载使用；
- 维护者可自行调整 `src/index.ts` 的 `DSCH_COMPAT_POLICY`（支持 > / < / = 与通配、数组）。

## 常见问题

**搜索没反应？** 搜索依赖 host 侧路由（webServer/sessions）。若部署环境缺少这些服务，搜索不可用，导航条的跳转等其余功能不受影响。

**助手消息的思考（think）内容能搜到吗？** 暂不参与搜索。
