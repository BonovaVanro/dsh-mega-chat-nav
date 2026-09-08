# mega 导航

[简体中文](https://github.com/BonovaVanro/dsh-mega-chat-nav/blob/main/README.md) · **English**

A **session question navigator** for DSH (DeepSeek Harness): show a navigation strip beside the conversation listing every question in the session. No matter how long the conversation grows, it never triggers history loading — jump back to any turn at any time, and full-text search covers even the not-yet-loaded history. It is part of the mega family and supports **four visual styles** (Minimal / Codex / Chat / Harness), each with its own independent configuration.

## Highlights

- **Zero-expansion full-history index**: a host-side projection folds the whole session log into a compact index — enter a session with zero paging, no message body stays resident, and history window expansion is never triggered;
- **Four styles**: Minimal (dot rail) / Codex (tick rail) / Chat (user-message panel) / Harness (a replica of the dsh native turn-navigation tick rail), switchable any time from the nav settings, each style saving its own configuration;
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

<img width="600" height="600" alt="Settings page preview" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />

### Minimal — dot rail

One dot per question; hovering pops up a cascade card (configurable 1/3/5) previewing the question, click to jump; the reading-position dot is solid-highlighted and stays centered.

<div align="center">
  <img width="352" height="294" alt="Minimal style preview" src="https://github.com/user-attachments/assets/76a5986d-89b9-4853-817b-e82d7370b47d" />
  <br />
  <sub>Fig. 1 · Minimal</sub>
</div>

### Codex — tick rail

A timeline style: one guide line through the band, one horizontal tick per turn; hovering expands the tick into a ripple, and the reading-position tick stays lit (soft tone follows the theme color).

<div align="center">
  <img width="354" height="232" alt="Codex style preview" src="https://github.com/user-attachments/assets/ee01d862-7d84-49ce-a02c-2db1d91597ec" />
  <br />
  <sub>Fig. 2 · Codex</sub>
</div>

### Chat — user-message panel

Normally a narrow rail (a short dash handle at each turn's row start); hovering expands into a user-message list panel: shows each user message, highlights the current row, and the dash handle jumps; supports favorite filter and in-place full-text search.

<div align="center">
  <img width="211" height="210" alt="Chat style preview" src="https://github.com/user-attachments/assets/105f5b1d-6a23-46cb-889f-66151d197d0b" />
  <br />
  <sub>Fig. 3 · Chat</sub>
</div>

### Harness — replica of the native turn-navigation tick rail

A faithful replica of the dsh native turn navigator (TurnNavigator) with enhancements: a compact tick rail with in-band scrolling and top/bottom fade; hovering ripples the ticks outward (self + neighbors decay by tier), the reading position stays lit, jump targets pulse in the brand color, and favorited turns get a star on their tick; not-yet-loaded history turns show as extra-short ticks; soft/deep tone tiers supported. Click a tick to jump straight to that turn (history pages in automatically).

<div align="center">
  <img width="357" height="312" alt="Harness style preview" src="https://github.com/user-attachments/assets/13182897-334a-4203-b797-0504effdcc47" />
  <br />
  <sub>Fig. 4 · Harness</sub>
</div>

### Search
<div align="center">
  <img width="258" height="275" alt="Search in Minimal/Codex preview" src="https://github.com/user-attachments/assets/4e398477-b049-44e6-8bbb-931117a524db" />
  <br />
  <sub>Fig. 4 · Search in Minimal / Codex</sub>
</div>
<br />

<div align="center">
  <img width="208" height="133" alt="Search in Chat preview" src="https://github.com/user-attachments/assets/912ed1ff-df73-4afc-8ed0-9dc88f6b8665" />
  <br />
  <sub>Fig. 6 · Search in Chat</sub>
</div>

### Settings

<div align="center">
  <img width="187" height="217" alt="Quick settings preview" src="https://github.com/user-attachments/assets/4bea5940-1eeb-4a9a-8aa7-e2e0a352aa3c" />
  <br />
  <sub>Fig. 7 · Quick settings</sub>
</div>
<br />

<div align="center">
  <img width="600" height="600" alt="Settings page preview" src="https://github.com/user-attachments/assets/b08d5bff-2d7f-4dfa-8ce2-4ba1b5c1891f" />
  <br />
  <sub>Fig. 8 · Full settings page</sub>
</div>

On screens narrower than 1024px, the nav strip is lightened to a search-only affordance: click the search button at the top-left/right corner of the conversation to open the search drawer.
<div align="center">
  <img width="531" height="472" alt="Search drawer preview" src="https://github.com/user-attachments/assets/c2f525bb-b56f-4c99-885b-1cec88decd82" />
  <br />
  <sub>Fig. 9 · Search drawer</sub>
</div>

## Installation

**Adapted for dsh v0.1.2-rc.1** (exact lock). Available via GitHub tag / npm / local package.

**GitHub tag**

```
dsh plugin --profile web add github:BonovaVanro/dsh-mega-chat-nav#v0.1.2
```

**Local package**

```
dsh plugin --profile web add dsh-mega-chat-nav-0.1.2.tgz
```

**npm**

```
dsh plugin --profile web add dsh-mega-chat-nav@0.1.2
```

Uninstall:

```
dsh plugin --profile web remove dsh-mega-chat-nav
```

> Note: the plugin has a host half and a client half. Host-half changes require restarting dsh web; client-only changes take effect after a page refresh.

## Quick start

1. Switch the **style** in the nav settings: Minimal / Codex / Chat / Harness (each keeps its own config);
2. **Jump**: click any node / dash handle / tick to jump to that question; the reading position auto-highlights and follows;
3. **Search**: click 🔍 for full-text search (incl. unloaded history), filterable by user / assistant / tool scopes; hits are highlighted, click to go;
4. **Favorites**: click ⭐ to show only favorited questions (toggle on hover cards, message-panel row heads, or Harness tick stars);
5. **Dock side**: set Left/Right in settings, auto-mirrored;
6. **Hosting**: when mega-settings is installed, the full settings page is collected into its member list (name **mega 导航**); otherwise a standalone full settings page is provided.

## Supported dsh versions & compatibility

- **Adapted for dsh v0.1.2-rc.1 (exact lock; the 0.1.1 maintenance line lives on the 0.1.1 branch)**;
- The host checks the version policy on startup (default `= 0.1.2-rc.1`); other versions print
  `dsh-mega-chat-nav may not be compatible with dsh <version>, use with caution` in the console, but the plugin still loads;
- Maintainers can adjust `DSCH_COMPAT_POLICY` in `src/index.ts` (supports > / < / =, wildcards and arrays).

## FAQ

**Search does nothing?** Search relies on host-side routes (webServer/sessions). If those services are missing in the deployment, search is unavailable while navigation and other features keep working.

**Can assistant thinking (think) content be searched?** Not currently — think content is excluded from search.
