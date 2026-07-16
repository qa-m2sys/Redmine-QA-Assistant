# Release Notes

A summary of what changed in each version of **QA Assistant for Redmine**.
For features and usage, see the [README](README.md).

---

## Version 5.31 — current

### Improvements
- ✅ **AI review card announces itself.** After clicking Structure, the
  "Review & edit before filling" section appears with a soft brand-tinted
  halo pulse (`box-shadow` + slide-in over ~0.6s) so it's obvious a new
  panel just arrived below the chat. The card also `scrollIntoView`s
  (block: nearest, smooth) so it's never left off-screen. Re-running
  Structure to refine a draft replays the pulse each time. Skipped when
  `prefers-reduced-motion` is set.
- ✅ **Clearer fallback reply.** When the AI response omits the chat
  `reply` field but still produces a subject/description, the assistant
  bubble now reads "Draft ready — review the subject and description
  below, then click Fill." instead of a bare "Done." — so users know
  exactly where to look and what to do next.

---

## Version 5.30

### Fixes
- ✅ **Launcher min-height.** On `dev.cloudapper.com` (and any non-Redmine
  host) the expanded panel now enforces a taller 440px minimum height so
  the trackers, projects, agile boards toggle **and** the `v5.xx` version
  footer are all visible on first paint without scrolling. On Redmine the
  original 180px minimum is unchanged — the panel there has more sections
  and the body can scroll as before. Collapsed / docked states are
  unaffected.

---

## Version 5.29

### Improvements
- ✅ **Per-tracker default templates.** The Description Source template is
  no longer a single shared block. Each tracker — 🐞 Bug, ✨ Feature,
  ✅ Task, 📖 User story, 🧪 Test case, 💡 Suggestion — now ships with its
  own default template shaped for that kind of report (steps + expected
  scenario for bugs, acceptance criteria for features / user stories,
  checklist for tasks, preconditions + expected result for test cases,
  current / suggested / benefit for suggestions).
- ✅ **Template editor follows the tracker.** Picking a different tracker
  card in the panel now repopulates the template textarea with that
  tracker's saved (or shipped) template. Save / Reset act on the
  currently selected tracker, so you can customise each one independently.
- ✅ **Storage split.** User overrides are stored per tracker under
  `qa-template-<tracker>` (e.g. `qa-template-bug`, `qa-template-feature`).
  The legacy `qa-template` key is read once as a fallback for bug so any
  existing customisation carries over transparently on first use.
- ✅ **AI mode uses your overrides.** The AI system prompt already picks
  its scaffold per tracker; it now also honours your saved override for
  that tracker instead of a hardcoded string, so "Structure" produces
  descriptions in exactly the format you customised.
- ✅ **Fill Template respects the panel.** Clicking Fill Template without
  a `#qa=` URL marker now uses the tracker currently highlighted in the
  panel (previously it always defaulted to Bug).

---

## Version 5.28

### Fixes
- ↩️ **Reverted header subtitle.** The `v5.xx` line under the "🚀 QA
  Assistant" title crowded the small header and duplicated info already
  visible in the extension / userscript manager. The header is back to
  a single `.qa-title` span and the version tag lives at the bottom of
  the panel body again as `.qa-version` (its pre-5.26 home). The
  `.qa-header-titles` / `.qa-subtitle` styles are removed. All other
  v5.26 polish (soft focus rings, caret colour tween, panel entry
  animation, radius tokens) is unchanged.

---

## Version 5.27

### Fixes
- ↩️ **Reverted AI chat empty state.** The centred "💭 Ask about this
  ticket…" hint on `.qa-ai-chat:empty` felt like noise in the compact
  panel — the empty state is back to `display:none` so the chat area
  collapses cleanly until the first bubble arrives. All other v5.26
  polish (soft focus rings, caret colour tween, panel entry animation,
  radius tokens, header subtitle) is unchanged.

---

## Version 5.26

### Improvements
- ✅ **Soft focus rings.** Keyboard focus rings on buttons, header buttons,
  section toggles, mode-switch buttons and tracker cards now render as a
  soft 3px halo (`color-mix`ed brand at 30% alpha) instead of a flat 2px
  outline — follows each element's border-radius, feels more like Vercel
  / Linear. A transparent 2px outline is kept underneath so Windows High
  Contrast Mode still shows a visible focus indicator.
- ✅ **Animated caret colour.** Section chevrons already rotated 90° on
  open; they now also tween to brand blue at the same time so the state
  change reads instantly at a glance.
- ✅ **AI chat empty state.** When the AI mode has no messages, the chat
  area shows a centred muted hint ("💭 Ask about this ticket…") instead
  of collapsing to nothing. Reappears after Reset Chat.
- ✅ **Panel entry animation.** Panel now fades in (`opacity 0 → 1`) and
  slides up 6px on first mount, over ~180ms. No more jumpy appearance on
  page load / when the extension re-injects. Respects
  `prefers-reduced-motion`.
- ✅ **Border-radius harmony.** New tokens `--qa-r-sm` (6px), `--qa-r-md`
  (8px), `--qa-r-lg` (12px). The panel shell, header capsule, header
  buttons, main buttons, tracker cards and project cards now all trace
  back to these variables, so a radius adjustment is a one-line change.
- ✅ **Header subtitle.** The panel header now shows the running version
  (e.g. `v5.26`) as a small subtitle under the "🚀 QA Assistant" title.
  Version footer inside the body removed — no more duplication. Hidden
  in vertical-collapsed mode to keep the sidebar chrome clean.

---

## Version 5.25

### Fixes
- ↩️ **Reverted sticky section headers.** In practice the pinned/blurred
  section titles were noisier than helpful in a small panel that only
  scrolls a little. `.qa-section-label` and `.qa-section-toggle` are back
  to their pre-5.24 `position: relative` layout and scroll away with the
  rest of the content. The `--qa-sticky-bg` token is removed. Toolbar
  capsule, elevated grouped surfaces, and the AI typing dots from v5.24
  are unchanged.

---

## Version 5.24

### Improvements
- ✅ **Toolbar-style header capsule.** The three header buttons (theme, dock,
  collapse) are now grouped inside a single translucent capsule with 1 px
  hairline dividers between them — same feel as Chrome's toolbar chip or
  Arc's window controls. Dividers flip from vertical to horizontal when the
  panel is docked to a side edge so the vertical bar looks right too.
- ✅ **Sticky section headers.** When the panel body scrolls, section titles
  (`Report an Issue`, `Actions`, `Agile Boards`, …) pin to the top with a
  translucent blurred background so you always know which group of tools
  you're looking at. Sits on top of the frosted panel's own backdrop-filter
  for a stronger "pinned header" separation.
- ✅ **Elevated grouped surfaces.** New `--qa-surface-elevated` token +
  a soft 1 px border are applied to the Description Source wrap and the
  AI "Review & edit" block, lifting them off the frosted body as distinct
  tool cards instead of a loose stack of controls.
- ✅ **Typing indicator.** The AI chat's static "Thinking…" bubble is
  replaced by three dots pulsing in sequence (`.qa-typing` / `@keyframes
  qa-dot-pulse`). Bubble keeps its accent-violet styling; the animation
  strips itself once the real reply arrives.

---

## Version 5.23

### Improvements
- ✅ **Frosted-glass panel.** The whole card is now slightly translucent
  (94% opaque surface) with `backdrop-filter: blur(24px) saturate(160%)` so
  the Redmine content behind shows through as a soft mica-like tint. The
  header keeps its brand gradient plus a 1px specular top highlight that
  sells the "glass" like Big Sur / Windows 11 title bars. Body content
  stays fully legible.
- ✅ **Refined action buttons.** Hovering a `.qa-btn` no longer slams it to
  solid brand blue. Instead a **3 px brand accent bar grows in from the
  left** (0 → 3 px, 180ms cubic) and the background tints softly — Linear /
  GitHub row style. Danger buttons get the same treatment in red; the
  filled AI "Fill Subject & Description" button opts out (no bar over its
  own solid fill).
- ✅ **Micro-interactions.** Buttons now press with a subtle `scale(.985)`
  instead of a `translateY(1px)` jump, gain a soft shadow on hover, and
  drop it on active. Header icon buttons scale to `.92` on press.
- ✅ **SVG icon system.** Header buttons (theme toggle, dock, collapse),
  the section chevrons, and the API-key visibility toggle are now
  stroke-based inline SVGs (`sun`, `moon`, `pin`, `plus`, `minus`,
  `chevron-right`, `eye`, `eye-off`). Colours follow `currentColor` so they
  match the theme and hover state automatically. Section chevrons rotate
  90° on open via a `.qa-caret-open` class instead of a text swap — smooth
  animation.
- ✅ **Tighter tracker card grid.** The active tracker now keeps its 1 px
  border and gets an inset 3 px brand stripe (`box-shadow: inset 3px 0 0`)
  instead of swapping to a 2 px border with padding compensation. Zero
  layout jitter when clicking between tracker cards.

---

## Version 5.22

### Improvements
- ✅ **Section-label accent bars.** Every section header (`REPORT TEMPLATE`,
  `OTHER TEMPLATES`, `PROJECT`, `TRACKER`, …) now has a small
  brand-coloured vertical bar (3 × 12 px, rounded) to its left. Applied
  uniformly to both plain labels and collapsible toggles so all sections
  share the same visual anchor and the panel scans as a clear list of
  grouped tools instead of a stack of similar-looking rows.

---

## Version 5.21

### Improvements
- ✅ **Design tokens.** The entire panel palette (brand blue, accent violet,
  danger red, surfaces, borders, dividers, scrollbar thumbs, shadows, the
  header gradient) now lives as CSS custom properties on `#qa-panel`. Dark
  mode is a single token-override block instead of ~30 duplicated rules
  — changing the brand blue or tweaking dark-mode contrast is now a
  one-line edit.
- ✅ **Custom thin scrollbar** on the panel body and the AI chat window.
  Rounded grey thumb on a transparent track, `scrollbar-gutter: stable` so
  content doesn't jump when the scrollbar appears. Replaces the chunky
  native Windows/GTK scroll gutter that clashed with the rounded panel.
- ✅ **Sliding segmented indicator** for the **Template / AI** toggle. The
  active pill now animates between the two buttons with a cubic-bezier
  ease instead of hard-swapping colours — same look as iOS/macOS segmented
  controls. Pure CSS: the JS handler just flips `data-active` on the
  container.

---

## Version 5.20

### Improvements
- ✅ Agile board buttons now read "**Web Board**", "**Backend Board**",
  "**iOS Board**", "**Android Board**" instead of just the project name,
  so it's obvious at a glance that the row of buttons opens boards rather
  than the projects themselves.
- ✅ The **collapsed** horizontal bar now matches the expanded panel's new
  minimum width — **300px** (was 260px) — so toggling collapse/expand no
  longer shifts the panel's footprint sideways.

---

## Version 5.19

### Fixes
- ✅ Hovering over a **project card** no longer draws an underline under the
  project name. Redmine's global `a:hover { text-decoration: underline }`
  rule was leaking through the card's link. `text-decoration:none` is now
  enforced on the card in all interaction states (`:hover`, `:focus`,
  `:active`, `:visited`).

---

## Version 5.18

### Improvements
- ✅ Raised the expanded panel's minimum width from **270px** to **300px** so
  the tracker and project card grids have more breathing room and the
  **Step 2** row never feels cramped at the smallest size.

---

## Version 5.17

### Improvements
- ✅ Raised the expanded panel's minimum width from **260px** to **270px**
  so the tracker cards and project cards have a touch more breathing room
  at the smallest size.

---

## Version 5.16

### Fixes
- ✅ At the minimum panel width, the **Step 2 · choose a project** header and
  the selected tracker chip next to it were wrapping onto two lines, which
  broke the visual rhythm of the section. They now stay on a single line
  — the step label truncates with an ellipsis if needed, the tracker chip
  stays anchored to the right, and both use `justify-content: space-between`
  for balanced spacing.

---

## Version 5.15

### Improvements
- ✅ **Choose a project** now renders as a two-column card grid that mirrors the
  **Choose a tracker** section — emoji chip on the left, project name on the
  right. This makes the two steps visually consistent and lets all four
  projects fit on-screen without vertical scrolling.

---

## Version 5.14

### Fixes
- ✅ The **OpenAI API key** field no longer uses `type="password"`. Chrome and
  password managers (1Password / LastPass / Bitwarden) attach autofill and
  “save password?” prompts to any page containing a password input, which was
  spilling into unrelated fields on the Agile board (the `Search by subject`
  input). The key is now stored in a regular text input visually masked with
  `-webkit-text-security`, and tagged with `autocomplete="off"`,
  `data-lpignore`, `data-1p-ignore`, and `data-form-type="other"` so password
  managers ignore it.

### New
- ✅ The key field gains a **Show / Hide** eye button so you can still verify
  what you pasted before saving.

---

## Version 5.13

### Improvements
- ✅ The **Agile Boards** section is now shown **above the Actions** section in
  the panel so navigation options stay closer to the report flow and the more
  destructive Actions (Fill / Copy / Clear) sit at the bottom.

---

## Version 5.12

### Improvements
- ✅ The AI compose textarea placeholder now **matches the selected tracker**
  instead of always saying “Describe the bug…”. Each tracker gets a tailored
  hint (feature, task, user story, test case, suggestion).
- ✅ The placeholder also updates live when the tracker dropdown on the Redmine
  issue form is changed.

---

## Version 5.11

### Fixes
- ✅ The textareas in the **Description source** section (template editor, AI
  compose input, AI review Subject/Description) now **wrap long lines** instead
  of scrolling horizontally. Very long words or URLs also break so the content
  always stays inside the panel width.

---

## Version 5.10

### Fixes
- ✅ The v5.9 typography change was invisible on machines where **Inter** wasn't
  installed — the stack silently fell back to Segoe UI, which was already the
  previous font. Inter is now loaded on demand from Google Fonts on init, so
  the modern look renders everywhere. If a page's CSP blocks Google Fonts the
  panel simply falls back to the OS UI font.
- ✅ The panel now forces `font-family` on **every descendant**, including form
  controls (`<button>`, `<input>`, `<select>`, `<textarea>`), which don't
  inherit font-family by default. Redmine's host styles can no longer override
  the panel typography.

---

## Version 5.9

### Improvements
- ✅ Refreshed the panel typography with a modern font stack
  (**Inter → Segoe UI Variable → SF Pro → system-ui**), grayscale font
  smoothing, tabular numerals, and subtle letter-spacing so the UI feels
  cleaner and more consistent across Windows, macOS, and Linux.
- ✅ Code blocks and the template editor now use a modern monospace stack
  (**SF Mono / JetBrains Mono / Cascadia Code**) with a common CSS variable.

---

## Version 5.8

### Improvements
- ✅ The tracker-aware AI prompts are now more detailed — each tracker gets a
  one-line definition of what it represents plus richer, section-by-section
  guidance so the assistant fills every heading meaningfully.
- ✅ **Feature** is now treated as a **new capability being introduced** (not a
  “feature request”), and **Task** as a concrete unit of work to carry out, so
  the wording and structure match how these trackers are actually used.

---

## Version 5.7

### Improvements
- ✅ The AI assistant now adapts to the **selected tracker**. Instead of always
  writing a bug report, it produces the right kind of content for a **Feature**,
  **Task**, **User story**, **Test case** or **Suggestion**, each with its own
  title wording and description structure (e.g. acceptance criteria for user
  stories, test steps for test cases).
- ✅ On a Redmine issue form the assistant follows the tracker actually selected
  in the form, so changing the tracker dropdown updates the AI output too.

---

## Version 5.6

### Improvements
- ✅ The description section is now **Step 3 · Description source**, placed right
  below the project picker to follow the tracker → project → description flow.
- ✅ The **Template / AI** switch is now a segmented toggle (two clear buttons)
  instead of the on/off slider. All template and AI features are unchanged.

---

## Version 5.5

### New
- ✅ **Report under any tracker** — the *Report an Issue* section is now a
  two-step picker: choose a **tracker** (Bug, Feature, Task, User story, Test
  case, Suggestion), then a **project**. Redmine opens the New issue form for
  that tracker and project, with the project's assignee auto-filled as before.
  Your last-used tracker is remembered, and the `Alt`+`1..4` shortcuts open the
  chosen project under the selected tracker.

---

## Version 5.4 — current

### Improvements
- ✅ The panel can now be resized from **any edge or corner** (not just the
  bottom-right). Dragging the top/left sides moves the opposite edge so the
  panel grows in place.

---

## Version 5.3 — current

### New
- ✅ **Resizable panel** — drag the bottom-right corner of the expanded panel to
  adjust its width and height freely. Contents reflow to fit, the original size
  is the minimum, and your chosen size is remembered across page loads.

---

## Version 5.2 — current

### Fixes
- ✅ The AI assistant now writes a short 1-2 sentence summary under the
  **`*Description:*`** heading instead of leaving it blank.

---

## Version 5.1

### Improvements
- ✅ **Saved API key state** — once you save your OpenAI key, the field is
  replaced by a **🔑 API key saved** indicator with a **Change** button, so it's
  clear a key is stored. Click **Change** to enter a new key.
- ✅ The default description template now includes a **`*Description:*`** heading
  above the Steps. (Click **Reset** in the template editor to adopt the new
  default if you saved a custom one.)

### Fixes
- ✅ The AI **Model** label now matches the selector box, and the selected model
  name is no longer clipped inside the dropdown.

---

## Version 5.0

### New — AI bug-report assistant
- ✅ The **Description Template** section now has a **Template ⟷ AI** toggle.
  In **AI mode** you can chat with OpenAI to turn rough notes into a
  well-structured bug report.
  - **Multi-turn chat** — keeps the conversation so you can refine the result
    ("add expected result", "make the steps more detailed", etc.).
  - **Review before filling** — the AI returns a **Subject** and a
    **Description** (formatted to your saved template) in editable fields; click
    **Fill Subject & Description** to write them into the Redmine form.
  - **Model selector** — choose between `gpt-4o` (default), `gpt-4o-mini`,
    `gpt-4.1`, `gpt-4.1-mini`, and `gpt-4-turbo`. Your choice is remembered.
  - **Bring your own key** — paste your OpenAI API key once; it's stored locally
    in the browser (per device) and reused.
- ✅ The extension routes the OpenAI request through a **background service
  worker** so it isn't blocked by Redmine's Content-Security-Policy; the
  userscript uses `GM_xmlhttpRequest` (`@connect api.openai.com`) for the same
  reason.

### Notes
- The API key is stored in `localStorage` and requests go directly to OpenAI.
  Use a personal/limited key — anyone with access to the browser profile can
  read it.

---

## Version 4.21

### Improvements
- ✅ On **dev.cloudapper.com**, the **Actions** (Fill / Copy / Clear) and
  **Description Template** sections are now hidden — they only act on the Redmine
  issue form, so the panel there shows just Report Bug + Agile Boards. Both
  sections remain on Redmine.

---

## Version 4.20

### Improvements
- ✅ The **collapsed (horizontal) bar** now matches the expanded panel exactly:
  same 260px width and the same header layout, so the title and buttons stay in
  place when collapsing/expanding.
- ✅ The dock button is now shown in both the expanded and collapsed headers so
  their buttons line up (it was previously only visible when collapsed).

---

## Version 4.19

### New
- ✅ The panel now also loads on the app under test, **dev.cloudapper.com**, as a
  launcher. The **Report Bug** and **Agile Board** links now use absolute Redmine
  URLs, so they open Redmine in a new tab from any site (auto-fill still runs in
  the opened Redmine tab).

---

## Version 4.18

### Improvements
- ✅ The panel now shows its **version number** in a small footer, read from the
  extension manifest / userscript metadata so it always matches the build.

---

## Version 4.17

### Bug fixes
- ✅ Fixed auto-fill **overwriting an existing issue's description/fields when
  editing**. Auto-fill now runs only on the New issue form (it previously ran on
  any page that had a description field, including edit forms).

---

## Version 4.16

### Bug fixes
- ✅ Fixed the shortcut badges on the **Report Bug** / board buttons getting
  clipped on the right. The link-based buttons now use `box-sizing:border-box`
  (buttons had it by default, anchors did not), so they no longer overflow.

---

## Version 4.15 — current

### Bug fixes
- ✅ Fixed the button text getting **underlined on hover** (the Redmine theme's
  `a:hover` style was leaking onto the new link-based buttons).

---

## Version 4.14

### Improvements (accessibility)
- ✅ The **Report Bug** and **Agile Boards** buttons are now real links, so
  **middle-click / Ctrl-click / right-click “open in new tab”** and keyboard
  activation all work natively.
- ✅ Report Bug links carry the project via a `#qa=<project>` URL marker, so
  auto-fill runs reliably in the newly opened tab regardless of how it's opened.
- ✅ Agile board links refresh their target on click to the last-viewed / current
  sprint board.

---

## Version 4.13

### Improvements
- ✅ The **Report Bug** buttons (formerly “Projects”) now open the New Bug form in
  a **new tab**, so your current page stays put. Auto-fill still runs in the new
  tab.
- ✅ Renamed the **Projects** section to **Report Bug**.

---

## Version 4.12

### Improvements (accessibility)
- ✅ Agile board buttons now have descriptive labels/tooltips (e.g. “Web agile
  board”) for screen readers.
- ✅ Added a visible keyboard **focus ring** to the panel's buttons and toggles.
- ✅ Added **Alt+Shift+1..4** shortcuts to open each project's agile board
  (parallel to Alt+1..4 for switching projects), with ⇧1..⇧4 hints on the
  buttons.

---

## Version 4.11

### Improvements
- ✅ **Agile Boards** now open each project's **current sprint** board (filtered
  by target version) instead of the default board.
- ✅ The panel now **remembers the last agile board you viewed** per project and
  reopens it next time (falling back to the current sprint).

---

## Version 4.10

### Improvements
- ✅ The expanded panel now **scrolls internally** when its content is tall. The
  body is capped to 75% of the viewport height with a scrollbar, so the panel
  never runs off the screen as more sections are added.

---

## Version 4.9

### Improvements
- ✅ The **Agile Boards** section is now collapsible (like the Description
  Template section), with its open/closed state remembered across page loads.

---

## Version 4.8

### New
- ✅ Added an **Agile Boards** section to the expanded panel with one button per
  project (Web, Backend, iOS, Android). Clicking a button opens that project's
  agile board in a new tab, keeping your current page and panel intact.

---

## Version 4.7

### Improvements
- ✅ Slimmed the **collapsed vertical bar** from 44px to 40px wide (with a little
  extra padding for breathing room) and lengthened it to 370px so nothing is
  cropped.

---

## Version 4.6

### Bug fixes
- ✅ Increased the **collapsed vertical bar** length to 350px so all stacked
  header buttons fit without any being cropped.

---

## Version 4.5

### Bug fixes
- ✅ Lengthened the **collapsed vertical bar** to 300px so the upright title has
  space at the top and the stacked header buttons are no longer cropped at the
  bottom.

---

## Version 4.4

### Improvements
- ✅ The **collapsed vertical bar** (left/right edge) now shows the title as
  upright, top-to-bottom stacked characters instead of sideways rotated text,
  so it reads naturally without tilting your head. The left-edge title flip is
  no longer needed and was removed, and the vertical bar was lengthened slightly
  (270px) so the text never clips.

---

## Version 4.3

### Bug fixes
- ✅ Fixed the **docked pill** being broken (rendered as a full-size bar) after
  the collapsed-bar sizing changes. The collapsed sizing rules no longer apply
  while docked, so the pill keeps its correct compact size again.

---

## Version 4.2

### Bug fixes
- ✅ Centered the **collapsed bar** contents. The title and header buttons are
  now centered as a group (instead of being pushed to opposite ends) in both the
  horizontal and vertical placements.

---

## Version 4.1

### Bug fixes
- ✅ The **QA Assistant** title no longer wraps onto a second line in the
  collapsed bar (in either orientation). The title stays on one line at full
  size and the collapsed bar was lengthened to 250px to fit it alongside the
  header buttons.

---

## Version 4.0

### New
- ✅ **Dark mode** — toggle a dark theme from the 🌙 button in the panel header.
  Your choice is remembered, and by default it follows your operating system's
  light/dark preference.

---

## Version 3.9

### Bug fixes
- ✅ Fixed the **collapsed bar** looking different depending on the edge. The
  horizontal (top/bottom) and vertical (left/right) collapsed bars now share the
  same footprint — a 200px long side and a 44px thick side, just rotated — so
  they look consistent in every placement.

---

## Version 3.8

### Improvements
- ✅ Made the **docked pill** a consistent, larger size across all edges
  (60×44 horizontal, 44×60 vertical) so left/right and top/bottom placements
  look uniform and are easier to grab.

---

## Version 3.7

### Bug fixes
- ✅ Fixed a thin white line that appeared on the edge of the **docked pill**
  (caused by the panel's 1px border showing through); the docked pill now has no
  border and its gradient fills the whole shape in both orientations.

---

## Version 3

Building on the earlier releases, Version 3 focuses on customization and a more
flexible, movable panel.

### Description templates
- ✅ Added an **editable description template** — expand the *Description
  Template* section to write your own template.
- ✅ **Save** stores your template locally; **Reset** restores the shipped
  default.
- ✅ Your custom template is used for **Fill**, **Copy**, and **auto-fill**.

### Panel & docking
- ✅ **Draggable panel** — move the panel anywhere; its position is remembered.
- ✅ **Collapsible panel** — collapse it to a compact bar.
- ✅ **Edge-aware collapsed bar** — when dragged to the **left or right edge**,
  the collapsed bar rotates into a vertical strip that hugs the edge; the title
  flips so it stays readable on the left edge. Anywhere else it stays a
  horizontal bar.
- ✅ **Dock to edge** — dock the collapsed panel into a small **pill** pinned to
  any screen edge. Drag it to reposition; it snaps to the nearest edge and
  rotates to match (vertical on left/right, horizontal on top/bottom). Click the
  pill to restore the panel.
- ✅ **Persistent state** — panel position, collapsed/docked state, dock
  position, and your custom template persist across page loads.

### Fixes & polish
- ✅ **Scrollbar-aware placement** — the panel and pill no longer slip beneath
  the browser's scrollbar and stay fully on-screen.
- ✅ Toast notifications for every action (fill, copy, clear, save, reset).
- ✅ OS/layout-independent keyboard shortcuts (work with the macOS Option key).

### Distribution
- ✅ Added `package-extension.ps1` to build a clean, versioned ZIP of the Chrome
  extension (in `dist/`) that anyone can download and install via
  **Load unpacked**.

---

## Version 2

- ✅ Switches to the correct project automatically.
- ✅ Fills Tracker, Status, Priority, Assignee.
- ✅ Inserts the description template.

---

## Version 1

- ✅ Floating panel that stays visible.
- ✅ One-click buttons for:
  - 🌐 Web
  - ⚙️ Backend
  - 🍎 iOS
  - 🤖 Android
- ✅ Sets Tracker = Bug, Status = New, Priority = Normal, Assignee = Correct Team.
- ✅ Fills the description template.
