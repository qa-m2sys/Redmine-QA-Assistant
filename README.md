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

- **Report under any tracker** — From the *Report an Issue* section, first pick a
  tracker (Bug, Feature, Task, User story, Test case, or Suggestion), then pick a
  project (Web, Backend, iOS, or Android). Redmine opens the New issue form in a
  new tab for that **tracker and project**, requested server-side to avoid the
  stuck "Loading…" spinner. Your last-used tracker is remembered.
- **Agile boards** — Open any project's agile board (Web, Backend, iOS, Android)
  in a new tab from the *Agile Boards* section, so your current page and panel
  stay put. Each button opens that project's **current sprint** board, and if
  you navigate to a different board it remembers and reopens your last-viewed one.
- **Auto-fill after navigation** — After opening a New issue, the template, the
  selected tracker, status (New), priority (Normal), and the team assignee for
  that project are filled in automatically once the form loads.
- **Fill Template** — Manually (re)apply the template to the current issue form
  at any time.
- **Editable description template** — Expand the *Step 3 · Description source*
  section (placed right below the project picker) to edit your own template.
  **Save** stores it locally; **Reset** restores the shipped default. Your
  template is used for Fill, Copy and auto-fill.
- **AI report assistant** — Use the segmented **Template / AI** toggle to
  switch to **AI** mode and chat with OpenAI, turning rough notes into a
  structured report. The assistant **adapts to the selected tracker** — Bug,
  Feature, Task, User story, Test case or Suggestion — using the right title
  wording and description structure for each (e.g. acceptance criteria for user
  stories, test steps for test cases).
  It's a **multi-turn chat** (refine the result with follow-ups), returns an
  editable **Subject** and **Description** for review, and fills both into the
  Redmine form on demand. Includes a **model selector** (`gpt-4o` by default,
  plus `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4-turbo`). You supply your
  own OpenAI API key, stored locally in the browser.
- **Copy Description** — Copies the current template text to the clipboard.
- **Clear Form** — Clears the subject and description fields in one click.
- **Toast notifications** — Small confirmations for every action.
- **Floating, draggable panel** — Drag the panel anywhere on screen; its
  position is remembered.
- **Resizable panel** — Drag any edge or corner of the panel to freely adjust its
  width and height. The contents reflow to fit, the default size is the minimum,
  and your chosen size persists across page loads.
- **Collapsible panel** — Collapse it to a compact bar. When dragged to the
  **left or right screen edge** the collapsed bar rotates into a vertical strip
  that hugs the edge (and the title flips to stay readable on the left edge);
  anywhere else it stays a horizontal bar.
- **Dock to edge** — From the collapsed bar, dock the panel into a small pill
  pinned to any screen edge. Drag the pill to reposition it; it snaps to the
  nearest edge and rotates to match (vertical on left/right, horizontal on
  top/bottom). Click the pill to restore the panel.
- **Dark mode** — toggle a dark theme from the 🌙 button in the panel header. Your
  choice is remembered and, by default, follows your operating system's
  light/dark preference.
- **Persistent state** — Panel position, size, collapsed/docked state, dock
  position, theme, and your custom template all persist across page loads.
- **Scrollbar-aware placement** — The panel and pill stay fully on-screen and
  never slip underneath the browser's scrollbar.

---

## Keyboard shortcuts

Shortcuts use physical key codes, so they work regardless of OS or keyboard
layout (including the macOS Option key).

| Shortcut | Action |
|----------|--------|
| `Alt` + `1` | Open the **Web** new-issue form (selected tracker) |
| `Alt` + `2` | Open the **Backend** new-issue form (selected tracker) |
| `Alt` + `3` | Open the **iOS** new-issue form (selected tracker) |
| `Alt` + `4` | Open the **Android** new-issue form (selected tracker) |
| `Alt` + `Shift` + `1` | Open the **Web** agile board |
| `Alt` + `Shift` + `2` | Open the **Backend** agile board |
| `Alt` + `Shift` + `3` | Open the **iOS** agile board |
| `Alt` + `Shift` + `4` | Open the **Android** agile board |
| `Alt` + `F` | **Fill** the bug template into the current form |
| `Alt` + `C` | **Copy** the description template to the clipboard |
| `Alt` + `X` | **Clear** the form (subject + description) |
| `Alt` + `Q` | **Collapse / expand** the panel |

---

## Installation

### Chrome extension

There are three ways to install, depending on how it's distributed:

**A) From a downloaded ZIP (no Web Store needed)**

1. Download the extension ZIP (see *Building a distributable ZIP* below) and
   unzip it to a folder you'll keep.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.

> Chrome blocks installing standalone `.crx` files for security, so a ZIP +
> **Load unpacked** is the simplest way to share the extension outside the
> Chrome Web Store.

**B) From this repo (for development)**

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the [`chrome-extension/`](chrome-extension/) folder.

**C) Chrome Web Store (one-click, if published)**

If the extension is published to the Web Store, users can install it with a
single **Add to Chrome** button. Publishing requires a one-time Chrome Web Store
developer account and a review by Google.

#### Building a distributable ZIP

Run the packaging script from the repo root to produce a clean, versioned ZIP in
`dist/` (it reads the name/version from `manifest.json` and includes only the
runtime files):

```powershell
powershell -ExecutionPolicy Bypass -File .\package-extension.ps1
```

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

- The full panel runs on `https://redmine.kernello.com/*`. It also runs on the
  app under test, `https://dev.cloudapper.com/*`, as a **launcher** — the Report
  an Issue and Agile Board links open Redmine in a new tab (Fill / Copy / Clear
  only act on the Redmine issue form).
- Keep the extension and userscript in sync when making changes — they share the
  same logic and styles.

### AI mode

- **Bring your own OpenAI API key.** Paste it once in the *AI* view; it's stored
  in the browser's `localStorage` (per device) and reused. Requests go **directly
  to OpenAI** — use a personal or limited-scope key, since anyone with access to
  the browser profile can read it.
- Once saved, the key field shows a **🔑 API key saved** indicator with a
  **Change** button so you can replace the key whenever you like.
- The **extension** sends the request from a background service worker and
  declares the `https://api.openai.com/*` host permission (so it isn't blocked by
  Redmine's Content-Security-Policy). After updating, **reload the extension** at
  `chrome://extensions` to pick up the new permission.
- The **userscript** uses `GM_xmlhttpRequest` with `@connect api.openai.com`.
  After updating, approve the new grant when Tampermonkey prompts.

---

## Author & contact

Created by **Muntanuz Zaman**.

Found a bug or have a suggestion for improvement? Please get in touch:

- **Email:** [muntanuz@m2sys.com](mailto:muntanuz@m2sys.com)
