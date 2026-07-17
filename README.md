# QA Assistant for Redmine

**File bug reports, features, and tasks on Redmine in seconds — without hunting through menus, retyping the same fields, or leaving the app you're testing.**

A floating, draggable panel that lives on top of Redmine (and the app under test) and does the tedious parts of issue reporting for you.

---

## Who is it for?

- **QA engineers** — file consistent, well-structured bug reports and test cases without retyping boilerplate.
- **Developers** — quickly open the right project's board or file a feature / task without navigating Redmine's menus.
- **Anyone on the team** who reports issues on `redmine.kernello.com`.

---

## Where it runs

| Site | What the panel does there |
|------|---------------------------|
| `https://redmine.kernello.com/*` | **Full assistant** — pick tracker + project, auto-fill the form, use AI, copy/clear, open boards. |
| `https://dev.cloudapper.com/*` | **Launcher mode** — pick tracker + project and it opens the matching Redmine New-issue form in a new tab, so you can report a bug or open a board without leaving the app you're testing. |

---

## What it does — at a glance

### 📝 Report an issue in three clicks
- Pick a **tracker** — Bug, Feature, Task, User story, Test case, or Suggestion.
- Pick a **project** — Web, Backend, iOS, or Android.
- Redmine opens the New-issue form in a new tab, **pre-filled** with:
  - the right tracker, status (New), priority (Normal),
  - the team's assignee for that project,
  - and a description template tailored to the tracker you picked.
- Your last-used tracker is remembered next time you open the panel.

### 🧠 AI report assistant (optional)
- Toggle to **AI mode** and paste your rough notes — reproduction steps, a screenshot description, a feature idea — into a chat box.
- The assistant returns an **editable Subject + Description** in the format that matches your selected tracker (steps + expected result for bugs, acceptance criteria for user stories, test steps for test cases, etc.).
- **Multi-turn chat** — refine the result with follow-up messages.
- **Pick your model** — `gpt-4o` (default), `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4-turbo`.
- **Fill Subject & Description** button drops the result straight into the Redmine form.
- **Bring your own OpenAI API key** — stored locally in the browser, never sent anywhere except OpenAI.

### 📄 Per-tracker description templates
- Every tracker ships with its own default template shaped for that kind of report — steps + expected scenario for bugs, checklists for tasks, current/suggested/benefit for suggestions, and so on.
- Edit any template inline and hit **Save** — it's stored under that tracker only.
- Hit **Reset** to restore the shipped default for the current tracker.
- Your template drives **Fill**, **Copy**, auto-fill after navigation, **and** the AI assistant's structure.

### 🚀 Agile boards, one click away
- Open any project's **current sprint board** (Web / Backend / iOS / Android) in a new tab.
- If you switch to a different version of a board in Redmine, it **remembers your choice** and reopens that one next time.

### ⚡ Toolbar actions
- **Fill** — apply the template to the currently open issue form.
- **Copy** — copy the current tracker's description template to the clipboard.
- **Clear** — clear the subject + description fields in one click.
- **Toast notifications** confirm every action.

### ✅ Close an issue in one click
- New **"Close this issue"** section that appears on any Redmine issue detail page (`/issues/<n>`).
- Pick the **Closed Version** from a dropdown that mirrors Redmine's own list (custom field #12), and the panel writes:
  - **Status → Closed**
  - **Closed Version → your pick**
  - **Notes → `Issue resolved. Tested in <Project> — <Version>.`** (shown in an editable textarea so you can tweak the wording before you commit — add device, build, tester name, whatever).
- Two buttons for safety:
  - **Fill only** — fills the three fields and reveals the Update panel; you review and Submit yourself.
  - **Close issue** — fills + auto-submits.
- Both buttons stay disabled until a version is picked *and* the note has content.

### 📈 Close many issues from the Agile board
- New **"Close multiple issues"** section that appears in the panel on any `/projects/<x>/agile/board` page.
- Click **Enter select mode** and every card on the board grows a small checkbox in its top-right corner — tick as many as you need.
- Pick a **Closed Version** and edit the auto-generated note (same textarea + template as the single-issue close).
- Click **Close N issues…** to open a themed confirmation modal listing every selected issue by ID and subject, the picked version, and the exact note that will be posted. Cancel any time; confirm to send one round-trip to Redmine's built-in `bulk_update` endpoint (session cookies + CSRF, no extra permissions).
- On success the board reloads so the closed cards actually disappear.

### ⌨️ Keyboard-first workflow
- <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>4</kbd> — open Web / Backend / iOS / Android New-issue form.
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>4</kbd> — open the matching agile board.
- <kbd>Alt</kbd>+<kbd>F</kbd> / <kbd>C</kbd> / <kbd>X</kbd> — Fill / Copy / Clear.
- <kbd>Alt</kbd>+<kbd>Q</kbd> — collapse or expand the panel.
- Shortcuts use physical key codes, so they work on any OS and keyboard layout (including the macOS Option key).

### 🖱️ A panel that gets out of your way
- **Drag** it anywhere on screen — position is remembered.
- **Resize** from any edge or corner — size persists.
- **Collapse** it to a compact bar to reclaim screen space.
- **Dock** it to a small pill pinned to any screen edge — drag the pill to reposition, click to restore.
- Auto-rotates to a **vertical strip** when collapsed against the left / right screen edge.
- Never slips under the browser scrollbar.

### 🎨 Personal look & feel
- **Light / Dark mode** — click the 🌙 / ☀ button in the header; auto-follows your OS preference by default.
- **Accent colour picker** — click the 🎨 button and choose from **Ocean blue**, **Lavender**, **Sunset orange**, or **Soft red**. Every button, hover state, focus ring, and section-header accent adapts instantly.
- Both settings persist across page loads.
- Frosted-glass panel with backdrop blur + saturation, inline SVG icons, soft focus rings, and gentle animations — all skipped when `prefers-reduced-motion` is set.

### 💾 Everything remembers itself
- Last-used tracker, last-viewed board, custom templates per tracker, panel position, size, collapsed / docked state, dock position, theme, accent colour, and (optionally) your AI API key — all persist across page loads and browser restarts.

---

## Two interchangeable forms

Use whichever fits your setup — both versions share the exact same features and UI.

| Form | Location | Use it when |
|------|----------|-------------|
| **Chrome extension** (MV3) | [`chrome-extension/`](chrome-extension/) | You want an easily shareable, one-click installable extension. |
| **Userscript** | [`qa-assistant.user.js`](qa-assistant.user.js) | You use Tampermonkey / Violentmonkey or another userscript manager. |

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for a full history of what changed in each version.

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
- **Per-tracker description templates** — Every tracker (Bug, Feature, Task,
  User story, Test case, Suggestion) ships with its own default template
  shaped for that kind of report: Steps + Expected Scenario for bugs,
  Acceptance Criteria for features / user stories, Checklist for tasks,
  Test Steps + Expected Result for test cases, Current / Suggested / Benefit
  for suggestions, and so on. Expand the *Step 3 · Description source*
  section to edit the template for whichever tracker is currently selected
  in the panel. **Save** stores it locally under that tracker; **Reset**
  restores the shipped default for that tracker only. Your template drives
  Fill, Copy, auto-fill **and** the AI assistant's scaffolding.
- **AI report assistant** — Use the segmented **Template / AI** toggle to
  switch to **AI** mode and chat with OpenAI, turning rough notes into a
  structured report. The assistant **adapts to the selected tracker** — Bug,
  Feature, Task, User story, Test case or Suggestion — using the right title
  wording and description structure for each (e.g. acceptance criteria for user
  stories, test steps for test cases) and honours **your saved per-tracker
  template** as the scaffold.
  It's a **multi-turn chat** (refine the result with follow-ups), shows
  animated "typing" dots while the model is thinking, and returns an editable
  **Subject** and **Description** in a review card that pulses + scrolls into
  view when it appears so you can't miss it. Fill both into the Redmine form on
  demand. Includes a **model selector** (`gpt-4o` by default, plus
  `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4-turbo`). You supply your own
  OpenAI API key, stored locally in the browser.
- **Copy Description** — Copies the current template text to the clipboard.
- **Clear Form** — Clears the subject and description fields in one click.
- **Close an issue from the panel** — On any Redmine issue detail page a new
  *Close this issue* section appears at the bottom of the panel. Pick a
  **Closed Version** from a dropdown that mirrors Redmine's own custom-field
  list, review the auto-generated note in an **editable textarea**
  (`Issue resolved. Tested in <Project> — <Version>.` by default — tweak it
  freely to add context) and choose either **Fill only** (fills Status →
  Closed, Closed Version, and Notes so you can review before submitting)
  or **Close issue** (fills + submits in one click). Both buttons stay
  disabled until a version is picked and the note isn't empty. The section
  is hidden on the New-issue form and on `dev.cloudapper.com`.
- **Close many issues at once from the Agile board** — On any
  `/projects/<x>/agile/board` page a new *Close multiple issues* section
  appears in the panel. Toggle **Enter select mode** to overlay a checkbox
  on every board card, tick as many as you need, pick a **Closed Version**
  and (optionally) tweak the auto-generated note. A themed confirmation
  modal lists every selected issue with its ID + subject and previews the
  exact note that will be posted, so nothing goes out without a full
  review. Confirming POSTs to Redmine's built-in `bulk_update` endpoint
  in a single round-trip (session cookies + CSRF, no extra permissions)
  and reloads the board on success so the closed cards actually disappear.
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
- **Modern visual polish** — Frosted-glass (mica-style) panel with backdrop
  blur + saturation, inline-SVG icons that inherit theme colour, soft
  box-shadow focus rings that follow each control's border-radius, a sliding
  pill in the Template / AI switch, animated typing dots while the AI is
  thinking, a reveal pulse on the AI review card, and a subtle fade + rise
  entry animation on first mount — all skipped when `prefers-reduced-motion`
  is set.

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
| `Alt` + `F` | **Fill** the issue template into the current form |
| `Alt` + `C` | **Copy** the current tracker's description template to the clipboard |
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
