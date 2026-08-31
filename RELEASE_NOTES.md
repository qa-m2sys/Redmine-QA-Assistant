# Release Notes

A summary of what changed in each version of **QA Assistant for Redmine**.
For features and usage, see the [README](README.md).

---

## Version 7.2.1 — current

### ⚡ Sprint audit: 2× faster
- 🔀 Reopen and Feedback journal scans are now **one combined pass** —
  each ticket's history is fetched once and checked against both
  statuses, cutting HTTP by half.
- ⏱ Wall-clock cap raised to 4 minutes so large sprints (~500 tickets)
  finish in a single click without falling back to "(partial)".
- 💾 **Per-board cache** — re-opening the same sprint's audit is now
  instant when the previous scan finished cleanly. Cache clears on
  hashchange/popstate so switching sprints refetches.
- 📊 Single "Scanning journals…" progress line replaces the two
  separate reopen/feedback status messages.

### 💾 Persistent journal caches (audit + reopen)
- 🗄 The audit's per-issue journal parse is now stored in
  `localStorage["qa.audit.journalCache.v1"]` (LRU, 500 entries) — a
  second audit run against overlapping tickets replays the parse
  instead of re-fetching `/issues/N?tab=history`.
- 🔁 Reopened-issues detection gets its own
  `localStorage["qa.reopen.journalCache.v1"]` cache with the same
  budget. Revisiting the reopened list on the same day is instant.
- 🧪 Test Case tickets are skipped from both scans (they never go
  through Reopen / Feedback in this workflow), trimming another chunk
  of noise.

### 🔎 Similar closed tickets panel
- 🆕 **New "Similar closed tickets" section** on every issue detail
  page (`/issues/<n>`) — auto-populates on load with up to 5 closed
  tickets in the same project whose subject overlaps the current one.
- 🧮 Ranking is client-side: subject tokens are stop-worded + stemmed
  to keywords, scored by **Jaccard overlap** with a same-tracker
  bonus, thresholded at 15%, top 5.
- 🗂 Each row shows `#id · Tracker · score%` + a 2-line-clamped
  subject + the closed version (e.g. *Closed in v9.4.0*) and opens
  in a new tab.
- 🔄 **Refresh** button re-runs the search bypassing the cache; every
  other visit is served instantly from
  `localStorage["qa.similar.v1"]` (keyed by issue id, signed by
  `subject|tracker` so a rename auto-invalidates it).

---

## Version 7.2.0

### 📋 Sprint audit
- 🚦 **New "Audit this sprint" button** on Agile board pages produces a
  one-click end-of-sprint report against the current version.
- ❌ **Verdict block** lists shippability blockers (still-in-Reopen tickets,
  Urgent tickets still open) and warnings (Closed tickets missing the Closed
  Version tag, untriaged tickets with no assignee) with jump-links.
- 📊 **Report sections:** Overview (total / closed / open / %),
  Volume by tracker table, Untriaged list, Churn (Feedback bounces) with
  count + %, Reopens with count + % of closed tickets.
- 👤 **Per-assignee breakdown** (Closed-by and Reopens-against) hidden behind
  a "Show individual assignee stats" toggle so day-to-day usage stays
  team-neutral.
- 📋 **Copy report** button emits the full audit as Markdown — table,
  section headings, verdict summary — ready to paste into a sprint-review
  ticket, wiki page, or Slack thread.
- 🔄 Reuses the reopened-issues journal scanner for both the reopen and
  feedback churn counts, so the audit inherits the same wall-clock cap and
  resume behaviour on large sprints.

---

## Version 7.1.1

### Issue copy: single-asterisk bold
- ✏️ Switched the clipboard payload's bold marker from `**Bug #NNNN**`
  to `*Bug #NNNN*` — matches Redmine / Textile's own bold syntax so
  the pasted block renders correctly when dropped back into another
  Redmine ticket or wiki page.

---

## Version 7.1.0

### One-click copy of the issue title + link
- 📋 **New copy button beside `Bug #NNNN`** on every issue detail
  page. One click and the clipboard receives a Markdown-ready block
  — perfect for pasting into Slack, PR descriptions, or release notes.
- 🔔 Confirmation toast ("Issue copied to clipboard") fires from the
  same in-page surface the rest of the panel uses.
- 🛡️ Falls back to a friendly "clipboard blocked" toast if the
  browser refuses `navigator.clipboard.writeText`.

Example payload:

    *Bug #23021* : UI Auto-Capitalizing First Character of Advance Setting Name
    https://redmine.kernello.com/issues/23021

---

## Version 7.0.1

### Analyze Ticket: prompt tuned for both dev and QA readers
- 👥 **Audience-neutral opener.** The analyser now writes for
  whoever's opening the ticket next — dev picking it up, QA about
  to test a delivered fix, or an assignee taking over a hand-off
  — and uses `status`, `assignee`, `tracker` + the latest journal
  notes to figure out the lifecycle stage before framing the
  report.
- ✍️ **Ticket summary can breathe.** Dropped the "2-3 sentences"
  cap. Length now scales with how much detail the ticket carries
  — tight for a one-liner, several paragraphs for a rich one.
- 🔄 **"What changes are being requested" → "What changes are
  being made".** Renamed + reframed so the same section works
  both directions: it describes work the dev is *about to do*
  when the ticket is fresh, and work the dev *already did* when
  the ticket is Resolved / handed to QA — pulling from the
  description AND the latest journal comments.
- 🔎 Explicitly tells the model to cite journal notes when they
  add information the description doesn't.

---

## Version 7.0.0

### Analyze Ticket — QA-friendly AI walk-through of any issue
- 🧠 **New "Analyze Ticket" section** appears below "Close this
  issue" on every issue detail page (`/issues/<n>`). One button:
  **Analyze this ticket**.
- 📝 **Scrapes the whole ticket in one go** — subject, tracker,
  status, priority, assignee, target version, the full
  description, every checklist item (with tick state) and the
  last 5 journal comments (clipped to a shared 4k budget so long
  threads can't blow the context window).
- 🧑‍🔬 **Written for a QA reviewer, not a marketing team.** The
  AI replies with a warm, human-toned Markdown report split into
  fixed sections — *Ticket summary*, *What changes are being
  requested*, *What to expect after the change*, *Questions worth
  asking*, *Edge cases*, *Suggested test cases*, *Risks /
  regression areas*, *Assumptions the AI made*. Sections that
  genuinely don't apply are omitted rather than padded.
- 💬 **Wide, themed modal** with your current accent + dark/light
  mode, a spinner while the model thinks, rendered Markdown
  (headings, lists, bold, italics, links, code) once it lands.
- 📋 **Copy button** grabs the *raw Markdown* — paste it into a
  Slack thread, a test-plan doc, a Redmine comment, whatever.
- 🔑 **Zero new plumbing.** Reuses your saved OpenAI key + the
  model you already chose in AI mode. No new permissions, no new
  storage keys.

### Housekeeping
- 🏗️ Bumped to **7.0.0** to mark this as the first release that
  adds a genuinely new AI workflow beyond the report drafter.
- 🧹 Version scheme in the repo memory brought in line with
  actual practice (both artifacts share the same three-part
  version, not `x.y.0` vs `x.y`).

---

## Version 6.5.17

### Bulk close: Closed Version list no longer disappears
- 💬 Users on the Agile board reported "Enter select mode" showing
  an empty Closed Version dropdown — sometimes accompanied by a
  toast about the bulk-edit form.
- 🔍 **Root cause.** `fetchBulkEditContext()` bundled three things
  (CSRF, closed-status id, version list) into one promise and
  threw on **"Couldn't find a 'Closed' status"** when both
  fallbacks missed — which happens when the board has the
  **Closed column hidden** *and* the representative issue's
  workflow has no direct N→Closed transition. That throw killed
  the successfully-parsed version list one line above it.
- 🪝 **Hardcoded fallback.** Added `CLOSED_STATUS_ID = "5"` (the
  Closed status id on this Redmine instance, confirmed via the
  agile column header `<th data-column-id="5">Closed</th>`).
  Same pattern already used for `REOPEN_STATUS_ID = "8"`. When
  both dynamic lookups miss, the hardcode wins — versions load,
  the actual close POST still works.
- ✨ **Widened the closed-column regex** from
  `/(?:^|\W)closed(?:\W|$)/i` to `/closed/i` so themes that
  collapse the count badge into `"Closed245"` (no delimiter)
  still match.
- 🗣️ Toast copy updated to "Couldn't load the Closed Version
  list" so users know which UI element failed.

---

## Version 6.5.16

### Bulk-add multiple checklist items at once
- ➕ **New "Add all" affordance inside Redmine's Checklist section**
  (new-issue and issue-edit pages, all trackers that expose the
  checklist plugin). A small textarea + button appears right under
  the existing one-at-a-time input.
- 📚 **Paste a whole block, get one row per line.** The extension
  splits your text on newlines, drops blanks, and drives Redmine's
  own "+" save button once per line — so ids, positions and the
  plugin's own bookkeeping stay identical to a hand-typed row.
- 🔁 **Survives tracker changes.** Selecting a different tracker
  triggers Redmine's AJAX form reload; a MutationObserver re-mounts
  the bulk box as soon as the new form is in place.
- 🎯 **Especially handy on Test case** — paste the AI's "Test
  Steps" or "Acceptance Criteria" bullets, click Add all, done.

---

## Version 6.5.15

### AI bug reports: no more missing sections on brief notes
- 🩹 **Fixed the AI dropping headings** (Steps, Expected
  Scenario, Video, Credentials) when the user's notes were
  short. On a fresh install with the shipped default template,
  the model read "keep the placeholders" too loosely and, when
  combined with the "do not invent" rule, deleted sections it
  couldn't fill instead of leaving them empty.
- 🛡️ **Prompt hardening.** `aiSystemPrompt()` now issues an
  explicit `CRITICAL FORMATTING RULE`: every `*Heading:*` line
  from the template MUST appear in the description, in order,
  with the exact wording — empty sections output the heading
  followed by a blank line. Deleting, renaming, merging, or
  reordering headings is explicitly forbidden.
- 🧭 **Anti-invention rule sharpened.** "Do not invent facts"
  is now paired with "Leave the corresponding sections as empty
  headings instead of deleting them", resolving the tension
  that was causing the drop.
- 🎯 Affects Bug, Feature, Task, User story, and Suggestion
  trackers. Test case uses its own `system()` override (added
  in 6.5.14) and is unaffected.

---

## Version 6.5.14

### Test case tracker: senior-QA coverage checklist prompt
- 🧪 **New AI behaviour for the Test case tracker.** The
  assistant now acts as a senior QA engineer and turns a pasted
  feature description into a structured **Markdown coverage
  checklist** with up to seven sections: core functional flows,
  negative / invalid inputs, boundary & edge cases,
  role/permission scenarios, integration points, data-state
  scenarios, and UI/UX edges — plus an **Ambiguities** section
  listing anything in the ticket that needs reporter
  clarification before testing.
- 🤝 **Merge with your own cases.** Paste your own test cases
  in a follow-up turn and the assistant merges them into the
  appropriate section. Every case *it* authored is tagged
  ` [Generated by AI]` so authorship is unambiguous; your cases
  are kept verbatim.
- 🎚️ **Higher creativity for coverage.** `temperature` is
  bumped from `0.3` → `0.5` **only** when the active tracker is
  Test case, so negative / boundary sections don't collapse into
  the same predictable phrasing on every run. Bug / Feature /
  Task / User story / Suggestion still draft deterministically
  at `0.3`.
- 🧩 **Per-tracker prompt override.** `TRACKER_PROMPTS.testcase`
  gains an optional `system()` function that authors the full
  system prompt; `aiSystemPrompt()` detects the override and
  skips the shared noun+role+template+guide composition. The
  other five trackers are untouched.
- 📤 The response still fits the existing
  `{ reply, subject, description }` JSON envelope — the
  Markdown checklist rides in `description`, clarification
  questions land in `reply`, and `subject` is a derived title
  like *"Test coverage for &lt;feature name&gt;"*. **Fill
  Subject & Description** works exactly as before; Redmine
  needs *Text formatting = Markdown* under Administration →
  Settings → General to render the `##` headings and lists.

---

## Version 6.5.13

### Show Reopened Issues: Copy list button
- 📋 **New "Copy list" button** in the reopened-issues modal
  footer (next to Close). Copies the entire currently-displayed
  list to the clipboard in **two formats simultaneously** via a
  `ClipboardItem`:
  - **`text/html`** → `<a href="https://redmine.kernello.com/issues/1234">#1234</a> - Subject text`
    per line, so pasting into rich targets (Word, Outlook,
    Redmine wiki editors, Confluence) keeps every issue id as a
    clickable hyperlink.
  - **`text/plain`** → `#1234 - Subject text (https://redmine.kernello.com/issues/1234)`
    per line, so plain-text targets (Notepad, terminals) still
    get a usable URL.
- 🩹 **Automatic fallback** to `navigator.clipboard.writeText`
  on older browsers that don't ship `ClipboardItem`.
- 🔔 Toast confirmation shows the exact count copied — *"Copied
  N issues"* — with proper singular/plural.
- 🧠 Modal caches `reopenedCurrentRows` on every open so the
  Copy button always serializes what the user is actually
  looking at, even after a resume scan adds more rows.

---

## Version 6.5.12

### Show Reopened Issues: label actually renders
- 🐛 **Fixed the invisible button label**. The reopened button
  was wrapped in `.qa-template-actions`, which sets
  `container-type: inline-size` and has a `@container
  (max-width: 340px)` rule that hides every `.qa-btn-label`
  inside it — so the label collapsed to icon-only in the QA
  panel (which is ~300px wide). The "Enter select mode" button
  sits inside `.qa-bulk-toggle-row` and dodges the rule; the
  reopened row did not.
- 🩹 **Fix — dedicated wrapper**. Introduced `.qa-reopened-row`
  (plain flex, no container query) so the *Get Reopened Issues*
  label stays visible at every panel width.

---

## Version 6.5.11

### Show Reopened Issues: label goes inside the button
- 🏷️ **Renamed button label** to **"Get Reopened Issues"** and
  moved it back inside the button next to the icon, matching
  the style of the "Enter select mode" bulk-close button. The
  separate `.qa-reopened-hint` span introduced in 6.5.9 is gone
  — one clear call-to-action instead of a button + external
  label.
- 🧹 Dropped the now-unused `.qa-reopened-actions` /
  `.qa-reopened-hint` CSS from both `content.css` and the
  userscript so the stylesheet stays lean.
- 🔁 Updated the `finally` block's fallback text so the label
  restores to *"Get Reopened Issues"* after a scan.

---

## Version 6.5.10

### Show Reopened Issues: partial-sync warning strip
- ⚠️ **New amber "Partially synced" warning** rendered below the
  button whenever the last scan of the current sprint hit the
  3-minute wall-clock cap. Text: *"Partially synced. Please
  sync again to get remaining issues."* Hidden automatically
  once a subsequent scan completes cleanly. Dark-mode variant
  included.
- 🧩 **Wired at every scan outcome** via a small
  `updateReopenedWarn(result)` helper — invoked after fresh
  scans, resume passes, and cache-hit-complete short-circuits
  — so the strip is always in sync with the actual state of
  the cache. `role="status"` so screen readers announce it
  after each pass.

---

## Version 6.5.9

### Show Reopened Issues: label + full subjects
- 🏷️ **"Get Reopened Issues" hint text beside the button** in the
  QA panel so the action is discoverable even when the button
  chrome is scanned quickly. Rendered as a subtle muted-tone
  label to the right of the button; wraps under the button on
  narrow panels.
- 📝 **Long subjects render in full inside the reopened-issues
  modal**. The shared `.qa-modal-list-subject` rule clamps to
  two lines with an ellipsis (correct for the bulk-close
  confirmation preview), but that hid useful context in the
  reopened list. Scoped override under `#qa-reopened-modal`
  disables the line-clamp, drops the ellipsis, and switches the
  row `align-items` to `flex-start` so multi-line titles keep
  the id + status badge visually anchored.

---

## Version 6.5.8

### Show Reopened Issues: polish pass
- 🔄 **Spinner rotation direction fixed**. The `rotate-ccw`
  Feather icon shows an arrow curving counter-clockwise, but the
  `qa-btn-spin` keyframe was rotating it *clockwise* — which
  looked broken (arrow pointing one way, motion the other).
  Flipped the animation to `-360deg` so the icon spins in the
  direction it visually points.
- 🔢 **Total-reopened counter** shown as a pill badge next to
  the "Reopened issues" modal title, e.g. **Reopened issues [8]**.
  Uses `rows.length` so it always matches what's rendered (Phase
  A + Phase B combined). Auto-hides when the count is zero.
- 📏 **Modal is ~2× taller**. `#qa-reopened-modal .qa-modal` now
  has `min-height: min(720px, calc(100vh - 64px))` and the
  scrollable list `min-height: 360px` with no `max-height`
  ceiling, so about 15 rows are visible before the user needs
  to scroll. Modal width nudged from 440px to 520px to keep the
  aspect ratio comfortable.

---

## Version 6.5.7

### Show Reopened Issues: resume-on-reclick + faster scan
- 🐛 **Fixed the "re-click just re-shows the same partial modal"
  bug**. In 6.5.6 the timed-out result was cached and every
  subsequent click read straight from that cache, so users could
  never make progress past the first 168-of-347 pass. The modal
  even *told* them to "re-run to continue" but the code did the
  opposite.
- 🧭 **Fix — full resume support**. `fetchReopenedIssues` now
  returns a checkpoint snapshot (Phase-A hits, the full candidate
  list, the set of already-scanned ids, and the historical
  matches found so far) whenever it times out. The click handler:
  - **Skips the cache** when the cached result is a partial one,
  - **Passes it as `prevPartial`** to the next fetch, and
  - The fetch **reuses Phase A + Phase B** and only journal-scans
    the candidates whose ids aren't in the prev-scanned set.
  Each click chips a further 3-minute chunk off the remaining
  work until the whole sprint is scanned. No wasted HTTP,
  historical hits accumulate across passes.
- ⚡ **Faster per pass**: journal-scan concurrency bumped
  `8 → 12`, wall-clock cap bumped `2 min → 3 min`. On the
  reported 347-issue sprint this fits the whole scan in roughly
  two clicks instead of "forever".
- 💬 **Better modal copy** on partial results — no more misleading
  "re-run to continue where the cache leaves off" (which was
  literally impossible in 6.5.6). Now reads *"Partial result:
  scanned N of M sprint issues so far. Close and click the button
  again to resume where this pass left off."*
- 🩺 **New console log** `[QA Assistant] Cache hit (partial) —
  resuming scan from X / Y` so you can see the resume path is
  being taken.

---

## Version 6.5.6

### Show Reopened Issues: modal now actually appears
- 🐛 **Fixed the modal being invisible when the scan finished
  successfully** — reported from a 347-issue sprint where the
  console logged `openReopenedModal rows = 8` but nothing
  visible showed up. Setting `hidden=false` alone wasn't
  enough: `.qa-modal-overlay` has `opacity:0` baked into its
  base rule (for the fade-in transition), and only becomes
  visible when the `.qa-modal-open` class is added on the
  next animation frame. The bulk-close modal already did
  this; the reopened modal was missing both steps.
- 🧭 **Fix — mirror the bulk-close open/close dance exactly**:
  - `openReopenedModal`: reset `className`, mirror the panel's
    `qa-dark` + `qa-accent-*` classes onto the detached
    overlay (CSS custom props on the panel don't cascade to
    `<body>`-mounted overlays), set `hidden=false`, then
    `requestAnimationFrame(() => classList.add("qa-modal-open"))`
    so the opacity transition animates from 0→1 instead of snapping.
  - `closeReopenedModal`: `classList.remove("qa-modal-open")`
    to trigger the fade-out, then `setTimeout(180ms)` before
    `hidden=true` so the transition can play.
- 🩺 **New console log** `[QA Assistant] openReopenedModal
  rows = N` confirms the modal open path was taken, so future
  "invisible modal" reports can be triaged in one glance.

---

## Version 6.5.5

### Show Reopened Issues: spinning-icon loader on the button
- ✨ **The button's `rotate-ccw` icon now spins as a loader while
  the sprint scan is running.** Large sprints (100–350+ issues)
  can take upwards of 30–60 seconds to journal-scan; the label
  already updated with "Scanning X of Y…" progress, but there was
  no ambient "still working" cue and the button *felt* dead. A
  0.9 s linear-infinite rotation on `.qa-btn-icon` — plus a
  `cursor:progress` and slightly dimmed label — makes the
  in-flight state unmistakable at a glance.
- 🎨 **Implementation**: pure CSS keyframe animation (`@keyframes
  qa-btn-spin`) triggered by a `.qa-loading` class the click
  handler toggles on/off around the `fetchReopenedIssues` await.
  No JS animation loop, no image swap — just a class flip in the
  same `finally` block that restores the label and the disabled
  state, so every exit path (success, empty result, error, cache
  hit) cleans up identically.

---

## Version 6.5.4

### Show Reopened Issues: paginate + higher concurrency + hard time cap
- 🐛 **Fixed the button appearing frozen on large sprints** (report
  after 6.5.3). Diagnostics from a 347-issue sprint showed we only
  ever fetched the first 100 rows (Redmine's `per_page` cap) and
  the follow-up journal scan at 5-concurrency was slow enough that
  the button *felt* dead — no visible change for a minute or more.
- 🧭 **Fix — three changes to `fetchReopenedIssues`**:
  - **Paginate** both Phase A and Phase B sprint-list queries.
    We now loop `?page=1..N` until we've pulled every row Redmine
    says exists (safety cap at 20 pages = 2 000 issues). A
    347-issue sprint now scans all 347, not just the first 100.
  - **Bump journal-scan concurrency** from 5 to 8 parallel
    `/issues/<id>` fetches. Faster wall-clock time without
    hammering Redmine hard enough to trip a WAF.
  - **Hard 2-minute wall-clock cap** on the journal scan.
    If a really huge sprint (or a slow Redmine) blows through
    the budget, we return what we scanned so far and flag the
    partial result in the modal footer — a partial answer is
    strictly better than a silent freeze.
- 🩺 **More granular diagnostics** in the browser console:
  per-page pagination counts, per-batch scan timings, running
  hit counts, and a final scan-duration summary. If the scan
  ever feels slow again the console immediately shows *why*.
- 📄 **Modal footer** now distinguishes between "list capped"
  (Redmine returned fewer rows than expected) and "scan timed
  out" (2-minute cap tripped) so the truncation reason is
  transparent.

---

## Version 6.5.3

### Show Reopened Issues: hardcode the known status id + add diagnostics
- 🐛 **Fixed the "pressing the button does nothing" report from
  6.5.2**, where the click seemed silent — no modal, no toast,
  no visible change on some boards. The regex-only scan in
  6.5.2 still relied on parsing every sprint issue's journal
  page, and on larger sprints the wait was long enough (or
  transient errors were swallowed quietly enough) that users
  couldn't tell whether the button had done *anything*.
- 🧭 **Fix — two-phase query with a hardcoded status id.** The
  user confirmed the `Development: Reopen` status is id `8`
  on every Redmine instance this extension targets, so we now:
  - **Phase A**: run one direct filter query
    (`?f[]=status_id&op[status_id]==&v[status_id][]=8` + version
    filter) to list every issue *currently* sitting in Reopen.
    One HTTP call, no per-issue scan, near-instant.
  - **Phase B**: pull the full sprint list (all statuses),
    subtract the Phase-A hits, and journal-scan only the
    remainder for a historical status change into Reopen
    (still by regex, so future renames won't break it).
- 🩺 **Diagnostics**: every branch of the click handler now
  logs to the browser console with a `[QA Assistant]` prefix —
  wire-time confirmation, click detected, board scope, cache
  hit, each Redmine `GET` URL, per-phase counts, journal-scan
  progress, and any error. If the button ever appears silent
  again, open DevTools → Console and the failure mode is
  immediately visible.
- ✅ **User-visible copy** ("Development: Reopen") is
  unchanged; the id is used only for the fast Phase-A query.

---

## Version 6.5.2

### Show Reopened Issues: drop the brittle pre-flight status lookup
- 🐛 **Fixed the "Couldn't find the 'Development: Reopen'
  status" toast reported after 6.5.1**, where the button refused to
  scan at all on boards whose bulk_edit form (or column headers)
  didn't surface the reopen status name in the shape the lookup
  expected.
- 🔎 **Root cause**: Redmine's `/issues/bulk_edit` status dropdown
  is *workflow-gated* by the picked issue's tracker + the current
  user's role — so the "Reopen" option only appears there when the
  chosen ticket can legally transition to it. Boards where the
  first available card was in a status that can't transition to
  Reopen returned an empty option list from the fallback, and the
  column-header lookup used `startsWith` which was too strict for
  Agile plugin headers that prefix icons/toggles to the text.
- 🧭 **Fix**: dropped the pre-flight status-id lookup entirely.
  Since 6.5.1's journal-scanner already matches by *name*, the id
  is unused — so we now go straight to the sprint-list + journal-
  scan pass without any workflow-gated dropdown call. Matching
  loosened to a regex `/reopen/i` against both the current status
  column and the journal's new-status value, so "Development:
  Reopen", plain "Reopen", "QA: Reopen", or any future variant
  are all caught equally.
- 📄 **Panel copy** still references "Development: Reopen" (button
  title, modal lede) because that's the canonical name on the
  CloudApper Redmines the extension targets; the regex is only used
  for internal matching.

---

## Version 6.5.1

### Show Reopened Issues: actually finds them now
- 🐛 **Fixed the "No reopened issues on current board" false
  negative reported after 6.5.0**, where boards with real
  history of reopened-then-closed issues were reporting empty.
- 🔎 **Root cause**: Redmine's issue query DSL has no "was ever
  in status X" filter operator. The `op[status_id]=w` I used
  turns out to be a *date* operator ("this week") in Redmine
  core — applied to `status_id` it silently returns no rows.
  No plugin-free URL filter equivalent exists.
- 🧭 **New approach**: pull the full sprint issue list (all
  statuses, `per_page=100`), then for every issue *not* currently
  at *Development: Reopen* open its `/issues/N` HTML page and
  scan `#history ul.details li` for a status change whose
  new-value equals the target status name. Slower but reliable
  across Redmine 4.x/5.x with no config or REST API dependency.
- ⚡ **Bounded parallelism**: journal fetches run 5 at a time to
  avoid throttling. The button label updates with progress
  (`Scanning N of M…`) so the wait doesn't look hung. Results
  are cached per-sprint until you navigate, same as before.
- 📊 **Truncation notice**: if the sprint has more than 100
  issues (Redmine's per-page cap on the HTML list endpoint), the
  modal shows "Scanned first N of M sprint issues" so it's clear
  the result set is bounded.
- 📄 **Locale**: history scanner keys off the English word
  "Status" as the property label — matches the rest of the
  extension's English-only scope (README + package).

---

## Version 6.5.0

### New: Show Reopened Issues button on Agile boards
- 🔁 **Added a new *Reopened issues* section to the panel, revealed
  only on Agile board pages, with a single **Show Reopened Issues**
  button.** Clicking it lists every issue in the current sprint that
  is either currently in *Development: Reopen* status or has ever
  passed through that status at any point in its history — the
  common "was this ticket reopened before?" question answered in one
  click, without opening each issue's Journal tab.
- 🎯 **Section placement**: in its own section directly below Bulk
  Close, above the Agile Boards row, so the read-only "audit" action
  sits next to the write action that changes statuses en masse.
- 🧠 **How it works**: the button queries Redmine's HTML issue-list
  endpoint with the `op[status_id]=w` ("was ever") filter operator
  and the sprint's `fixed_version_id`, then parses the returned
  `<tr>` rows. Same session-authenticated HTML approach as bulk
  close (no `WWW-Authenticate: Basic` prompts), and the reopen
  status id is discovered from the board's own column headers (or
  the bulk_edit form as fallback) so no per-instance hardcoded id.
- 📋 **View-only modal**: results open in a bulk-close-style
  overlay listing each issue with its number (linking to
  `/issues/N` in a new tab), subject, and current status. No
  confirm button, just close. Toast "No reopened issues on current
  board" if the query returns zero rows. Result set cached
  per-sprint until you navigate, so repeat clicks are instant.

---

## Version 6.4.5

### Bulk close: the "Leave site?" prompt is actually gone this time
- 🎯 **Fixed the "Leave site? Changes you made may not be saved."
  prompt that still appeared after 6.4.4's fix.** The 6.4.4 defuser
  strategy (let Redmine's `warn_leaving_unsaved` handler run, then
  reset `event.returnValue` in a later listener) only works when the
  cancelling handler *sets* `returnValue` — it can't undo a
  `preventDefault()` call, and it turned out at least one script on
  the Redmine instance was cancelling the event that way.
- 🛡️ **New approach: a main-world guard installed at `document_start`
  that intercepts every beforeunload registration on `window`.** By
  wrapping `EventTarget.prototype.addEventListener` and the
  `window.onbeforeunload` property setter *before* Redmine's own JS
  loads, the guard captures every listener that anyone binds —
  Redmine core, the Agile plugin, jQuery's `warn_leaving_unsaved`,
  everyone. Before firing `location.reload()`, `qaSafeReload()`
  detaches all of them via the original native `removeEventListener`,
  so no cancelling handler is left to fire and the browser reloads
  silently.
- 📦 **Chrome extension**: new `beforeunload-guard.js` runs in the
  page's main world at `document_start` (via a new `content_scripts`
  entry with `"world": "MAIN"`). content.js triggers it by
  dispatching a `qa-safe-reload` CustomEvent on window, which crosses
  the isolated ↔ main world boundary.
- 📜 **Userscript**: added `@run-at document-start` and inlined the
  guard at the top of the IIFE. Reload the userscript from your
  userscript manager after updating so the new run-at kicks in.
- 📦 **Packaging**: `package-extension.ps1` now includes the new
  guard file (and `background.js`, which had been silently missing
  from the ZIP artifact — the AI features wouldn't have worked at
  all on installs from the packaged ZIP).

---

## Version 6.4.4

### Bulk close: auto-refresh the board after dismissing the modal
- 🔄 **The Agile board now reloads automatically after you dismiss
  the confirmation modal** (Cancel, X, or Close window). 6.4.3 only
  removed the closed cards from the DOM, which handled visible
  correctness but left column counters, sprint totals, and other
  Redmine-derived widgets stale until you refreshed manually.
- 🗑️ **The "Leave site?" prompt still doesn't appear.** New approach:
  instead of trying (and failing) to strip Redmine's beforeunload
  handler ahead of time, we let it run and *defuse* the event
  afterwards. `warn_leaving_unsaved.js` sets `event.returnValue` to a
  warning string but never calls `preventDefault()`, and the browser
  only prompts when `returnValue` is non-empty at the end of dispatch.
  So we register a defuser listener — which runs last, because window
  listeners fire in registration order — that resets `returnValue` back
  to `""`. Combined with the existing `.onbeforeunload = null` and
  jQuery `.off("beforeunload")` calls, that's enough to reach
  `location.reload()` without the browser interrupting.
- 🛡️ **Safety net:** cards and select mode are cleared *before* the
  reload fires. So on the off chance a future Redmine plugin binds a
  beforeunload handler that does call `preventDefault()`, dismissing
  the resulting prompt still leaves the board in a correct state.

---

## Version 6.4.3

### Bulk close: dismissing the modal no longer shows "Leave site?"
- 🗑️ **Fixed the browser "Leave site? Changes you made may not be
  saved" prompt that appeared when clicking Cancel or Close window on
  the bulk-close confirmation modal.** After a successful close batch,
  `closeBulkModal()` used to call `location.reload()` so the Agile
  board would repaint without the closed cards. That reload fires
  Redmine's `warnLeavingUnsaved` beforeunload handler (plus the Agile
  plugin's ajaxComplete-installed guard). 6.3.x tried to defuse those
  handlers with a capture-phase `stopImmediatePropagation()` and
  `delete event.returnValue`, but on `window` targets Redmine's
  bubble-phase handler still runs first and there's no reliable way to
  un-cancel a `BeforeUnloadEvent` once `returnValue` has been assigned.
- ✂️ **Now removes the closed cards from the Agile board DOM directly
  instead of reloading.** We already know which issue IDs closed
  successfully (from the per-issue progress loop) and we already have
  DOM references to their cards (from select-mode bookkeeping), so
  removing the cards achieves the same visible result as a reload —
  with no navigation, no `beforeunload` dispatch, and no browser
  prompt. Failed rows stay on the board with their original status so
  the user can retry them individually.

---

## Version 6.4.2

### Bulk close: no more per-issue username/password prompt
- 🔐 **Fixed the browser credential dialog that popped once per
  issue during bulk close.** In 6.4.0/6.4.1 the per-issue update went
  through Redmine's JSON REST API (`PUT /issues/N.json`). On Redmine
  instances where the REST API is disabled — or where session-cookie
  auth is rejected for the JSON API — that endpoint answers `401` with
  a `WWW-Authenticate: Basic realm="Redmine API"` header, and Chrome's
  fetch stack responds by popping the browser's Basic Auth dialog
  once for every issue in the batch. Closing 10 issues meant
  dismissing 10 credential prompts.
- 🔁 **Now posts to the HTML form endpoint Redmine's own edit form
  uses** (`POST /issues/N` with `_method=put`, CSRF token, session
  cookie). Session-authenticated, no basic-auth challenge, no dialog.
  Progress reporting stays per-issue and success/failure detection is
  actually more robust — Redmine 302s on success, re-renders the edit
  form with an `#errorExplanation` block on validation failure, so
  each failed row now surfaces Redmine's own error text instead of a
  bare HTTP status.
- 🚪 **Session-expired detection.** If the request follows a
  redirect to `/login` the issue is marked failed with "Session
  expired — reload Redmine and sign in again" rather than being
  reported as closed.

---

## Version 6.4.1

### OpenAI key moved to extension-isolated storage
- 🔒 **The OpenAI API key no longer lives in Redmine's `localStorage`.**
  Previously the key was stored under `qa-openai-key` on the
  `redmine.kernello.com` origin, which meant any script that ran on the
  page — a Redmine XSS, a compromised plugin, or any other Chrome
  extension with content-script access to Redmine — could read it with a
  single `localStorage.getItem` call. The Chrome extension now stores the
  key in `chrome.storage.local` (extension-isolated, separate LevelDB per
  extension id; unreachable from page scripts) and the userscript now
  stores it via `GM_getValue` / `GM_setValue` (userscript-manager
  isolated storage).
- 🔁 **Automatic migration on first load.** Any key that a pre-6.4.1
  build wrote to page-origin `localStorage` is moved into the isolated
  store on first read and then wiped from `localStorage`, so leaving a
  copy behind can't defeat the new isolation. No user action required —
  reload Redmine after installing 6.4.1 and the key that was already
  saved keeps working.
- 🧩 **Extension permission added: `"storage"`.** Chrome will show a
  one-time "This extension has been updated and now requires new
  permissions: **Store client-side data**" prompt on the first update.
  Grant it — the extension can't read/write your key without it.
- 📜 **Userscript grants added: `GM_getValue` / `GM_setValue` /
  `GM_deleteValue`.** Tampermonkey / Violentmonkey will show the usual
  "new permissions required" dialog on first update; accept it. If you
  install the raw `.user.js`, your userscript manager handles this
  automatically.

---

## Version 6.4.0

### Bulk close: live per-issue progress + no more "Leave site?" prompt
- 📊 **Live progress bar and per-row status.** Clicking **Close them**
  in the confirmation modal now shows a progress row with a spinner,
  a running counter (`3 of 10 closed…`), and a fill bar that updates
  after every issue. The modal **stays open** when the loop finishes
  so you can review every row — successful issues get a green
  *closed* badge, failures get a red *failed* badge **plus the exact
  error message Redmine returned** (`Status is invalid`,
  `Version can't be blank`, `HTTP 403`, …) rendered inline under the
  issue's subject in italic red. The Close button relabels to *Close
  window* and dismissing the modal reloads the board so closed cards
  actually disappear.
- 🔌 **Per-issue JSON API instead of the batch endpoint.** Under the
  hood the panel now calls `PUT /issues/:id.json` once per selected
  issue instead of a single `POST /issues/bulk_update` for the whole
  batch. The batch endpoint responds with `302 → /issues` even when
  Redmine silently dropped rows (permission, workflow rule, missing
  required field), so failures used to disappear into a
  false-positive success toast. The JSON endpoint returns real
  `200`/`204` on success and structured `422` errors on failure, which
  is what powers the accurate per-row status.
- 🔇 **No more browser reload confirmation prompt.** Redmine and the
  Agile plugin install `warnLeavingUnsaved` guards on board forms
  that used to fire when we reloaded after saving — the browser
  showed *"Leave site? Changes you made may not be saved."* every
  time (especially for larger batches, where the plugin's
  ajaxComplete hooks had a chance to re-attach the guard between
  saving and reloading). The panel now defuses the guards
  immediately after the close loop, again right before the reload,
  and installs a capture-phase safety net that cancels any handler
  Redmine adds in between. Silent reload for every batch size.
- ⏸️ Both the confirm and cancel buttons lock while the close loop
  is running — you can't dismiss the modal mid-flight and end up
  with a half-closed batch you can't see.

---

## Version 6.3.0

### A little levity in the header
- 🚀 **Hover the rocket for a random pep talk.** The rocket icon
  in the panel header now hosts a small comic-style *thought bubble*
  that pops out on hover with one of six deliberately-mediocre
  motivational quotes ("You can do it. Maybe.", "Be unstoppable.
  After coffee.", …). A fresh quote is picked on every hover, the
  rocket does a little lift-off tilt while the bubble is open, and
  the bubble lingers if you drift your cursor onto it. Pure fluff
  — no state, no storage, no network calls.

---

## Version 6.2.1

### Bulk close: workflow pre-flight + smarter dropdown scrape
- 🧪 **Pre-flight workflow check.** Ticking a card in select mode now
  quietly asks Redmine (once per source status) whether *Closed* is a
  legal transition from that status. The confirmation modal shows a
  per-row badge for every card that would be **skipped** —
  *already closed* or *workflow blocks* — plus a summary line
  (`3 will close · 1 already closed · 2 blocked by workflow`).
  The submit button relabels to *Close N issues* using the real
  count, and the POST only sends cards that will actually change, so
  the toast and reload numbers match what the user confirmed.
- 🚦 **"Couldn't find 'Closed' status" false alarm fixed.** When the
  first-ticked card was in a column whose current status has no
  direct *Closed* transition (e.g. *New*), Redmine's `bulk_edit`
  form hid the *Closed* option from its status dropdown and the
  scrape blew up. The panel now falls back to the Agile plugin's
  own column headers (`th[data-column-id]`), which always render
  regardless of workflow rules, so the closed-status id is picked
  up reliably.

---

## Version 6.2.0

### Bulk close from the Agile board
- 📈 **Close many issues at once, right from the board.** A new
  *Close multiple issues* section appears in the panel on any
  `/projects/<x>/agile/board` page. Click **Enter select mode** and
  every card on the board grows a small checkbox in its top-right
  corner — tick as many as you need, then close them all in one
  round-trip to Redmine.
- 🏷️ **Same closed-version + note flow as the single-issue close.**
  Pick a closed version from the dropdown and the note textarea
  auto-fills with the standard project template. Edit the wording
  freely; whatever's in the textarea is what every closed issue will
  receive as a comment.
- 🧾 **Custom confirmation modal.** Clicking *Close N issues…* opens
  a themed modal that lists every ticked issue by ID and subject,
  shows the picked version and the exact note that will be posted,
  and offers *Cancel* / *Close them* buttons. No irreversible clicks
  without a full preview.
- 🔌 **Uses Redmine's own bulk-update endpoint.** The panel POSTs to
  `/issues/bulk_update` with the same fields Redmine's built-in *Edit*
  batch action uses (status, closed-version custom field, note),
  authenticating with the page's session cookies + CSRF token. No
  extra permissions or API keys required.
- 🔄 **Reloads the board on success** so the closed cards actually
  disappear — no stale UI.
- 🎨 The modal picks up the panel's dark-mode + accent-colour theme
  automatically.

---

## Version 6.1.2

### Description Source narrowed to the New-issue page
- 🎯 **Section only shows where it actually works.** The
  *Step 3 · Description source* section (template editor + AI
  assistant + Fill / Copy / Clear buttons) previously appeared on
  every Redmine page. On issue detail views, issue lists, project
  overviews and My page there was no `#issue_subject` /
  `#issue_description` to act on, so the buttons were dead weight.
  It's now gated behind a new `isNewIssuePage()` check that matches
  `/issues/new` and `/projects/*/issues/new` — the only pages where
  the form exists.
- 🧹 **Cleaner panel on non-form pages.** On an issue detail page
  you now see just the report launcher, agile boards row, and
  *Close this issue* section — no unused template editor taking
  up space.
- 🔨 The wiring for the template editor + AI panel is skipped
  entirely when the section isn't rendered, so no wasted event
  listeners on pages that don't need them.
- ✅ The *Close this issue* section still renders on every Redmine
  page and self-reveals only on `/issues/<n>` — unchanged.

---

## Version 6.1.1

### Editable close-issue note
- ✏️ **The auto-generated close note is now editable in place.** The
  preview `<div>` was upgraded to a `<textarea>` so you can tweak the
  wording before hitting Fill or Close — add extra context (device,
  build, tester name), rewrite the sentence, or paste from another
  source. Both **Fill only** and **Close issue** now send whatever text
  is in the panel, not the auto-generated default.
- 🔄 **Version change regenerates the note** so switching versions
  always gives you a fresh, correct baseline for the newly picked
  version. If you had already edited the text, changing the version
  overwrites your edit — a predictable trade-off that keeps stale
  version names from silently sneaking into your note.
- 🚫 **Blank-note guard.** Fill / Close automatically disable if you
  empty the textarea, so an accidental delete-all can't submit a close
  with no note.
- 🔨 Small refactor: `fillCloseFields(versionValue, noteText)` now
  takes the note string directly instead of composing it internally.
  The `buildCloseNote(project, version)` helper remains the default
  generator, called only when the version changes.

---

## Version 6.1

### Close an issue straight from the panel
- ✅ **New "Close this issue" section** appears at the bottom of the panel
  whenever the current page is a Redmine issue detail view
  (`/issues/<n>`). Stays hidden on the New-issue form, on agile boards,
  and on the launcher host (`dev.cloudapper.com`) — so it only surfaces
  where it's actually useful.
- 🏷️ **Closed-version picker mirrors the page's own dropdown.** The
  section reads the options from Redmine's `Closed Version` custom
  field (`issue[custom_field_values][12]`) at panel init, so you're
  picking from the exact same list Redmine would offer under Update.
  No hard-coded version list — new sprints/versions show up
  automatically as soon as they exist in Redmine.
- ✍️ **Live note preview** updates as you pick a version. Format:
  `Issue resolved. Tested in <Project> — <Version>.` The em dash keeps
  the sentence readable even when the version label already contains
  the app name (e.g. "Web — Web App Sprint v10.0.0" instead of the
  awkward "Web Web App Sprint v10.0.0"). Project short-name is derived
  from Redmine's own `body.project-<identifier>` class so it stays
  correct even if you navigate through several projects in one
  session.
- 🔏 **Two-step safety by default.** The section ships two buttons:
  - **Fill only** — sets Status → Closed, Closed Version → your pick,
    and Notes → the auto-generated message. Reveals Redmine's Update
    panel so you can eyeball what was filled, then click Submit
    yourself.
  - **Close issue** — same fill, then clicks the form's Submit button
    for you. One click to close.
- 🚫 **Both buttons stay disabled until a version is picked**, so an
  accidental click can't close an issue with no version recorded —
  matching the design constraint we agreed on up front.
- 🎨 **Themes for free.** The section uses the same tokens as the rest
  of the panel, so dark mode + every accent (Ocean blue / Lavender /
  Sunset orange / Soft red) style it correctly on day one — no extra
  colour rules needed.
- ⚙️ **Robust status lookup.** Status is set by option *text* ("Closed")
  rather than by hard-coded numeric id, so the feature keeps working
  across Redmine installs that renumber statuses.
- 🔐 **Zero new permissions.** Everything runs on DOM the panel already
  has access to; no manifest changes.

---

## Version 6.0

### Accent colour picker in the header
- 🎨 **New palette button** in the panel header opens a small popover with
  four colour swatches: **Ocean blue** (the current default), **Lavender**,
  **Sunset orange**, and **Soft red**. Click a swatch and the panel
  re-themes instantly — tracker/project card hover & selection states,
  section-label accent bars, focus rings, all buttons, the AI-key input
  focus, board hover chips, and the header gradient all pick up the new
  colour. Choice is persisted in `localStorage` under the `qa-accent`
  key.
- 🌓 **Works in both light and dark mode.** Each accent has a bright,
  saturated light-mode variant and a softer pastel dark-mode variant, so
  toggling the moon/sun icon preserves the accent while still hitting
  the right contrast for each surface.
- 🧩 **Zero refactor — pure token override architecture.** The picker
  works because every rule in `content.css` already reads its colour
  from `--qa-brand`, `--qa-brand-hover`, `--qa-brand-strong`,
  `--qa-brand-tint`, `--qa-brand-active-bg`, and
  `--qa-brand-focus-ring`. Each accent is just a class
  (`#qa-panel.qa-accent-lavender`, etc.) that overrides that six-token
  cluster — same pattern the dark mode toggle already uses.
- ⚖️ **Header gradient now auto-tracks the accent.** Previously the
  `--qa-header-bg` linear-gradient hard-coded `rgba(25,118,210,.88)`
  (blue). Switched to
  `color-mix(in srgb, var(--qa-brand) 88%, transparent)` so the header
  re-tints itself with zero per-theme boilerplate.
- 🏷️ **AI purple stays purple.** The AI-mode identity colour
  (`--qa-accent`) is deliberately independent of the brand accent, so
  Structure/Reset Chat and the AI review pane keep their purple
  identifier no matter which brand colour you pick.
- ⌨️ **Accessible:** the popover has `role="menu"`, each swatch has an
  `aria-label`, the palette button toggles `aria-expanded`, and
  <kbd>Esc</kbd> closes the popover and returns focus to the button.
- 🔒 **Backwards-compatible.** Users upgrading from 5.47 have no
  `qa-accent` key set, so `getAccent()` falls back to `"blue"` — the
  panel looks *exactly* as it did before until they open the picker.

### Bug fixes
- 🐛 **Palette popover now actually renders.** In the first cut the
  popover was `position: absolute` but its parent `.qa-header` had no
  `position` set, so the popover anchored to `#qa-panel` instead — and
  the panel's `overflow: hidden` clipped it out of sight. Added
  `position: relative` on `.qa-header` so the popover positions
  correctly just below the palette button.
- 🐛 **Project + board button labels no longer stay blue** when the
  accent is changed. Root cause: `.qa-project-card` and `.qa-board-btn`
  are `<a>` tags, and their `color: var(--qa-text)` declaration has
  specificity `(0,1,0)` — which lost to Redmine's own `a { color: ...
  }` leaking into the panel. Added a scoped `#qa-panel a { color:
  var(--qa-text) }` rule (specificity `(1,0,1)`) so anchor labels
  follow the theme text colour. Icons inside remain `--qa-brand` and
  keep swapping with the accent.
- 🐛 **Palette popover now opens when the panel is collapsed.**
  Previously the popover was an absolutely-positioned child of
  `.qa-header`, and when the panel was collapsed to a 44 px pill the
  popover extended below the panel bounds and got clipped by
  `#qa-panel { overflow: hidden }`. Even switching it to
  `position: fixed` didn't help — the panel's `backdrop-filter` promotes
  it to a containing block, so *fixed* descendants get clipped too.
  **Fix:** on panel init the popover is moved into `document.body` via
  `appendChild`, and JS sets its `top` / `right` inline from the palette
  button's `getBoundingClientRect()` each time it opens. The popover
  now renders correctly whether the panel is expanded, collapsed
  horizontally, or resized. Also switched the "click outside" listener
  to `mousedown` so a header drag also closes the popover (otherwise it
  would stay at stale coordinates while the panel moved).
- 🐛 **Palette popover now has the correct light/dark background.**
  Side-effect of moving the popover to `document.body` in 6.0.2: it
  stopped inheriting the panel's CSS custom properties, so
  `var(--qa-surface)` and `var(--qa-border-strong)` resolved to unset
  — giving the popover a transparent background that let the page
  content bleed through as "black," especially when the panel was
  collapsed. **Fix:** the popover now defines its own baseline tokens
  (`--qa-surface`, `--qa-border-strong`, `--qa-brand`, `--qa-shadow`,
  `--qa-r-md`) directly on `.qa-accent-popover`, with
  `.qa-accent-popover.qa-dark` and `.qa-accent-popover.qa-accent-*`
  override blocks for the dark and accent variants. `applyTheme()` and
  `applyAccent()` now mirror the panel's `qa-dark` and `qa-accent-*`
  classes onto the popover element, so dark-mode and accent switches
  propagate to the detached popover.

---

## Version 5.47

### Improvements
- 🚀 The **header rocket icon** is now visible in the **vertical collapsed
  strip** too (previously it was hidden because `writing-mode:vertical-rl`
  rotated it). The icon now overrides `writing-mode:horizontal-tb` so it
  stays upright while the text stacks vertically.

---

## Version 5.46

### Improvements
- ✅ Removed the **680px minimum height** on the expanded Redmine panel. Users
  can now freely resize the panel smaller without limit (down to 180px, which
  keeps the header visible). The panel body scrolls internally so content
  stays accessible at any height.

---

## Version 5.45

### Bug fixes
- ✅ Fixed the **Show/Hide key** eye icon being invisible. The SVG inside
  `.qa-icon-btn` had no explicit dimensions and was collapsing to 0×0 because
  the button lacked the `.qa-btn-icon` wrapper that normally sizes SVGs. Added
  `.qa-icon-btn svg { width:14px; height:14px; display:block }` so the eye
  renders at a visible size.

---

## Version 5.44

### Bug fixes
- ✅ Fixed the **Show/Hide key** and **Save** buttons in the API key section
  being malformed (stretched/collapsed). The buttons now render as compact,
  auto-width pills at a consistent height. Root cause: the `.qa-tmpl-btn`
  base class had `flex:1 1 0` (for the 5-button actions row) which made the
  key buttons grow to fill the row, and `padding-top/bottom:0` collapsed them
  vertically. Fixed with `flex:0 0 auto`, proper padding, and
  `align-items:center` on the edit row.

---

## Version 5.43

### Redmine panel opens tall enough to show everything
- 📏 **`#qa-panel:not(.qa-launcher)` (Redmine expanded state) now has
  `min-height: 680px`.** Matches the same pattern used for the launcher
  (`min-height: 440px`) so the panel opens tall enough to show every
  section — tracker grid, project grid, agile boards row, description
  source (mode switch + AI/Template pane), and the version footer at
  the bottom — without any scrolling on first paint.
- ↕️ **Users can still resize taller** via the corner/edge handles; the
  680 px floor is a *minimum*, not a fixed height. `.qa-collapsed` and
  `.qa-docked` continue to override `min-height: 0 !important`, so the
  collapsed pill and docked strip keep their exact fixed dimensions.
- 📱 Capped by the existing `max-height: 96vh` on the base panel rule so
  the 680 px minimum shrinks to fit on shorter viewports (Chromebooks,
  smaller laptops, half-screen browser windows).

---

## Version 5.42

### Section headers levelled up
- 📑 **`.qa-section-label` promoted from caption\-weight to proper
  section\-break weight.** Font size 10 → 11 px, colour bumped from
  `--qa-muted` to `--qa-text`, letter\-spacing 0.6 → 0.9 px so the
  uppercase caps have room to breathe. Previously these headers
  ("Report an Issue", "Agile Boards", "Step 3 · Description source",
  "Review & edit before filling") read like faint labels; now they
  clearly separate the panel into distinct sections.
- 📊 **Accent bar upgraded.** The brand accent stripe next to every
  section header went from 3 × 12 px flat brand colour to 4 × 14 px
  with a subtle brand → brand-strong vertical gradient, giving each
  section title a stronger anchor point on the left edge.
- 📏 **Extra top margin between sections** (4 → 12 px) so consecutive
  sections don't visually blur into one another. A `:first-child`
  override keeps the very first section tucked up against the panel
  header without a redundant gap.
- 🧩 Substep labels (`.qa-report-substep` — the "Step 1 · choose a
  tracker" / "Step 2 · choose a project" lines nested inside *Report
  an Issue*) intentionally kept smaller and muted, so the two levels
  of hierarchy (section vs. substep) read cleanly.

---

## Version 5.41

### "Report an Issue" tracker chip alignment
- 📏 **`.qa-report-for` promoted from plain inline text to
  `inline-flex` + `align-items: center`.** The tracker icon inside it
  was hanging off the text baseline instead of centring against the
  label — same root cause as the tracker card fix in v5.39, but that
  fix only touched the cards, not the header line above them.
- 📌 **Wrapped the tracker name in its own `.qa-report-for-name`
  span** so `text-overflow: ellipsis` still works when the label is
  long (a flex child ignores the parent's overflow properties). Also
  dropped the raw space between the icon and the name — spacing is
  now `gap: 6px` on the flex parent.

---

## Version 5.40

### Project cards match tracker cards
- 🎯 **`.qa-project-card` now mirrors `.qa-tracker-card` exactly**:
  same `padding: 9px 9px 9px 12px`, `font-size: 14px`, `line-height: 1`,
  `gap: 8px`, and a 16×16 icon wrapper box. Previously projects used
  12 px text + 8 px padding + 14 px icons, so the two grids looked like
  they belonged to different UIs stacked together. They now read as
  visually identical rows of cards.
- 📏 **Compact Redmine board buttons keep their smaller 14 px icons.**
  Those buttons also drop the " Board" suffix and the ⇧N chip to fit
  four across in one row — pairing them with a 14 px icon keeps the
  four-across layout comfortable. Split rule so `.qa-project-emoji`
  gets 16 px while `.qa-board-emoji` stays at 14 px.

---

## Version 5.39

### Tracker card alignment fix
- 🐞 **Bug icon redrawn so its visible mass sits at the centre of the
  24×24 viewBox.** The original Lucide bug had antennae stretching to
  y=2 and legs curling all the way to y=21, so the icon's *bounding
  box* was centred by flex but the visible bug ended up below the text
  baseline. New version keeps antennae at y=5, body at y=7–18, legs at
  y=11–17 — the optical centre matches the geometric centre.
- 🔤 **Tracker card text bumped to 14 px** so the label matches the
  16 px icon's visual weight instead of looking undersized next to it.
- 📏 **Icon wrapper given an explicit 16×16 box.** Before, the flex
  row was centring a text line\-box against an SVG bounding box — two
  different height metrics, so the label sat a pixel or two low. Now
  both flex children have identical computed heights, so
  `align-items: center` produces a perfect line\-up.

---

## Version 5.38

### Icon + layout polish
- 🔤 **Tracker cards bumped to 13 px with `line\-height: 1`.** At 12 px
  the label sat slightly below the 16 px icon's optical centre; matching
  the icon's weight and killing the extra line\-height puts them on the
  same baseline.
- 🗂️ **"Step 3 · Description source" is no longer collapsible.** It's
  now a plain section label like *Report an Issue* / *Agile Boards*, so
  the mode switch + AI/Template pane are always visible when the panel
  is expanded. Removed the caret toggle button, the click handler, and
  the `qa-template-open` localStorage key.
- 🤖 **AI button uses a Copilot\-style `bot` icon** instead of the
  4\-point sparkle. It's the standard "AI assistant" glyph (rounded
  robot head with antenna + side ears + eye dots) and reads better
  paired with the Template mode's file\-text icon.
- 🔘 **"Change" button next to *API key saved* is now a compact chip.**
  Overrides `.qa-tmpl-btn`'s `flex: 1` so it doesn't stretch, tightens
  padding to `5px 10px`, and adds a subtle raised shadow + hover lift
  + active press so it visibly reads as a button.

---

## Version 5.37

### Icon polish (follow\-up to v5.36)
- 🚀 **Header rocket is white and stays visible when collapsed.**
  Previously it inherited `--qa-brand`, which made it fade into the
  brand\-tinted header bar. Now uses `--qa-on-brand` so it always reads
  as a crisp white glyph. Also unhidden in the horizontal collapsed
  strip — only hidden when the strip is rotated vertical (`writing\-mode`
  would rotate the SVG otherwise).
- 🎯 **Project card icons scaled down to 14 px** so they match the
  12 px label text next to them (icons at 16 px looked disproportionately
  large beside short labels like "Web" / "iOS"). Tracker cards keep
  16 px because their busier shapes need the extra room to stay legible.
- 📐 **Agile Boards row hides the button name when the panel is at
  minimum width** instead of truncating it to `"We…"`. The icon
  remains visible and the button's `title="…"` keeps the label
  discoverable on hover. Alt+Shift+1..4 shortcuts continue to work.
- 📏 **Vertical alignment cleanup on inline button icons.** Added
  `line\-height: 1` + `vertical\-align: middle` on the `.qa-mode-icon`,
  `.qa-btn-icon`, and `.qa-title-icon` wrappers so every icon sits
  perfectly centred against its sibling text node regardless of the
  parent's line\-height.

---

## Version 5.36

### Visual overhaul
- ✅ **Every panel emoji swapped for a real inline SVG icon.** Emoji
  glyphs picked up random OS colours and never matched the panel's
  frosted / brand-tinted look. The icon set is now a single `QA_ICONS`
  object of stroke-based SVGs (adapted from Lucide, MIT), all using
  `currentColor` + `stroke-width: 2` so they follow theme, hover, focus,
  and active state colours automatically.
- ✅ **Header** — `🚀` → outline **rocket**, tinted brand. Hidden in
  collapsed / vertical strip states so `writing-mode: vertical-rl`
  doesn't rotate it.
- ✅ **Description Source toggle** — AI = **sparkle** (4\-point star,
  signals *generative*), Template = **file\-text** (sheet with lines).
- ✅ **Template actions row** — 💾/↺/✍️/📋/🧹 → **save** (floppy),
  **rotate\-ccw** (undo arrow), **download** (arrow into tray, push\-into\-form),
  **copy** (double\-rect clipboard), **trash\-2** (bin with slits). The
  Clear button keeps its `qa-danger` red tint.
- ✅ **AI panel** — `🔑` → **key**, `✨ Structure` → **sparkles** (three
  stars), `🧹 Reset Chat` → **eraser** (so it's visually distinct from
  the template **Reset**), `⬇️ Fill Subject & Description` →
  **arrow\-down\-to\-line** (very literal push\-into\-baseline arrow),
  `⚠️` error bubble → **alert\-triangle**.
- ✅ **Trackers** — 🐞 Bug → **bug**, ✨ Feature → **star**, ✅ Task →
  **check\-square**, 📖 User story → **user**, 🧪 Test case → **flask**,
  💡 Suggestion → **lightbulb**.
- ✅ **Projects / boards** — 🌐 Web → **globe**, ⚙️ Backend → **server**,
  🍎 iOS → **smartphone**, 🤖 Android → the actual **Android robot**
  silhouette (dome + antennae + eye dots).
- 🧪 **Data shape change (safe internal refactor):** `TRACKERS[...]`
  now carries `icon: "<key>"` instead of `emoji: "<glyph>"`, and
  `PROJECTS[...]` gains an `icon` field with the `label` stripped down
  to plain text (`"Web"` instead of `"🌐 Web"`). All render sites and
  `reportFor` were updated to use `svgIcon(...)`.
- 🎨 New CSS sizing hooks: `.qa-title-icon`, `.qa-mode-icon`,
  `.qa-btn-icon`, `.qa-board-emoji` — all inline\-flex, 14–16 px SVGs,
  brand\-tinted for the identity chips (tracker / project / board /
  title) and `currentColor` for button icons so they follow state.

---

## Version 5.35

### Improvements
- ✅ **Board buttons on Redmine drop the ⇧N chips.** In the new one\-row
  Agile Boards layout the shortcut badges (⇧1 / ⇧2 / ⇧3 / ⇧4) were
  competing for space with the board name; they're now hidden via
  `#qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-btn kbd { display:none; }`.
  Each button is just the emoji + short name, so all four fit cleanly
  even at narrow panel widths. **Alt+Shift+1..4 still open the boards
  — the shortcut behaviour is untouched, only the visual chip is
  removed.** The launcher (dev.cloudapper.com, stacked layout) still
  shows the chips.

---

## Version 5.34

### Improvements
- ✅ **Agile Boards always visible + one\-row layout on Redmine.** The
  Agile Boards section no longer collapses. The ▸ toggle + caret are
  gone — the boards render directly under a plain **Agile Boards**
  label, so they're one click away instead of two. On Redmine the four
  board buttons now sit **side\-by\-side in a single row** (equal share,
  no wrapping); the redundant trailing " Board" word is dropped since
  the section title already says it. If the panel is dragged very narrow
  a container query ellipsizes each button's name so it degrades to
  emoji + `⇧N` chip instead of overflowing. `Alt+Shift+1..4` shortcuts
  are unchanged.
- ✅ **Launcher keeps the stacked layout.** On `dev.cloudapper.com` (any
  non\-Redmine host) the row rule is skipped via `#qa-panel:not(.qa-launcher)`,
  so board buttons stay full\-width and stacked with the original
  "🌐 Web Board" / "🖥️ Backend Board" wording — there's plenty of
  vertical room on the launcher and the wider tap targets are friendlier
  when the panel is used purely to jump into Redmine.

### Cleanup
- 🧹 Dropped the `#qa-boards-toggle` / `#qa-boards-caret` DOM and the
  `setBoardsOpen` handler. The `qa-boards-open` localStorage key is no
  longer written or read; existing values are harmless and can be
  ignored (they will be overwritten if the key is ever reused).

---

## Version 5.33

### Improvements
- ✅ **Template actions row is adaptive.** The five buttons under
  **Step 3 · Description source** — 💾 Save, ↺ Reset, ✍️ Fill,
  📋 Copy, 🧹 Clear — always sit side\-by\-side in a single row now:
  no wrapping onto a second line. Each button's text is wrapped in a
  `.qa-btn-label` span, and the row itself uses a CSS **container query**
  (`container-type:inline-size`) that hides the labels below ~340 px of
  row width. So when the panel is docked or dragged narrow you see
  icon-only chips with tooltips ("Save template", "Fill the issue form
  (Alt+F)", etc.); when you widen the panel the labels come back
  automatically. Every button carries a `title="…"` so the intent is
  always discoverable via hover, and the `Alt+F` / `Alt+C` / `Alt+X`
  shortcuts are unchanged.

---

## Version 5.32

### Improvements
- ✅ **Description Source consolidates all form actions.** The standalone
  **Actions** section (Fill / Copy / Clear) is gone. Those three buttons
  now live inside the **Step 3 · Description source** panel next to
  **Save** / **Reset**, so the entire "draft → fill" flow — pick a
  source, edit the draft, then Fill / Copy / Clear — sits in one row.
  The panel is shorter and the version footer is closer to the fold.
  `Alt+F` / `Alt+C` / `Alt+X` shortcuts are unchanged.
- ✅ **AI is the default source.** The Template / AI segmented toggle is
  swapped so **AI sits on the left** and is selected on first load
  (previously Template). Users who prefer the raw template can flip it
  once — the choice is still persisted per browser via `qa-ai-mode`.
  The sliding pill animation and accent tinting follow the new layout.
- ✅ **Template actions row wraps.** With five buttons in one row the
  `.qa-template-actions` container now wraps on narrow panel widths and
  each button grows to fill its slice, so labels stay readable when the
  panel is docked or resized.

---

## Version 5.31

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
