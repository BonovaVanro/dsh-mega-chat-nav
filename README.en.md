# mega 导航

[简体中文](./README.md) · **English**

A **session question navigator** for DSH (DeepSeek Harness): show a navigation strip beside the conversation listing every question in the session. No matter how long the conversation grows, it never triggers history loading — jump back to any turn at any time, and full-text search covers even the not-yet-loaded history. It is part of the mega family and supports three visual styles, each with its own independent configuration.

## Highlights

- **Zero-expansion full-history index**: a host-side projection folds the whole session log into a compact index — enter a session with zero paging, no message body stays resident, and history window expansion is never triggered;
- **Three styles**: Minimal (dot rail) / Codex (tick rail) / Deepseek Chat (user-message panel), switchable any time from the nav settings, each style saving its own configuration;
- **Jump & follow**: click any node to jump straight to that question; the current reading position is highlighted in real time and auto-centered, and keeps following the conversation scroll after a jump;
- **Paging**: configurable band height (compact / standard / tall), browse with ▲/▼ or the wheel;
- **Full-text search (incl. unloaded history)**: a host-side route reads the persisted log, with debounce + request cancellation, highlighted hits, and one-click navigation without expanding history;
- **Favorite filter**: ⭐ to view only favorited questions (saved per session locally);
- **Docking & mirroring**: dock the strip to the left or right side of the session with automatic mirroring, plus a 0–32px offset;
- **Display modes**: turn count / search / settings / paging markers each support Always / Peek (1s hold) / Hidden;
- **Persistent config**: nested schema (general + per-style), written back persistently, survives refresh;
- **i18n**: UI strings in 中文 / English, following the dsh general language preference instantly.

## Walkthrough
<div align="center">
  <video autoplay loop muted playsinline src="https://github.com/user-attachments/assets/10a9c2bd-f772-4ea6-9285-b98b63403977"/>
  <br />
  <sub>Video 1 · Walkthrough</sub>
</div>
<br />

## Preview

<img width="1200" height="1200" alt="Settings page preview" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />

### Minimal — dot rail

One dot per question; hovering pops up a cascade card (configurable 1/3/5) previewing the question, click to jump; the reading-position dot is solid-highlighted and stays centered.

<div align="center">
  <img width="705" height="588" alt="Minimal style preview" src="https://github.com/user-attachments/assets/76a5986d-89b9-4853-817b-e82d7370b47d" />
  <br />
  <sub>Fig. 1 · Minimal</sub>
</div>

### Codex — tick rail

A timeline style: one guide line through the band, one horizontal tick per turn; hovering expands the tick into a ripple, and the reading-position tick stays lit.

<div align="center">
  <img width="708" height="465" alt="Codex style preview" src="https://github.com/user-attachments/assets/ee01d862-7d84-49ce-a02c-2db1d91597ec" />
  <br />
  <sub>Fig. 2 · Codex</sub>
</div>

### Deepseek Chat — user-message panel

Normally a narrow rail (a short dash handle at each turn's row start); hovering expands into a user-message list panel: shows each user message, highlights the current row, and the dash handle jumps; supports favorite filter and in-place full-text search.

<div align="center">
  <img width="423" height="420" alt="Deepseek Chat style preview" src="https://github.com/user-attachments/assets/105f5b1d-6a23-46cb-889f-66151d197d0b" />
  <br />
  <sub>Fig. 3 · Deepseek Chat</sub>
</div>

### Search
<div align="center">
  <img width="516" height="551" alt="Search in Minimal/Codex preview" src="https://github.com/user-attachments/assets/4e398477-b049-44e6-8bbb-931117a524db" />
  <br />
  <sub>Fig. 4 · Search in Minimal / Codex</sub>
</div>
<br />

<div align="center">
  <img width="417" height="267" alt="Search in Deepseek Chat preview" src="https://github.com/user-attachments/assets/912ed1ff-df73-4afc-8ed0-9dc88f6b8665" />
  <br />
  <sub>Fig. 5 · Search in Deepseek Chat</sub>
</div>

### Settings

<div align="center">
  <img width="374" height="435" alt="Quick settings preview" src="https://github.com/user-attachments/assets/4bea5940-1eeb-4a9a-8aa7-e2e0a352aa3c" />
  <br />
  <sub>Fig. 6 · Quick settings</sub>
</div>
<br />

<div align="center">
  <img width="1200" height="1200" alt="Settings page preview" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />
  <br />
  <sub>Fig. 7 · Full settings page</sub>
</div>

On screens narrower than 1024px, the nav strip is lightened to a search-only affordance: click the search button at the top-left/right corner of the conversation to open the search drawer.
<div align="center">
  <img width="1062" height="945" alt="Search drawer preview" src="https://github.com/user-attachments/assets/c2f525bb-b56f-4c99-885b-1cec88decd82" />
  <br />
  <sub>Fig. 8 · Search drawer</sub>
</div>

## Installation

Requires dsh v0.1.1-* . Available via GitHub tag / npm / local package.

**GitHub tag**

```
dsh plugin --profile web add github:BonovaVanro/dsh-mega-chat-nav#v0.1.1
```

**Local package**

```
dsh plugin --profile web add dsh-mega-chat-nav-0.1.1.tgz
```

**npm**

```
dsh plugin --profile web add dsh-mega-chat-nav@0.1.1
```

Uninstall:

```
dsh plugin --profile web remove dsh-mega-chat-nav
```

> Note: the plugin has a host half and a client half. Host-half changes require restarting dsh web; client-only changes take effect after a page refresh.

## Quick start

1. Switch the **style** in the nav settings: Minimal / Codex / Deepseek Chat (each keeps its own config);
2. **Jump**: click any node/dash handle to jump to that question; the reading position auto-highlights and follows;
3. **Search**: click 🔍 for full-text search (incl. unloaded history), filterable by user / assistant / tool scopes; hits are highlighted, click to go;
4. **Favorites**: click ⭐ to show only favorited questions (toggle favorites on hover cards or message-panel row heads);
5. **Dock side**: set Left/Right in settings, auto-mirrored;
6. **Hosting**: when mega-settings is installed, the full settings page is collected into its member list (name **mega 导航**); otherwise a standalone full settings page is provided.

## Supported dsh versions & compatibility

- **Supported dsh versions: 0.1.1-rc.1, 0.1.1-rc.2**;
- The host checks the version policy on startup (default `= 0.1.1-*`, the whole 0.1.1 pre-release line); other versions print
  `dsh-mega-chat-nav may not be compatible with dsh <version>, use with caution` in the console, but the plugin still loads;
- Maintainers can adjust `DSCH_COMPAT_POLICY` in `src/index.ts` (supports > / < / =, wildcards and arrays).

## FAQ

**Search does nothing?** Search relies on host-side routes (webServer/sessions). If those services are missing in the deployment, search is unavailable while navigation and other features keep working.

**Can assistant thinking (think) content be searched?** Not currently — think content is excluded from search.
