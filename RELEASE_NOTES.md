# Release Notes

A summary of what changed in each version of **QA Assistant for Redmine**.
For features and usage, see the [README](README.md).

---

## Version 3.9 — current

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
