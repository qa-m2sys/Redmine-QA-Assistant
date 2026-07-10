# QA Assistant for Redmine

A lightweight helper that streamlines bug reporting on
`https://redmine.kernello.com`. It adds a floating panel that lets QA engineers
jump straight to a project's **New Bug** form, auto-fills a consistent bug
template (tracker, status, priority, assignee and description), and offers
handy copy/clear tools — all without touching Redmine's markup.

It ships in **two interchangeable forms** so you can use whichever fits your setup:

| Form | Location | Use it when |
|------|----------|-------------|
| **Chrome extension** (MV3) | [`chrome-extension/`](chrome-extension/) | You want an easily shareable, installable extension. |
| **Userscript** | [`qa-assistant.user.js`](qa-assistant.user.js) | You use Tampermonkey / Violentmonkey or another userscript manager. |

Both versions share the exact same features and UI.

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for a history of what changed in each version.

---

## Features

- **One-click project switch** — Jump to the New Bug form for Web, Backend, iOS,
  or Android. The correct Bug tracker form is requested server-side, avoiding
  Redmine's stuck "Loading…" spinner.
- **Auto-fill after navigation** — After switching projects, the bug template,
  tracker (Bug), status (New), priority (Normal), and the team assignee are
  filled in automatically once the form loads.
- **Fill Template** — Manually (re)apply the template to the current issue form
  at any time.
- **Editable description template** — Expand the *Description Template* section
  to edit your own template. **Save** stores it locally; **Reset** restores the
  shipped default. Your template is used for Fill, Copy and auto-fill.
- **Copy Description** — Copies the current template text to the clipboard.
- **Clear Form** — Clears the subject and description fields in one click.
- **Toast notifications** — Small confirmations for every action.
- **Floating, draggable panel** — Drag the panel anywhere on screen; its
  position is remembered.
- **Collapsible panel** — Collapse it to a compact bar. When dragged to the
  **left or right screen edge** the collapsed bar rotates into a vertical strip
  that hugs the edge (and the title flips to stay readable on the left edge);
  anywhere else it stays a horizontal bar.
- **Dock to edge** — From the collapsed bar, dock the panel into a small pill
  pinned to any screen edge. Drag the pill to reposition it; it snaps to the
  nearest edge and rotates to match (vertical on left/right, horizontal on
  top/bottom). Click the pill to restore the panel.
- **Persistent state** — Panel position, collapsed/docked state, dock position
  and your custom template all persist across page loads.
- **Scrollbar-aware placement** — The panel and pill stay fully on-screen and
  never slip underneath the browser's scrollbar.

---

## Keyboard shortcuts

Shortcuts use physical key codes, so they work regardless of OS or keyboard
layout (including the macOS Option key).

| Shortcut | Action |
|----------|--------|
| `Alt` + `1` | Switch to **Web** new-bug form |
| `Alt` + `2` | Switch to **Backend** new-bug form |
| `Alt` + `3` | Switch to **iOS** new-bug form |
| `Alt` + `4` | Switch to **Android** new-bug form |
| `Alt` + `F` | **Fill** the bug template into the current form |
| `Alt` + `C` | **Copy** the description template to the clipboard |
| `Alt` + `X` | **Clear** the form (subject + description) |
| `Alt` + `Q` | **Collapse / expand** the panel |

---

## Installation

### Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the [`chrome-extension/`](chrome-extension/) folder.

> Icons live in `chrome-extension/icons/`. To regenerate them from a source
> image, run `generate-icons.ps1` from the `chrome-extension` folder:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\generate-icons.ps1 -Source icons\your-logo.png
> ```

### Userscript

1. Install a userscript manager (e.g. Tampermonkey or Violentmonkey).
2. Open [`qa-assistant.user.js`](qa-assistant.user.js) and install it, or copy
   its contents into a new userscript.

---

## Notes

- The panel and shortcuts are only active on `https://redmine.kernello.com/*`.
- Keep the extension and userscript in sync when making changes — they share the
  same logic and styles.

---

## Author & contact

Created by **Muntanuz Zaman**.

Found a bug or have a suggestion for improvement? Please get in touch:

- **Email:** [muntanuz@m2sys.com](mailto:muntanuz@m2sys.com)
