# Release Notes

A summary of what changed in each version of **QA Assistant for Redmine**.
For features and usage, see the [README](README.md).

---

## Version 4.12 — current

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
