// ==UserScript==
// @name         QA Assistant for Redmine
// @namespace    QA
// @version      7.2.16
// @description  Report Redmine issues in any tracker with per-tracker templates, an AI report assistant, and a draggable/dockable panel.
// @match        https://redmine.kernello.com/*
// @match        https://dev.cloudapper.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      api.openai.com
// @run-at       document-start
// ==/UserScript==

(function () {

    'use strict';

    //////////////////////////////////////////////////////
    // beforeunload guard — installed at document_start so it can
    // intercept every beforeunload listener that Redmine core, the
    // Agile plugin, and jQuery's warn_leaving_unsaved bind on window
    // later. qaSafeReload() removes all of them before firing
    // location.reload(), so the browser doesn't pop a "Leave site?
    // Changes you made may not be saved" prompt when the bulk-close
    // modal auto-refreshes the board. Trying to defuse the event from
    // a later listener doesn't work: once a handler cancels the
    // BeforeUnloadEvent (returnValue non-empty OR preventDefault())
    // there is no way to un-cancel it from a subsequent listener.
    //////////////////////////////////////////////////////
    const __qaBufRegistry = new Set();
    let   __qaOnbufValue  = null;
    const __qaBufNativeDesc = Object.getOwnPropertyDescriptor(Window.prototype, "onbeforeunload");
    (function installBeforeUnloadGuard() {
        if (window.__qaBeforeUnloadGuardInstalled) return;
        window.__qaBeforeUnloadGuardInstalled = true;
        const origAdd    = EventTarget.prototype.addEventListener;
        const origRemove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, opts) {
            if (this === window && type === "beforeunload" && typeof listener === "function") {
                __qaBufRegistry.add({ listener: listener, opts: opts });
            }
            return origAdd.apply(this, arguments);
        };
        EventTarget.prototype.removeEventListener = function (type, listener, opts) {
            if (this === window && type === "beforeunload" && typeof listener === "function") {
                for (const entry of __qaBufRegistry) {
                    if (entry.listener === listener) __qaBufRegistry.delete(entry);
                }
            }
            return origRemove.apply(this, arguments);
        };
        try {
            Object.defineProperty(window, "onbeforeunload", {
                configurable: true,
                get() { return __qaOnbufValue; },
                set(v) {
                    __qaOnbufValue = v;
                    if (__qaBufNativeDesc && __qaBufNativeDesc.set) {
                        try { __qaBufNativeDesc.set.call(window, v); } catch (_) {}
                    }
                }
            });
        } catch (_) { /* older browsers may refuse — no-op fallback */ }
    })();

    function qaSafeReload() {
        const origRemove = EventTarget.prototype.removeEventListener;
        for (const entry of __qaBufRegistry) {
            try { origRemove.call(window, "beforeunload", entry.listener, entry.opts); } catch (_) {}
        }
        __qaBufRegistry.clear();
        try {
            __qaOnbufValue = null;
            if (__qaBufNativeDesc && __qaBufNativeDesc.set) __qaBufNativeDesc.set.call(window, null);
        } catch (_) {}
        try {
            const jq = window.jQuery || window.$;
            if (jq) jq(window).off("beforeunload");
        } catch (_) {}
        location.reload();
    }

    //////////////////////////////////////////////////////
    // CONFIG
    //////////////////////////////////////////////////////

    // Redmine origin. The panel also runs on the app under test (dev.cloudapper.com)
    // as a launcher, so Report Bug / board links must be absolute Redmine URLs.
    const REDMINE = "https://redmine.kernello.com";

    // Redmine renders the NEW issue form server-side for whichever tracker is in
    // the ?issue[tracker_id]=<id> query, so tracker-specific fields (e.g. Bug's
    // "Affected version") are present on load without any client-side AJAX reload
    // (which caused a stuck "Loading..." spinner). "path" is the base new-issue
    // URL; the selected tracker id is appended per navigation.
    const PROJECTS = {
        web:     { label: "Web",     icon: "globe",      path: "/projects/web-app-version-2/issues/new", board: "/projects/web-app-version-2/agile/board", version: "2216", assignee: "CloudApper Web Team" },
        backend: { label: "Backend", icon: "server",     path: "/projects/backend/issues/new",           board: "/projects/backend/agile/board",           version: "2215", assignee: "CloudApper Backend Team" },
        ios:     { label: "iOS",     icon: "smartphone", path: "/projects/ios-app/issues/new",           board: "/projects/ios-app/agile/board",           version: "2163", assignee: "CloudApper iOS Team" },
        android: { label: "Android", icon: "android",    path: "/projects/android-app/issues/new",       board: "/projects/android-app/agile/board",       version: "2206", assignee: "CloudApper Android Team" }
    };

    // Order in which project buttons are rendered, and their keyboard shortcut digit.
    const PROJECT_ORDER = ["web", "backend", "ios", "android"];

    // Redmine trackers the user can report under. The numeric ids match this
    // Redmine instance; TRACKER_ORDER controls the grid order.
    const TRACKERS = {
        bug:        { id: "1", name: "Bug",        icon: "bug" },
        feature:    { id: "2", name: "Feature",    icon: "star" },
        task:       { id: "5", name: "Task",       icon: "check-square" },
        userstory:  { id: "6", name: "User story", icon: "user" },
        testcase:   { id: "7", name: "Test case",  icon: "flask" },
        suggestion: { id: "4", name: "Suggestion", icon: "lightbulb" }
    };
    const TRACKER_ORDER = ["bug", "feature", "task", "userstory", "testcase", "suggestion"];
    const DEFAULT_TRACKER = "bug";

    // The tracker currently chosen in the panel; used by the project buttons and
    // the Alt+1..4 shortcuts to decide which tracker the new issue opens under.
    let selectedTracker = DEFAULT_TRACKER;

    // Shipped defaults, keyed by tracker. Users can override any of them from
    // the panel; overrides are saved per tracker in localStorage under
    // STORAGE.template + "-" + <trackerKey> and used for Fill / Copy /
    // auto-fill. "Reset" restores the shipped default for the current tracker.
    const DEFAULT_DESCRIPTIONS = {
        bug: `

*Description:*


*Steps:*
#
#
#
#
#

*Expected Scenario:*


*Video:*


*Credentials:*
*Instance / Account Server:* Dev
*Email:* 
*Password:* 
*Client:* 
*App:*
*Form/Menu:*

`,
        feature: `

*Summary:*


*Description:*


*Acceptance Criteria:*
#
#
#

*Notes:*

`,
        task: `

*Objective:*


*Details:*


*Checklist:*
#
#
#

`,
        userstory: `

*User Story:*
As a <role>, I want <goal> so that <benefit>.

*Acceptance Criteria:*
#
#
#

*Notes:*

`,
        testcase: `

*Objective:*


*Preconditions:*


*Test Steps:*
#
#
#

*Expected Result:*

`,
        suggestion: `

*Suggestion:*


*Current Behavior:*


*Suggested Improvement:*


*Benefit:*

`
    };

    const STORAGE = {
        project:   "qa-project",
        tracker:   "qa-tracker-id",
        lastTracker:"qa-last-tracker",
        panelPos:  "qa-panel-pos",
        panelSize: "qa-panel-size",
        collapsed: "qa-panel-collapsed",
        docked:    "qa-panel-docked",
        dockPos:   "qa-panel-dock-pos",
        template:  "qa-template",
        boardsOpen:"qa-boards-open",
        lastBoard: "qa-last-board",
        theme:     "qa-theme",
        accent:    "qa-accent",
        aiMode:    "qa-ai-mode",
        aiKey:     "qa-openai-key",
        aiModel:   "qa-openai-model"
    };

    const MAX_AUTOFILL_TRIES = 40; // ~12s at 300ms

    // Inline-SVG icon set used for the header buttons (moon/sun/pin/minus/plus),
    // the section chevrons, and the API-key visibility toggle. Kept as raw
    // strings so the render code can drop them straight into innerHTML. All
    // shapes are stroke-only and inherit currentColor via CSS (see .qa-hbtn svg
    // / .qa-caret svg in the injected styles), so they follow theme/hover
    // colours automatically.
    // Inline SVG icon set. Each entry is a self-contained <svg> string so the
    // render code can drop it straight into innerHTML. All shapes are
    // stroke-only, use currentColor, and bake stroke + linecap attributes into
    // the <svg> element so they work in every context (header buttons, tracker
    // cards, template action row, chat bubbles) without extra CSS. Shapes are
    // adapted from Lucide (MIT-licensed) with minor simplifications so they
    // read well at 13–15 px.
    const QA_ICONS = (() => {
        const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
        return {
            // Chrome / header
            moon:            `<svg ${A}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
            sun:             `<svg ${A}><circle cx="12" cy="12" r="4"/><path d="M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7"/></svg>`,
            pin:             `<svg ${A}><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
            minus:           `<svg ${A}><path d="M5 12h14"/></svg>`,
            plus:            `<svg ${A}><path d="M12 5v14M5 12h14"/></svg>`,
            "chevron-right": `<svg ${A}><path d="M9 6l6 6-6 6"/></svg>`,
            // Palette icon for the accent-colour picker in the header. Reads
            // as a hand-held painter's palette (rounded blob + thumb notch
            // on the lower-left + three paint dots in the well).
            palette:         `<svg ${A}><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2v-.3c0-.6.2-1.2.6-1.6.4-.4 1-.6 1.6-.6H18a4 4 0 0 0 4-4c0-6-4.5-11-10-11z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16.5" cy="11" r="1.2"/></svg>`,
            eye:             `<svg ${A}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
            "eye-off":       `<svg ${A}><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.5 19.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19M1 1l22 22M9.88 9.88a3 3 0 1 0 4.24 4.24"/></svg>`,
            rocket:          `<svg ${A}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,

            // Description-source mode toggle. `bot` reads as an AI-assistant
            // (Copilot-style) rounded robot head with a top antenna, two eye
            // dots, and side "ear" antennae — a widely recognised AI glyph
            // that pairs well with the file-text icon used for Template mode.
            sparkle:         `<svg ${A}><path d="M12 3l1.9 4.2L18 9l-4.1 1.8L12 15l-1.9-4.2L6 9l4.1-1.8L12 3z"/></svg>`,
            bot:             `<svg ${A}><path d="M12 2v3"/><rect x="4" y="7" width="16" height="12" rx="3"/><circle cx="9" cy="13" r="1.1"/><circle cx="15" cy="13" r="1.1"/><path d="M2 13v2"/><path d="M22 13v2"/></svg>`,
            "file-text":     `<svg ${A}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h2"/></svg>`,

            // Template action row + AI panel
            save:                 `<svg ${A}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>`,
            "rotate-ccw":         `<svg ${A}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
            download:             `<svg ${A}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>`,
            copy:                 `<svg ${A}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
            "trash-2":            `<svg ${A}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
            key:                  `<svg ${A}><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5L21 2"/><path d="M17 6l3 3"/></svg>`,
            sparkles:             `<svg ${A}><path d="M12 3l1.9 4.2L18 9l-4.1 1.8L12 15l-1.9-4.2L6 9l4.1-1.8L12 3z"/><path d="M19 15l.7 1.5L21 17l-1.3.5L19 19l-.7-1.5L17 17l1.3-.5L19 15z"/><path d="M5 15l.7 1.5L7 17l-1.3.5L5 19l-.7-1.5L3 17l1.3-.5L5 15z"/></svg>`,
            eraser:               `<svg ${A}><path d="M20 21H7"/><path d="M5 11l9 9"/><path d="M18.4 8.4L14 4a1.4 1.4 0 0 0-2 0L4 12a1.4 1.4 0 0 0 0 2l4.6 4.6a1.4 1.4 0 0 0 2 0L18.4 12a1.4 1.4 0 0 0 0-2z"/></svg>`,
            "arrow-down-to-line": `<svg ${A}><path d="M12 3v13"/><path d="M6 10l6 6 6-6"/><path d="M21 20H3"/></svg>`,
            "alert-triangle":     `<svg ${A}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,

            // Tracker cards
            // Bug is redrawn (vs. the original Lucide bug) so the visible
            // body + legs sit at the geometric centre of the 24×24 viewBox
            // instead of hugging the bottom half. This makes it centre
            // vertically inside a flex row without a fudge-margin: antennae
            // reach up to y=4, legs stop at y=17, body centre ≈ y=12.
            bug:                  `<svg ${A}><path d="M9 5l1.5 2"/><path d="M15 5l-1.5 2"/><rect x="7" y="7" width="10" height="11" rx="5"/><path d="M12 8v9"/><path d="M7 11H4"/><path d="M7 14H4"/><path d="M6 17l1-1"/><path d="M17 11h3"/><path d="M17 14h3"/><path d="M18 17l-1-1"/></svg>`,
            star:                 `<svg ${A}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
            "check-square":       `<svg ${A}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
            x:                    `<svg ${A}><path d="M18 6L6 18M6 6l12 12"/></svg>`,
            user:                 `<svg ${A}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
            flask:                `<svg ${A}><path d="M10 2v7.5L2.4 21.16A1 1 0 0 0 3.24 22.5h17.52a1 1 0 0 0 .84-1.34L14 9.5V2"/><path d="M8.5 2h7"/><path d="M6.5 15h11"/></svg>`,
            lightbulb:            `<svg ${A}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14A5.5 5.5 0 0 0 12 4a5.5 5.5 0 0 0-3.09 10c1.19.86 1.09 1.72 1.09 4h4c0-2.28-.1-3.14 1.09-4z"/></svg>`,

            // Project / board cards
            globe:                `<svg ${A}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
            server:               `<svg ${A}><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
            smartphone:           `<svg ${A}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
            android:              `<svg ${A}><path d="M17.5 15.5a5.5 5.5 0 1 0-11 0z"/><path d="M6.5 15.5v3.5"/><path d="M17.5 15.5v3.5"/><line x1="9" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="15" y2="12"/><path d="M7 9L5 6"/><path d="M17 9l2-3"/></svg>`
        };
    })();
    const svgIcon = (name) => QA_ICONS[name] || "";

    // Default OpenAI model for the AI bug-report assistant.
    const AI_DEFAULT_MODEL = "gpt-4o";

    // Models offered in the AI-mode selector.
    const AI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo"];

    // Shown in the panel footer. Read from the extension manifest or the userscript
    // metadata so it always matches the shipped version (no extra place to update).
    const QA_VERSION = (typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version)
        ? GM_info.script.version
        : ((typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest)
            ? chrome.runtime.getManifest().version
            : "");

    // Storage key for a given tracker's template override. Bug used to live
    // under the plain STORAGE.template key before the per-tracker split;
    // getTemplate() below still reads that as a fallback.
    function templateStorageKey(trackerKey) {
        return STORAGE.template + "-" + trackerKey;
    }

    // Returns the user's saved template for the given tracker (defaults to the
    // currently active tracker) or the shipped default if none is set.
    function getTemplate(trackerKey) {
        const key = trackerKey || currentTrackerKey();
        let saved = localStorage.getItem(templateStorageKey(key));
        // Back-compat: the bug template used to live under the plain
        // "qa-template" key before the per-tracker split.
        if ((saved === null || saved === "") && key === "bug") {
            saved = localStorage.getItem(STORAGE.template);
        }
        return (saved !== null && saved !== "")
            ? saved
            : (DEFAULT_DESCRIPTIONS[key] || DEFAULT_DESCRIPTIONS.bug);
    }

    function saveTemplate(text, trackerKey) {
        const key = trackerKey || currentTrackerKey();
        localStorage.setItem(templateStorageKey(key), text);
        // Legacy bug key is now redundant; drop it so the per-tracker one
        // stays authoritative.
        if (key === "bug") localStorage.removeItem(STORAGE.template);
    }

    function resetTemplate(trackerKey) {
        const key = trackerKey || currentTrackerKey();
        localStorage.removeItem(templateStorageKey(key));
        if (key === "bug") localStorage.removeItem(STORAGE.template);
    }

    //////////////////////////////////////////////////////
    // AI assistant (OpenAI)
    //////////////////////////////////////////////////////

    // The OpenAI key lives in the userscript manager's isolated storage
    // (GM_getValue / GM_setValue, scoped per-userscript) rather than
    // window.localStorage on the Redmine origin. Why: page-origin
    // localStorage can be read by any script that ends up running on
    // Redmine — a Redmine XSS, a compromised plugin, or any other
    // userscript / extension that has access to this origin. GM storage
    // is scoped to this userscript and unreachable from the page world.
    //
    // Any legacy value that a pre-6.4.1 version wrote to localStorage is
    // migrated on first read and then wiped — leaving it there would
    // defeat the whole point of the move.
    (function migrateLegacyAiKey() {
        if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") return;
        let legacy = "";
        try { legacy = (localStorage.getItem(STORAGE.aiKey) || "").trim(); } catch (_) {}
        if (!legacy) return;
        const current = (GM_getValue("qa-openai-key", "") || "").trim();
        if (!current) GM_setValue("qa-openai-key", legacy);
        try { localStorage.removeItem(STORAGE.aiKey); } catch (_) {}
    })();

    const AI = {
        key: () => {
            if (typeof GM_getValue !== "function") return "";
            return (GM_getValue("qa-openai-key", "") || "").trim();
        },
        model: () => (localStorage.getItem(STORAGE.aiModel) || AI_DEFAULT_MODEL),
        setKey: (k) => {
            if (typeof GM_setValue !== "function") return;
            GM_setValue("qa-openai-key", (k || "").trim());
        }
    };

    // Returns the tracker key that best matches what is being reported: prefer the
    // tracker actually selected in the Redmine issue form, then the panel choice.
    function currentTrackerKey() {
        const sel = document.getElementById("issue_tracker_id");
        if (sel && sel.value) {
            const key = Object.keys(TRACKERS).find((k) => TRACKERS[k].id === String(sel.value));
            if (key) return key;
        }
        return selectedTracker;
    }

    // Instructions that make the model return a predictable JSON shape so we can
    // split its answer into a chat reply plus reviewable subject/description.
    // Each tracker gets its own noun, description template and guidance so the AI
    // produces the right kind of report (bug, feature, user story, task, ...).
    const TRACKER_PROMPTS = {
        bug: {
            noun: "bug report",
            role: "A Bug describes something that is broken or behaving incorrectly and needs to be fixed.",
            placeholder: "Describe the bug in rough words\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("bug"),
            guide: "Under the *Description:* heading, write a concise 1-2 sentence summary of the bug: what is broken, where it happens, and the impact. Fill *Steps:* with the numbered actions needed to reproduce it and *Expected Scenario:* with what should happen instead. Keep the remaining placeholders for details the notes do not cover. Never leave *Description:* empty when the notes describe a problem."
        },
        feature: {
            noun: "feature",
            role: "A Feature describes a NEW capability that is being introduced or implemented \u2014 it is not a bug, a fix, or merely a request.",
            placeholder: "Describe the new feature you're introducing\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("feature"),
            guide: "Describe the new feature being added. Under *Summary:* give a one-line statement of what the feature is. Under *Description:* explain what it does, who it is for, and the value it delivers in 2-4 sentences. Under *Acceptance Criteria:* list concrete, testable conditions that must be met for the feature to be considered complete. Use *Notes:* for dependencies, edge cases, or open questions."
        },
        task: {
            noun: "task",
            role: "A Task is a concrete unit of work to be carried out (for example implementation, configuration, or investigation) \u2014 it is not a bug report.",
            placeholder: "Describe the work to be done\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("task"),
            guide: "Under *Objective:* state the goal of the task in 1-2 sentences. Under *Details:* add the context, scope, and any constraints or dependencies. Break the work into clear, independently verifiable steps under *Checklist:*."
        },
        userstory: {
            noun: "user story",
            role: "A User story captures a requirement from an end user's perspective and the value it provides.",
            placeholder: "Describe the user need \u2014 role, goal, benefit\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("userstory"),
            guide: "Fill *User Story:* using the \"As a <role>, I want <goal> so that <benefit>\" form, replacing the placeholders with the real role, goal, and benefit from the notes. Under *Acceptance Criteria:* list concrete, testable conditions that define when the story is done. Use *Notes:* for assumptions or related details."
        },
        testcase: {
            noun: "test coverage checklist",
            role: "A senior QA engineer produces structured test coverage for a feature \u2014 happy path, negative cases, edges, roles, integrations, data states, and UI/UX \u2014 plus a list of ambiguities that need reporter clarification.",
            placeholder: "Paste the feature description; optionally paste your own test cases in a follow-up\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("testcase"),
            guide: "",
            // Testcase doesn't fit the shared noun+role+template+guide shape:
            // the deliverable is a multi-section coverage checklist in Markdown
            // rather than a single filled Redmine template. `system()` lets
            // this tracker author the whole system prompt; aiSystemPrompt()
            // detects the override and skips the default composition.
            system: () => [
                "Act as a senior QA engineer reviewing a feature for our SaaS platform, CloudApper.ai.",
                "The reporter will paste a feature description. In a later turn they may also paste their own test cases; merge those with yours across the whole conversation.",
                "",
                'Always respond with a JSON object containing exactly these keys:',
                '- "reply": a short chat message (max 2 sentences). Put any clarification questions here.',
                '- "subject": a concise coverage title (<= 120 chars), e.g. "Test coverage for <feature name>". Use an empty string if the notes are too thin.',
                '- "description": the full Markdown coverage checklist described below.',
                "",
                'In "description", produce a structured test coverage checklist with the following sections when applicable:',
                "1. Core functional flows (happy path, including all stated acceptance criteria)",
                "2. Negative / invalid input cases",
                "3. Boundary & edge cases (empty values, max length, special characters, duplicates, zero/negative numbers, etc.)",
                "4. Role/permission-based scenarios (admin vs standard user vs other roles, if applicable)",
                "5. Integration points (other modules, APIs, notifications, third-party systems this might touch)",
                "6. Data state scenarios (first-time use, existing data, large datasets, concurrent users)",
                "7. UI/UX edge cases (responsive behavior, error messaging, loading states)",
                "",
                'Also include an "Ambiguities" section listing anything in the ticket that is underspecified or could be interpreted multiple ways \u2014 these need clarification from the reporter before testing.',
                "",
                'If the reporter has pasted their own test cases (now or earlier in this conversation), merge them with yours in the appropriate section. Append " [Generated by AI]" to every test case YOU authored; leave the reporter\'s cases untouched.',
                "Format the description in Markdown: `##` for section headings, numbered lists for test cases, `-` for sub-bullets. Omit sections that genuinely don't apply to the feature rather than padding them.",
                'Unlike other trackers, you MAY invent test scenarios derived from the feature description \u2014 that is the point of coverage generation. Do not invent product-specific facts (URLs, exact UI copy, credentials); ask about those in "reply" instead.',
                'If the feature description is too thin, put your clarification questions in "reply" and give a best-effort partial description.'
            ].join("\n")
        },
        suggestion: {
            noun: "suggestion",
            role: "A Suggestion proposes an improvement or idea; it is optional and is not a defect.",
            placeholder: "Describe your suggestion or improvement idea\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("suggestion"),
            guide: "Under *Suggestion:* summarise the idea in 1-2 sentences. Under *Current Behavior:* describe how things work today, and under *Suggested Improvement:* what should change. Explain the value it adds under *Benefit:*."
        }
    };

    function aiSystemPrompt() {
        const t = TRACKER_PROMPTS[currentTrackerKey()] || TRACKER_PROMPTS[DEFAULT_TRACKER];
        // Some trackers (currently testcase) need a fully custom prompt that
        // doesn't fit the shared noun+role+template+guide shape \u2014 they define
        // `system()` and get to author the whole string.
        if (typeof t.system === "function") return t.system();
        return [
            "You are a QA assistant that turns rough notes into a well-structured Redmine " + t.noun + ".",
            t.role,
            "Always respond with a JSON object containing exactly these keys:",
            '- "reply": a short, friendly message to the reporter (max 2 sentences) about what you produced or what you still need.',
            '- "subject": a concise, specific ' + t.noun + ' title (<= 120 chars). Use an empty string if there is not enough information yet.',
            '- "description": the full ' + t.noun + ' formatted using EXACTLY this template structure:',
            "-----",
            t.template(),
            "-----",
            // Explicit "MUST reproduce EVERY heading" wording — otherwise brief
            // notes let the model drop sections it can't fill instead of
            // leaving them empty.
            "CRITICAL FORMATTING RULE: the \"description\" value MUST reproduce EVERY *Heading:* line from the template above, in the same order, with the exact same wording, punctuation and blank-line spacing. For sections you can fill from the notes, place your content directly under the heading. For sections the notes do not cover, output the heading followed by a blank line so the reporter can fill it in later. NEVER omit, rename, merge, or reorder a heading. Do NOT add new headings that were not in the template.",
            t.guide,
            "Write in clear, professional English with each section kept focused.",
            "Only use facts the reporter provided \u2014 do not invent steps, credentials, versions, or acceptance criteria that the notes do not imply. Leave the corresponding sections as empty headings instead of deleting them. If the notes are too vague to build a report, ask a clarifying question in \"reply\" and still return the full template (with every heading present) in \"description\"."
        ].join("\n");
    }

    // Sends the running conversation to OpenAI. In the userscript this uses
    // GM_xmlhttpRequest (with @connect api.openai.com) to bypass the page CSP.
    function aiTransport(payload) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === "undefined") {
                reject(new Error("GM_xmlhttpRequest unavailable. Grant it in the userscript header."));
                return;
            }
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.openai.com/v1/chat/completions",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + AI.key()
                },
                data: JSON.stringify(payload),
                onload: (resp) => {
                    let data = {};
                    try { data = JSON.parse(resp.responseText); } catch (_) { /* non-JSON */ }
                    if (resp.status < 200 || resp.status >= 300) {
                        reject(new Error((data.error && data.error.message) || ("HTTP " + resp.status)));
                        return;
                    }
                    resolve(data);
                },
                onerror: () => reject(new Error("Network error")),
                ontimeout: () => reject(new Error("Request timed out"))
            });
        });
    }

    async function aiChat(history) {
        if (!AI.key()) throw new Error("No API key set. Paste your OpenAI API key first.");
        // Test-case coverage benefits from a bit more creativity so the
        // negative / boundary / edge sections don't collapse into the same
        // predictable phrasing on every run. Other trackers stay at 0.3 for
        // deterministic drafting.
        const trackerKey = currentTrackerKey();
        const payload = {
            model: AI.model(),
            temperature: trackerKey === "testcase" ? 0.5 : 0.3,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: aiSystemPrompt() }].concat(history)
        };
        const data = await aiTransport(payload);
        const content = data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content : "";
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (_) {
            parsed = { reply: content || "(no response)", subject: "", description: "" };
        }
        return {
            raw: content,
            reply: parsed.reply || "",
            subject: parsed.subject || "",
            description: parsed.description || ""
        };
    }

    //////////////////////////////////////////////////////
    // Analyze Ticket (issue detail pages)
    //////////////////////////////////////////////////////

    // System prompt for the ticket analyser. Kept in one place so
    // every future tweak (section names, tone knobs) touches a single spot.
    function analyzeSystemPrompt() {
        return [
            "You are a senior product engineer producing a briefing for whoever is opening this Redmine ticket next — that reader could be the developer picking the work up, the QA about to test a delivered fix, the assignee taking over a hand-off, or a reviewer taking a look. You do not know which one, so write for all of them.",
            "The reporter will paste a JSON payload with the ticket's title, tracker, status, priority, assignee, target version, description, checklist and the most recent journal notes.",
            "Use `status`, `assignee`, `tracker` and the tone of the description + latest journal notes to figure out the lifecycle stage: is this a fresh request awaiting implementation, work in progress, or already-delivered work being handed back for QA / review? Frame every section from that angle.",
            "Reply in warm, human, professional English — write as if you were briefing a teammate on Slack, not authoring a spec. No corporate fluff, no emoji, no bullet-lists of the obvious.",
            "Produce a Markdown report with these `##` sections in this exact order, and OMIT any section you genuinely cannot fill from the payload rather than padding it:",
            "",
            "## Ticket summary",
            "A descriptive, plain-English recap of what this ticket is about — what it's asking for, or what it appears to have delivered, depending on where it sits in its lifecycle. Match the length to how much detail the ticket actually carries: keep it tight for a thin one-liner ticket, expand to several paragraphs for a rich one. There is no fixed sentence limit — be as descriptive as the source material justifies.",
            "",
            "## What changes are being made",
            "If the ticket is still open (New / In Progress / awaiting implementation), describe the changes the developer is expected to make, based on the description + checklist.",
            "If the ticket appears to already be resolved or handed back for QA (Resolved / Ready for QA / assigned to a tester with latest journal notes describing work done), describe the changes that were actually made, based on the description AND what the latest journal comments say the developer did. Cite the journal notes when they add information the description doesn't.",
            "Either way, keep it concrete and actionable — not marketing language.",
            "",
            "## What to expect after the change",
            "The user-visible or system-level behaviour that should be true once the change lands. Useful both for the dev sanity-checking their work before hand-off and for the QA verifying it.",
            "",
            "## Questions worth asking",
            "Sharp, specific clarifying questions the reader might want to raise with the reporter, the developer, the assignee, or the PM. Skip generic questions ('what browser?', 'any screenshot?') unless the ticket text implies they matter.",
            "",
            "## Edge cases",
            "Concrete edge cases derived from the ticket text and typical failure modes for this kind of change. Useful to both a dev (things to guard against) and a QA (things to explicitly test).",
            "",
            "## Suggested test cases",
            "A numbered list of test cases, one per line. Given / When / Then phrasing welcome. Prioritise the ones that catch regressions in the areas the change touches. Include the happy path and at least one negative / boundary case.",
            "",
            "## Risks / regression areas",
            "Adjacent features or code paths that could break because of this change.",
            "",
            "## Assumptions the AI made",
            "Anything the reader should double-check before trusting the rest of the analysis. If you made none, write \"None — analysis was based directly on the ticket text.\"",
            "",
            "Do NOT invent product-specific facts (URLs, credentials, exact UI copy, version numbers) that aren't in the payload — put those in \"Questions worth asking\" instead.",
            "Return raw Markdown only — no wrapping code fence, no JSON envelope."
        ].join("\n");
    }

    // Reads the current issue detail page (view mode) and returns a compact
    // JSON payload for the analyser. Every field is best-effort — missing
    // pieces just come back empty rather than throwing, so a stripped-down
    // Redmine theme still yields a usable payload.
    function scrapeTicketForAnalysis() {
        const out = {
            title: "", tracker: "", status: "", priority: "",
            assignee: "", target_version: "",
            description: "", checklist: [], journal_notes: []
        };

        const hdr = document.querySelector("#content h2, .subject h3, .subject > div > h3");
        if (hdr) out.title = hdr.textContent.trim().replace(/\s+/g, " ");

        // Redmine renders attribute rows as `.attributes .attribute.<name> .value`;
        // fall back to a generic value cell if the theme flattens the wrapper.
        const readAttr = (cls) => {
            const el = document.querySelector(".attributes .attribute." + cls + " .value")
                    || document.querySelector(".attributes ." + cls + " .value")
                    || document.querySelector(".attributes td.value." + cls);
            return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
        };
        out.tracker        = readAttr("tracker");
        out.status         = readAttr("status");
        out.priority       = readAttr("priority");
        out.assignee       = readAttr("assigned-to");
        out.target_version = readAttr("fixed-version") || readAttr("version");

        const desc = document.querySelector(".description .wiki")
                  || document.querySelector("#issue_description_wiki");
        if (desc) out.description = (desc.innerText || desc.textContent || "").trim();

        // Checklists plugin renders `#issue_checklists .checklist-item`; some
        // themes drop the wrapper id, so we also accept a bare `.checklist-item`.
        const items = document.querySelectorAll("#issue_checklists .checklist-item, .checklist-item");
        items.forEach(item => {
            // Skip edit-mode rows — they carry an .edit-box textarea we don't want.
            if (item.querySelector(".edit-box")) return;
            const cb = item.querySelector('input[type="checkbox"]');
            const lblEl = item.querySelector("label, .subject, .checklist-subject");
            const label = ((lblEl ? lblEl.textContent : item.textContent) || "")
                .trim().replace(/\s+/g, " ");
            if (label) out.checklist.push({ label, checked: !!(cb && cb.checked) });
        });

        // Last 5 journal notes, oldest→newest, clipped to a shared 4k budget so
        // a monster comment thread can't blow past the model context window.
        const notes = Array.from(document.querySelectorAll("#history .journal"))
            .map(j => {
                const w = j.querySelector(".notes .wiki, .journal-notes .wiki, .wiki");
                return w ? ((w.innerText || w.textContent || "").trim()) : "";
            })
            .filter(Boolean);
        let budget = 4000;
        for (const n of notes.slice(-5)) {
            if (budget <= 0) break;
            const clipped = n.length > budget ? n.slice(0, budget) + "…" : n;
            out.journal_notes.push(clipped);
            budget -= clipped.length;
        }

        return out;
    }

    // Fires a one-shot chat completion with the analyser prompt and returns
    // the raw Markdown reply. Never uses `response_format: json_object` — this
    // path wants free-form Markdown, not the reviewer's JSON envelope.
    async function runTicketAnalysis(payloadObj) {
        if (!AI.key()) throw new Error("Add your OpenAI API key first");
        const userMsg = "Analyze this Redmine ticket:\n\n" + JSON.stringify(payloadObj, null, 2);
        const payload = {
            model: AI.model(),
            temperature: 0.4,
            messages: [
                { role: "system", content: analyzeSystemPrompt() },
                { role: "user",   content: userMsg }
            ]
        };
        const data = await aiTransport(payload);
        const md = data && data.choices && data.choices[0] && data.choices[0].message
            ? (data.choices[0].message.content || "").trim()
            : "";
        if (!md) throw new Error("Empty response from OpenAI");
        return md;
    }

    // Minimal Markdown → HTML renderer for the analyser modal. Every text
    // fragment is HTML-escaped before we splice in tags, so bad input from
    // the model can't inject scripts. Handles: ## / ### headings, unordered
    // and ordered lists, paragraphs, `code`, **bold**, *italic*, [links], and
    // ```fenced``` blocks. Nested lists are not supported (the prompt asks
    // for flat lists).
    function renderAnalysisMarkdown(md) {
        const esc = (s) => String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        const inlineFormat = (text) => {
            let t = esc(text);
            t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
            t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
            t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
            t = t.replace(/\[([^\]]+)\]\(([^) ]+)\)/g,
                (_m, txt, url) => '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>");
            return t;
        };
        const lines = md.split(/\r?\n/);
        const out = [];
        let listType = null;
        let inCode = false;
        let paragraph = [];
        const flushParagraph = () => {
            if (paragraph.length) {
                out.push("<p>" + inlineFormat(paragraph.join(" ")) + "</p>");
                paragraph = [];
            }
        };
        const closeList = () => {
            if (listType) { out.push("</" + listType + ">"); listType = null; }
        };
        for (const raw of lines) {
            if (/^\s*```/.test(raw)) {
                flushParagraph(); closeList();
                if (!inCode) { out.push("<pre><code>"); inCode = true; }
                else         { out.push("</code></pre>"); inCode = false; }
                continue;
            }
            if (inCode) { out.push(esc(raw)); continue; }
            if (/^\s*$/.test(raw)) { flushParagraph(); closeList(); continue; }
            let m;
            if ((m = raw.match(/^(#{1,4})\s+(.*)$/))) {
                flushParagraph(); closeList();
                // Bump one level so `##` renders as h3 — keeps the modal from
                // dominating with browser-default h1/h2 sizing.
                const lvl = Math.min(6, m[1].length + 1);
                out.push("<h" + lvl + ">" + inlineFormat(m[2]) + "</h" + lvl + ">");
                continue;
            }
            if ((m = raw.match(/^\s*[-*]\s+(.*)$/))) {
                flushParagraph();
                if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
                out.push("<li>" + inlineFormat(m[1]) + "</li>");
                continue;
            }
            if ((m = raw.match(/^\s*\d+\.\s+(.*)$/))) {
                flushParagraph();
                if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
                out.push("<li>" + inlineFormat(m[1]) + "</li>");
                continue;
            }
            paragraph.push(raw.trim());
        }
        flushParagraph(); closeList();
        if (inCode) out.push("</code></pre>");
        return out.join("");
    }


    // Returns "dark" or "light". Falls back to the OS preference when unset.
    function getTheme() {
        const saved = localStorage.getItem(STORAGE.theme);
        if (saved === "dark" || saved === "light") return saved;
        return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }

    function applyTheme(panel, theme) {
        const dark = theme === "dark";
        panel.classList.toggle("qa-dark", dark);
        // Popover lives on document.body — mirror the dark class so its
        // own token overrides in content.css kick in.
        const popover = document.getElementById("qa-accent-popover");
        if (popover) popover.classList.toggle("qa-dark", dark);
        const btn = document.getElementById("qa-theme");
        if (btn) {
            btn.innerHTML = svgIcon(dark ? "sun" : "moon");
            btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
        }
    }

    function toggleTheme(panel) {
        const theme = panel.classList.contains("qa-dark") ? "light" : "dark";
        localStorage.setItem(STORAGE.theme, theme);
        applyTheme(panel, theme);
    }

    //////////////////////////////////////////////////////
    // Accent colour picker (light + dark friendly)
    //////////////////////////////////////////////////////
    // Each accent maps to a class on the panel (qa-accent-lavender etc.)
    // which overrides the --qa-brand-* token cluster in content.css. The
    // dark-mode class (.qa-dark) is orthogonal — every accent has both a
    // light and a dark variant, so switching modes preserves the accent.
    const ACCENTS = ["blue", "lavender", "orange", "red"];

    function getAccent() {
        const saved = localStorage.getItem(STORAGE.accent);
        return ACCENTS.includes(saved) ? saved : "blue";
    }

    function applyAccent(panel, accent) {
        ACCENTS.forEach(a => panel.classList.toggle(`qa-accent-${a}`, a === accent));
        // Popover lives on document.body — mirror the accent class so its
        // --qa-brand token override (used by the swatch focus ring)
        // resolves correctly outside #qa-panel's scope.
        const popover = document.getElementById("qa-accent-popover");
        if (popover) {
            ACCENTS.forEach(a => popover.classList.toggle(`qa-accent-${a}`, a === accent));
        }
        // Sync the selected-swatch ring. The popover is appended to
        // document.body (see setupPanel) so we query the whole document,
        // not just the panel.
        document.querySelectorAll(".qa-swatch").forEach(sw => {
            sw.classList.toggle("qa-swatch-active", sw.dataset.accent === accent);
        });
    }

    function setAccent(panel, accent) {
        if (!ACCENTS.includes(accent)) return;
        localStorage.setItem(STORAGE.accent, accent);
        applyAccent(panel, accent);
    }

    //////////////////////////////////////////////////////
    // Helpers
    //////////////////////////////////////////////////////

    function fireEvents(el) {
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        fireEvents(el);
    }

    function setSelectByText(id, text) {
        const select = document.getElementById(id);
        if (!select) return;
        for (const option of select.options) {
            if (option.text.trim() === text) {
                select.value = option.value;
                fireEvents(select);
                return;
            }
        }
    }

    function toast(message) {
        let t = document.getElementById("qa-toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "qa-toast";
            document.body.appendChild(t);
        }
        t.textContent = message;
        t.classList.add("qa-toast-show");
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove("qa-toast-show"), 1800);
    }

    //////////////////////////////////////////////////////
    // Fill / Clear Issue
    //////////////////////////////////////////////////////

    // The tracker and status <select>s carry inline onchange="updateIssueFrom(...)"
    // handlers that make Redmine reload the whole form over AJAX (the persistent
    // "Loading..." spinner) and REPLACE the description textarea, wiping our text.
    // We therefore set those two fields WITHOUT dispatching a change event: the
    // value is still submitted correctly, but no server round-trip is triggered.
    function setSelectSilently(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function fillIssue(project) {
        // Prefer the tracker id carried by the hash marker (session storage);
        // otherwise fall back to whichever tracker card is active in the panel
        // so manual Fill Template respects the user's current selection.
        const defaultId = (TRACKERS[selectedTracker] || TRACKERS[DEFAULT_TRACKER]).id;
        const trackerId = sessionStorage.getItem(STORAGE.tracker) || defaultId;
        setSelectSilently("issue_tracker_id", trackerId); // selected tracker (no AJAX reload)
        setSelectSilently("issue_status_id", "1");  // New   (no AJAX reload)

        setValue("issue_priority_id", "2");         // Normal (no reload handler)

        if (project && PROJECTS[project]) {
            setSelectByText("issue_assigned_to_id", PROJECTS[project].assignee);
        }

        const desc = document.getElementById("issue_description");
        if (desc) {
            desc.value = getTemplate();
            fireEvents(desc);
        }
    }

    function clearForm() {
        const desc = document.getElementById("issue_description");
        if (desc) {
            desc.value = "";
            fireEvents(desc);
        }
        const subject = document.getElementById("issue_subject");
        if (subject) {
            subject.value = "";
            fireEvents(subject);
        }
        toast("Form cleared");
    }

    // Fills Redmine's Subject + Description from the AI-reviewed values.
    function fillIssueFields(subject, description) {
        const subj = document.getElementById("issue_subject");
        if (subj && subject) {
            subj.value = subject;
            fireEvents(subj);
        }
        const desc = document.getElementById("issue_description");
        if (desc && description) {
            desc.value = description;
            fireEvents(desc);
        }
        toast("Filled from AI");
    }

    async function copyDescription() {
        const text = getTemplate().trim();
        try {
            await navigator.clipboard.writeText(text);
            toast("Description copied");
        } catch (e) {
            // Fallback for contexts without clipboard permission.
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            toast("Description copied");
        }
    }

    //////////////////////////////////////////////////////
    // Close Issue
    //////////////////////////////////////////////////////

    // Numeric id of the Redmine custom field that stores the 'Closed Version'
    // value on an issue. Confirmed from the DOM as
    // <select name='issue[custom_field_values][12]' id='issue_custom_field_values_12'>.
    const CLOSED_VERSION_CF_ID = "12";

    // Numeric id of the 'Closed' workflow status on this Redmine instance.
    // Last-resort fallback for the bulk-close path when neither Redmine's
    // workflow-gated status dropdown nor the agile board's column header
    // yields it (e.g. board with the Closed column hidden + representative
    // issue whose workflow forbids a direct N→Closed transition).
    // Confirmed via the agile board header <th data-column-id='5'>Closed</th>.
    const CLOSED_STATUS_ID = "5";

    // /issues/<n>, /issues/<n>/, /issues/<n>/edit — but NOT /issues/new.
    function isIssueDetailPage() {
        return /\/issues\/\d+(?:\/edit)?\/?$/.test(location.pathname);
    }

    // /issues/new or /projects/<ident>/issues/new — the only page where the
    // Description Source section (template editor + AI draft + Fill/Clear)
    // has a form to act on. On any other Redmine page (issue detail, issue
    // list, project overview, My page, …) the section would be dead weight
    // since its buttons target `#issue_subject` / `#issue_description`, which
    // only exist here.
    function isNewIssuePage() {
        return /(?:^|\/)issues\/new\/?$/.test(location.pathname);
    }

    // Redmine adds a 'project-<identifier>' class to <body> on every project
    // page. Map that identifier back to our internal project key so the note
    // we insert can use the short name ('Web', 'Backend', 'iOS', 'Android').
    function projectKeyFromBodyClass() {
        if (!document.body || !document.body.className) return null;
        const m = document.body.className.match(/\bproject-([\w-]+)/);
        if (!m) return null;
        const ident = m[1];
        return PROJECT_ORDER.find(
            (k) => PROJECTS[k].path.indexOf("/projects/" + ident + "/") === 0
        ) || null;
    }

    // Reads the Redmine 'Closed Version' custom-field <select> on the current
    // issue page and mirrors its options into the panel's version picker so the
    // user picks from the same list Redmine would offer them.
    function populateCloseVersionSelect(panelSelect) {
        if (!panelSelect) return false;
        const source =
            document.getElementById("issue_custom_field_values_" + CLOSED_VERSION_CF_ID) ||
            document.querySelector('select[name="issue[custom_field_values][' + CLOSED_VERSION_CF_ID + ']"]');
        if (!source) return false;
        const current = panelSelect.value;
        // Placeholder first, then mirror every real option.
        panelSelect.innerHTML = '<option value="">— pick a version —</option>';
        for (const opt of source.options) {
            if (!opt.value) continue; // skip Redmine's own blank placeholder
            const clone = document.createElement("option");
            clone.value = opt.value;
            clone.textContent = opt.text.trim();
            panelSelect.appendChild(clone);
        }
        // Preserve the previously chosen value across DOM refreshes when possible.
        if (current && Array.from(panelSelect.options).some((o) => o.value === current)) {
            panelSelect.value = current;
        }
        return true;
    }

    // Format: 'Issue resolved. Tested in <Short> — <VersionLabel>'. The em dash
    // avoids the redundant read ('Web Web App Sprint v10.0.0') when the
    // version label already contains the app name.
    function buildCloseNote(projectKey, versionLabel) {
        const shortName = (projectKey && PROJECTS[projectKey]) ? PROJECTS[projectKey].label : "";
        if (!versionLabel) return "";
        return shortName
            ? "Issue resolved. Tested in " + shortName + " — " + versionLabel + "."
            : "Issue resolved. Tested in " + versionLabel + ".";
    }

    // Applies the close-issue values to the Redmine update form:
    //   - Status → Closed (by option text, so it works across Redmine setups).
    //   - Closed Version → the picked version id.
    //   - Notes → whatever the user has in the panel textarea (the caller
    //     passes the current value, which may have been edited from the
    //     auto-generated default).
    // Returns true if all three fields were found and written; false otherwise.
    function fillCloseFields(versionValue, noteText) {
        if (!versionValue) return false;

        // Status → Closed. Fires change so any Redmine listeners run
        // (unlike the New-issue path where change would trigger an AJAX reload).
        setSelectByText("issue_status_id", "Closed");

        // Closed Version custom field.
        const cf = document.getElementById("issue_custom_field_values_" + CLOSED_VERSION_CF_ID);
        if (cf) {
            cf.value = versionValue;
            fireEvents(cf);
        }

        // Notes textarea.
        const notes = document.getElementById("issue_notes");
        if (notes) {
            notes.value = noteText || "";
            fireEvents(notes);
        }

        // Redmine issue pages hide the update form until the user clicks
        // 'Update'; reveal it so the user can see what we've filled in.
        // (The fields exist in the DOM either way — this is purely for UX.)
        if (typeof showAndScrollTo === "function") {
            try { showAndScrollTo("update", "notes"); } catch (e) { /* ignore */ }
        } else {
            const update = document.getElementById("update");
            if (update) update.style.display = "block";
        }

        return true;
    }

    // Submits the Redmine issue update form. Prefers clicking the real Submit
    // <input> so any onsubmit handlers Redmine attaches still run; falls back
    // to form.submit() only if the button isn't found.
    function submitCloseForm() {
        const form = document.getElementById("issue-form")
                  || (document.getElementById("issue_status_id") && document.getElementById("issue_status_id").form);
        if (!form) return false;
        const submitBtn = form.querySelector('input[type="submit"], button[type="submit"]');
        if (submitBtn) {
            submitBtn.click();
        } else {
            form.submit();
        }
        return true;
    }

    //////////////////////////////////////////////////////
    // Bulk Close (Agile board)
    //////////////////////////////////////////////////////

    // True on a Redmine Agile plugin board page — the only surface where the
    // "Bulk close" section makes sense (the panel needs cards to select).
    function isAgileBoardPage() {
        return /\/agile\/boards?\/?/.test(location.pathname);
    }

    // Every issue card currently rendered on the agile board. The Redmine
    // Agile plugin has used a couple of different DOM shapes across versions,
    // so we probe the common selectors and dedupe.
    function getBoardCards() {
        const nodes = document.querySelectorAll(".issue-card, .agile-issue, [data-id][data-project-id]");
        const seen = new Set();
        const out = [];
        nodes.forEach(n => {
            if (seen.has(n)) return;
            seen.add(n);
            out.push(n);
        });
        return out;
    }

    // Read the numeric issue id off a card element. Falls back to a numeric
    // suffix on the DOM id (e.g. id="issue-1234") if no data attribute exists.
    function cardIssueId(card) {
        const d = card.getAttribute("data-id") || card.getAttribute("data-issue-id");
        if (d) return d;
        const m = (card.id || "").match(/(?:issue-)?(\d+)/);
        return m ? m[1] : null;
    }

    // Best-effort card subject for the confirmation modal. Prefers the first
    // /issues/<n> link's text; falls back to "#id" if the card has no link.
    function cardSubject(card) {
        const link = card.querySelector("a[href*='/issues/']");
        if (link) {
            const t = link.textContent.trim();
            if (t) return t;
        }
        const id = cardIssueId(card);
        return id ? ("#" + id) : "(unknown)";
    }

    // Walk up from a card to its owning status column and read the numeric
    // status id off `td.issue-status-col[data-id]`. Returns null when the
    // Agile board markup is unexpected (defensive; caller treats null as
    // "unknown" and skips the workflow probe).
    function cardCurrentStatusId(card) {
        let el = card;
        while (el && el !== document.body) {
            if (el.matches && el.matches("td.issue-status-col[data-id]")) {
                return el.getAttribute("data-id");
            }
            el = el.parentElement;
        }
        return null;
    }

    // Ask Redmine's bulk-edit form (scoped to a single representative issue)
    // whether "Closed" is one of the workflow-legal transitions from that
    // issue's current status. We do this per-status rather than per-issue so
    // one probe covers every card sitting in the same column.
    async function probeCloseTransition(representativeIssueId, closedStatusId) {
        if (!representativeIssueId || !closedStatusId) return true;
        const res = await fetch("/issues/bulk_edit?ids[]=" + encodeURIComponent(representativeIssueId), { credentials: "include" });
        if (!res.ok) return true; // be optimistic — Redmine will silently skip anyway
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const sel = doc.querySelector("#issue_status_id");
        if (!sel) return true;
        return !!sel.querySelector('option[value="' + closedStatusId + '"]');
    }

    // Ask Redmine to render the bulk-edit form for the picked issues, then
    // scrape the CSRF token, the "Closed" status id, and the option list for
    // the Closed Version custom field. We reuse Redmine's own dropdowns so
    // whatever versions the user can normally pick on that project will show
    // up here too — no client-side filtering to keep in sync.
    async function fetchBulkEditContext(ids) {
        if (!ids || !ids.length) return null;
        const params = new URLSearchParams();
        ids.forEach(id => params.append("ids[]", id));
        const res = await fetch("/issues/bulk_edit?" + params.toString(), { credentials: "include" });
        if (!res.ok) throw new Error("Couldn't load bulk-edit form (HTTP " + res.status + ")");
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const meta = doc.querySelector("meta[name='csrf-token']") || document.querySelector("meta[name='csrf-token']");
        const csrf = meta ? meta.getAttribute("content") : null;
        if (!csrf) throw new Error("Couldn't find the CSRF token — reload Redmine and try again");

        // Locate the numeric id of the "Closed" status. Redmine renders
        // only workflow-valid transitions in the bulk-edit dropdown, so if
        // any selected issue is in a state that can't jump directly to
        // "Closed" (very common on "New" cards), the option is absent.
        // Fall back to the Agile plugin's own column headers, which always
        // render `<th data-column-id="5">Closed (245)</th>` for the closed
        // column regardless of workflow.
        let closedStatusId = null;
        const statusSel = doc.getElementById("issue_status_id");
        if (statusSel) {
            const opt = Array.from(statusSel.querySelectorAll("option"))
                .find(o => /closed/i.test(o.textContent.trim()));
            if (opt) closedStatusId = opt.value;
        }
        if (!closedStatusId) {
            const th = Array.from(document.querySelectorAll("th[data-column-id]"))
                .find(t => /closed/i.test(t.textContent.trim()));
            if (th) closedStatusId = th.getAttribute("data-column-id");
        }
        // Hardcoded fallback keeps the version list loadable even when the
        // Closed column is hidden and the workflow blocks a direct transition.
        if (!closedStatusId) closedStatusId = CLOSED_STATUS_ID;

        const cf = doc.getElementById("issue_custom_field_values_" + CLOSED_VERSION_CF_ID);
        const versions = [];
        if (cf) {
            Array.from(cf.querySelectorAll("option")).forEach(o => {
                if (o.value) versions.push({ value: o.value, label: o.textContent.trim() });
            });
        }

        return { csrf, closedStatusId, versions };
    }

    // Submit the bulk_update form the same way Redmine's own "Edit" batch
    // action does — application/x-www-form-urlencoded, CSRF in both header
    // and body, same-origin cookies. Redmine responds with a 302 redirect
    // on success; anything under 500 is treated as "probably ok" so a
    // subsequent reload will show the true state.
    async function postBulkUpdate({ ids, statusId, versionId, notes, csrf }) {
        const params = new URLSearchParams();
        params.append("authenticity_token", csrf);
        ids.forEach(id => params.append("ids[]", id));
        params.append("issue[status_id]", statusId);
        if (versionId) params.append("issue[custom_field_values][" + CLOSED_VERSION_CF_ID + "]", versionId);
        if (notes) params.append("notes", notes);
        const res = await fetch("/issues/bulk_update", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-CSRF-Token": csrf,
                "Accept": "text/html, application/xhtml+xml"
            },
            body: params.toString()
        });
        if (res.status >= 500) throw new Error("Bulk update failed (HTTP " + res.status + ")");
        return true;
    }

    // Update a single issue during bulk close. Historical note: this used
    // to hit Redmine's JSON REST API (PUT /issues/N.json) because its
    // 422 responses have nice per-field error arrays. That endpoint
    // responds to an unauthenticated request with
    //   HTTP/1.1 401
    //   WWW-Authenticate: Basic realm="Redmine API"
    // which makes Chrome's fetch stack pop the browser's Basic Auth
    // dialog — once per issue — during a bulk close, even when the
    // user already has a valid Redmine session cookie. Some Redmine
    // instances gate the JSON API behind "Enable REST web service" and
    // reject session-only auth, and the browser prompt fires before we
    // ever see the response.
    //
    // The fix is to post to the HTML form endpoint that Redmine's own
    // edit form uses. It's session-authenticated (cookie + CSRF token),
    // has no basic-auth challenge, and never triggers a credential
    // prompt. On success Redmine 302s to /issues/N; on validation
    // failure it re-renders the edit form with an #errorExplanation
    // block, which we scrape to surface per-issue errors.
    async function postSingleIssueUpdate({ id, statusId, versionId, notes, csrf }) {
        const params = new URLSearchParams();
        params.append("authenticity_token", csrf);
        params.append("_method", "put");
        params.append("issue[status_id]", String(statusId));
        if (notes) params.append("issue[notes]", notes);
        if (versionId) {
            params.append("issue[custom_field_values][" + CLOSED_VERSION_CF_ID + "]", String(versionId));
        }
        const res = await fetch("/issues/" + encodeURIComponent(id), {
            method: "POST",
            credentials: "include",
            redirect: "follow",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-CSRF-Token": csrf,
                "Accept": "text/html"
            },
            body: params.toString()
        });
        if (res.status >= 500) throw new Error("HTTP " + res.status);
        // Redmine's before_action redirects to /login when the session
        // has expired — fetch follows the 302 and res.url is /login?...
        if (res.redirected && /\/login(?:\?|$)/.test(res.url || "")) {
            throw new Error("Session expired — reload Redmine and sign in again");
        }
        // Any other redirect is Redmine's success path (302 to the
        // issue's own page). If fetch didn't follow a redirect but the
        // status is still 2xx, Redmine re-rendered the edit form because
        // validation failed — scrape the errors.
        if (res.redirected) return true;
        if (res.status === 401 || res.status === 403) {
            throw new Error("Not permitted to close this issue");
        }
        if (res.ok) {
            let text = "";
            try { text = await res.text(); } catch (_) {}
            const explain = text.match(/<div[^>]+id=["']errorExplanation["'][^>]*>([\s\S]*?)<\/div>/i);
            if (explain) {
                const items = Array.from(explain[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
                    .map(m => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
                    .filter(Boolean);
                if (items.length) throw new Error(items.join("; "));
            }
            const flash = text.match(/<div[^>]+id=["']flash_error["'][^>]*>([\s\S]*?)<\/div>/i);
            if (flash) {
                const msg = flash[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (msg) throw new Error(msg);
            }
            // Redmine re-rendered a page without redirecting and we
            // couldn't find explicit error markup — don't silently
            // report the row as closed.
            throw new Error("Update didn't take (no redirect)");
        }
        throw new Error("HTTP " + res.status);
    }

    //////////////////////////////////////////////////////
    // Reopened issues discovery (Agile board)
    //////////////////////////////////////////////////////

    // The workflow status we're hunting for. We match by regex against
    // the *rendered* status name (in the issue list + journal entries)
    // rather than looking up a numeric id — Redmine's per-workflow
    // status dropdown gates which options appear in the bulk_edit
    // form based on the picked issue's tracker/role, so an id lookup
    // there can (and did) fail even when the status exists. The
    // pattern is lenient on purpose: any status containing "reopen"
    // (case-insensitive) counts. Covers "Development: Reopen",
    // "Reopen", "QA: Reopen", etc. equally well.
    const REOPEN_STATUS_REGEX   = /reopen/i;
    // User-facing name for panel copy — CloudApper Redmine instances
    // this extension targets use "Development: Reopen" as the
    // canonical reopen status, so the button title / modal lede
    // still reference it directly.
    const REOPEN_STATUS_DISPLAY = "Development: Reopen";
    // Numeric status id for "Development: Reopen". Confirmed by the
    // user to be `8` on every Redmine instance this extension
    // targets. We use it as the primary key for the "currently
    // reopened" query (one direct filter, no per-issue scan) and as
    // a hint alongside the regex when scanning journals. This
    // sidesteps the workflow-gated bulk_edit dropdown lookup that
    // was unreliable in 6.5.1.
    const REOPEN_STATUS_ID      = "8";

    // Feedback status — drives the sprint audit's churn scan the same
    // way REOPEN_STATUS_ID drives the reopen scan.
    const FEEDBACK_STATUS_ID      = "4";
    const FEEDBACK_STATUS_REGEX   = /feedback/i;
    const FEEDBACK_STATUS_DISPLAY = "Feedback";

    // Priority ids treated as ship-blocking by the sprint audit — Urgent (4)
    // and Immediate (5). Change if this instance renumbered priorities.
    const URGENT_PRIORITY_IDS = ["4", "5"];

    // QA daily counter (agile board injection). Names match Redmine author
    // display names verbatim — rename here if a member's profile changes.
    const QA_TEAM_MEMBERS = [
        "Jannatut Tabassum",
        "Muntanuz Zaman",
        "Shishir Talha",
        "Sharmin Akter",
        "Sayma Tihany",
        "Nafisa Feroz",
        "Shafiqul Islam"
    ];
    const QA_DAILY_START_HOUR   = 10;
    const QA_DAILY_CACHE_KEY    = "qa.dailyReport.v1";
    const QA_DAILY_CACHE_TTL_MS = 5 * 60 * 1000;
    const QA_DAILY_WEEK_CACHE_KEY    = "qa.dailyReport.week.v1";
    const QA_DAILY_WEEK_CACHE_TTL_MS = 30 * 60 * 1000;
    const QA_DAILY_SHOW_PET_KEY = "qa.dailyReport.showPet.v1";

    // Extract { projectSlug, versionId } from the current agile board URL.
    // The pathname carries the project (`/projects/<slug>/agile/board/…`)
    // and the query string carries `v[fixed_version_id][]=<id>` when the
    // user opened the board for a specific sprint. Returns null when
    // we're not on a board URL or the project slug can't be read.
    function getCurrentBoardScope() {
        const m = location.pathname.match(/^\/projects\/([^/]+)\/agile\/board/);
        if (!m) return null;
        const projectSlug = m[1];
        // Redmine URL-encodes the filter params as v%5Bfixed_version_id%5D%5B%5D=…
        // — URLSearchParams handles the decoding for us.
        const q = new URLSearchParams(location.search);
        let versionId = q.get("v[fixed_version_id][]");
        // Some board URLs carry the version as `version_id=…` instead of
        // the filter shape (older Agile plugin versions).
        if (!versionId) versionId = q.get("version_id");
        return { projectSlug: projectSlug, versionId: versionId || null };
    }

    // Ask Redmine for every issue in the current sprint that has ever
    // been in the reopen status — including ones now closed or moved
    // elsewhere.
    //
    // Two-phase strategy (as of 6.5.3):
    //   Phase A — direct filter query with `status_id=<REOPEN_STATUS_ID>`
    //             to grab everything CURRENTLY sitting in Reopen. One
    //             HTTP call, no per-issue scan.
    //   Phase B — pull the full sprint issue list (all statuses),
    //             subtract the Phase-A hits, and journal-scan the
    //             remainder for a historical status change to Reopen.
    //             Journal scan uses BOTH the status regex and the
    //             hardcoded status id — whichever matches wins.
    //
    // NOTE: Redmine's issue query DSL has no "was ever in status X"
    // filter operator (the `w` op is *this-week* date, not "was").
    // The Phase-B scan is the only reliable Redmine-4/5 plugin-free
    // way to get historical status membership.
    //
    // We use the HTML endpoint (not /issues.json) for the same reason
    // bulk-close switched off the JSON REST API in 6.4.2: on Redmine
    // instances where the REST API is disabled or rejects
    // session-cookie auth, JSON responses come back as 401 with
    // WWW-Authenticate: Basic and pop the browser's credential dialog.
    async function fetchReopenedIssues({ projectSlug, versionId, statusRegex, statusId, onProgress, prevPartial }) {
        const pattern    = statusRegex || REOPEN_STATUS_REGEX;
        const reopenId   = statusId    || REOPEN_STATUS_ID;
        const basePath   = projectSlug ? ("/projects/" + encodeURIComponent(projectSlug) + "/issues") : "/issues";

        console.info("[QA Assistant] fetchReopenedIssues start", { projectSlug, versionId, reopenId });

        // Local helper — run one page of a Redmine issue list query
        // and parse the resulting HTML into a plain array of issue
        // metadata. `extraFilters` is a callback that mutates the
        // URLSearchParams to add whatever status filter this phase
        // needs.
        async function queryIssuesPage(extraFilters, page) {
            const params = new URLSearchParams();
            params.append("set_filter", "1");
            if (versionId) {
                params.append("f[]", "fixed_version_id");
                params.append("op[fixed_version_id]", "=");
                params.append("v[fixed_version_id][]", versionId);
            }
            params.append("c[]", "tracker");
            params.append("c[]", "status");
            params.append("c[]", "subject");
            params.append("c[]", "assigned_to");
            params.append("c[]", "updated_on");
            params.append("per_page", "100");
            if (page && page > 1) params.append("page", String(page));
            extraFilters(params);
            const url = basePath + "?" + params.toString();
            console.info("[QA Assistant] GET", url);
            const res = await fetch(url, {
                credentials: "include",
                headers: { "Accept": "text/html" }
            });
            if (!res.ok) throw new Error("Redmine query failed (HTTP " + res.status + ")");
            const doc = new DOMParser().parseFromString(await res.text(), "text/html");
            const rows = [];
            doc.querySelectorAll("tr[id^='issue-']").forEach(tr => {
                const idMatch = tr.id.match(/^issue-(\d+)$/);
                if (!idMatch) return;
                const subject = (tr.querySelector("td.subject a") || tr.querySelector("td.subject") || {}).textContent || "";
                const status  = (tr.querySelector("td.status") || {}).textContent || "";
                const tracker = (tr.querySelector("td.tracker") || {}).textContent || "";
                const assignee= (tr.querySelector("td.assigned_to") || {}).textContent || "";
                const updated = (tr.querySelector("td.updated_on") || {}).textContent || "";
                rows.push({
                    id: idMatch[1],
                    subject: subject.trim(),
                    status: status.trim(),
                    tracker: tracker.trim(),
                    assignee: assignee.trim(),
                    updated_on: updated.trim()
                });
            });
            // Total-in-query from pagination footer (for truncation reporting).
            let total = rows.length;
            const items = doc.querySelector(".pagination .items, span.pagination-info");
            if (items) {
                const tm = items.textContent.match(/\/\s*(\d+)/);
                if (tm) total = parseInt(tm[1], 10);
            }
            return { rows: rows, total: total };
        }

        // Loop `queryIssuesPage` until we've pulled every row Redmine
        // says exists for this filter. Redmine caps `per_page` at
        // 100 on most instances, so a 347-issue sprint needs 4
        // requests to be complete. Hard safety cap at 20 pages
        // (=2000 issues) so a runaway pagination bug can't hammer
        // the server.
        async function queryAllIssues(extraFilters, label) {
            const allRows = [];
            let total = 0;
            for (let page = 1; page <= 20; page++) {
                const pageRes = await queryIssuesPage(extraFilters, page);
                allRows.push.apply(allRows, pageRes.rows);
                total = pageRes.total || allRows.length;
                console.info("[QA Assistant]", label, "page", page, "→", pageRes.rows.length, "rows (running total", allRows.length, "/", total, ")");
                if (pageRes.rows.length === 0) break;
                if (allRows.length >= total) break;
            }
            return { rows: allRows, total: total };
        }

        // -----------------------------------------------------------------
        // RESUME SUPPORT — when a previous scan of this same board scope
        // hit the wall-clock cap, the click handler passes the cached
        // partial result back in via `prevPartial`. We then skip Phase A
        // (already known), reuse Phase B's issue list, and only journal-
        // scan the candidates whose ids AREN'T in the prev-scanned set.
        // Every click therefore chips away at the remaining sprint until
        // it's fully scanned — no rescan, no wasted HTTP.
        // -----------------------------------------------------------------
        let currentlyReopened = [];
        let phaseB;
        let candidates;
        const historyMatches = [];
        const scannedIds = new Set();

        if (prevPartial && prevPartial.timedOut && prevPartial.allCandidates && prevPartial.scannedIds) {
            console.info("[QA Assistant] Resuming from partial cache —",
                prevPartial.scannedIds.length, "already scanned,",
                prevPartial.historyMatches.length, "hits carried forward");
            currentlyReopened = prevPartial.currentlyReopened || [];
            phaseB = { rows: prevPartial.allSprintRows || [], total: prevPartial.sprintTotalCount || 0 };
            (prevPartial.historyMatches || []).forEach(h => historyMatches.push(h));
            prevPartial.scannedIds.forEach(id => scannedIds.add(id));
            candidates = prevPartial.allCandidates.filter(c => !scannedIds.has(c.id));
        } else {
            // Fresh scan — run both Redmine queries.
            // Phase A — currently reopened (fast, direct).
            try {
                const phaseA = await queryAllIssues((params) => {
                    params.append("f[]", "status_id");
                    params.append("op[status_id]", "=");
                    params.append("v[status_id][]", reopenId);
                }, "Phase A");
                currentlyReopened = phaseA.rows;
                console.info("[QA Assistant] Phase A (currently reopened):", currentlyReopened.length);
            } catch (e) {
                console.warn("[QA Assistant] Phase A failed, continuing to Phase B:", e);
            }

            // Phase B — full sprint list (open + closed), any status.
            phaseB = await queryAllIssues((params) => {
                params.append("status_id", "*");
            }, "Phase B");
            console.info("[QA Assistant] Phase B (all sprint issues):", phaseB.rows.length, "/", phaseB.total);

            // Subtract Phase-A hits so we don't re-scan them.
            const knownIds = new Set(currentlyReopened.map(r => r.id));
            candidates = phaseB.rows.filter(r => !knownIds.has(r.id));
        }
        console.info("[QA Assistant] Journal-scan candidates this pass:", candidates.length,
            "(", scannedIds.size, "already scanned in previous passes )");

        // Phase B history scan — bounded parallelism so we don't
        // blast Redmine (some hosts throttle aggressively), and a
        // wall-clock cap so the button never appears to hang. If
        // the cap trips we return what we have so far — a partial
        // result is better than a silent freeze; the next click
        // will resume from where we stopped.
        const CONCURRENCY  = 12;
        const SCAN_TIMEOUT_MS = 180000; // 3 minutes
        const scanStart    = performance.now();
        let checked  = 0;
        let timedOut = false;

        // Persistent per-issue journal cache — repeat scans skip
        // /issues/<id> when the issue's updated_on hasn't advanced
        // since we last checked it. patternSig invalidates entries
        // whenever the reopen-status regex changes.
        const REOPEN_CACHE_KEY = "qa.reopen.journalCache.v1";
        const REOPEN_CACHE_MAX = 5000;
        const patternSig = String(pattern);
        let jCache = {};
        try {
            const raw = localStorage.getItem(REOPEN_CACHE_KEY);
            if (raw) jCache = JSON.parse(raw) || {};
        } catch (_) { jCache = {}; }
        let cacheHits = 0;

        if (onProgress) onProgress(checked, candidates.length);
        for (let i = 0; i < candidates.length; i += CONCURRENCY) {
            if (performance.now() - scanStart > SCAN_TIMEOUT_MS) {
                timedOut = true;
                console.warn("[QA Assistant] Journal scan hit", SCAN_TIMEOUT_MS, "ms cap after", checked, "/", candidates.length, "this pass — returning partial result (next click resumes)");
                break;
            }
            const batch = candidates.slice(i, i + CONCURRENCY);
            const batchStart = performance.now();
            const results = await Promise.all(batch.map(async (issue) => {
                const cached = jCache[issue.id];
                if (cached && cached.updated === issue.updated_on && cached.sig === patternSig) {
                    cacheHits++;
                    return { issue: issue, match: !!cached.match };
                }
                try {
                    const res = await fetch("/issues/" + issue.id, {
                        credentials: "include",
                        headers: { "Accept": "text/html" }
                    });
                    if (!res.ok) return { issue: issue, match: false };
                    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
                    const match = issueHistoryHasStatus(doc, pattern);
                    jCache[issue.id] = { updated: issue.updated_on || "", sig: patternSig, match: match, savedAt: Date.now() };
                    return { issue: issue, match: match };
                } catch (_) { return { issue: issue, match: false }; }
            }));
            results.forEach(r => {
                scannedIds.add(r.issue.id);
                if (r.match) historyMatches.push(r.issue);
            });
            checked += batch.length;
            if (onProgress) onProgress(checked, candidates.length);
            // Emit a batch log every ~5 batches so the console shows
            // steady progress instead of a long silent gap.
            if (i % (CONCURRENCY * 5) === 0 || checked === candidates.length) {
                console.info("[QA Assistant] Journal scan", checked, "/", candidates.length,
                    "(batch", Math.round(performance.now() - batchStart), "ms, hits so far", historyMatches.length, ")");
            }
        }

        // Persist the cache; evict oldest entries if it grew past the cap.
        try {
            const entries = Object.entries(jCache);
            if (entries.length > REOPEN_CACHE_MAX) {
                entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
                jCache = Object.fromEntries(entries.slice(0, REOPEN_CACHE_MAX));
            }
            localStorage.setItem(REOPEN_CACHE_KEY, JSON.stringify(jCache));
        } catch (_) { /* quota or storage disabled — non-fatal */ }

        const scanDurationMs = Math.round(performance.now() - scanStart);
        console.info("[QA Assistant] Historical matches:", historyMatches.length,
            "(scan took", scanDurationMs, "ms, cache hits", cacheHits, "/", candidates.length,
            ", total scanned across passes:", scannedIds.size, ")");

        // Sort by numeric id descending so newest reopened issues
        // surface at the top of the modal.
        const rows = currentlyReopened.concat(historyMatches).sort(
            (a, b) => parseInt(b.id, 10) - parseInt(a.id, 10)
        );
        console.info("[QA Assistant] fetchReopenedIssues done: total rows =", rows.length);
        // Build a resume snapshot alongside the display data. When the
        // scan completes cleanly (`timedOut === false`) the caller can
        // ignore the resume fields; when it times out the next click
        // uses them via the `prevPartial` parameter.
        const allCandidatesForResume = candidates.concat(
            // Preserve the union: on a resume pass, `candidates` only
            // held unscanned rows; we need to remember the FULL
            // candidate list so a later resume can subtract again.
            prevPartial && prevPartial.allCandidates
                ? prevPartial.allCandidates.filter(c => scannedIds.has(c.id) && !candidates.some(x => x.id === c.id))
                : []
        );
        return {
            rows: rows,
            totalCount: rows.length,
            sprintTotalCount: phaseB.total,
            scannedCount: scannedIds.size,
            timedOut: timedOut,
            // Resume snapshot (used when `timedOut` is true).
            currentlyReopened: currentlyReopened,
            allSprintRows: phaseB.rows,
            allCandidates: allCandidatesForResume,
            scannedIds: Array.from(scannedIds),
            historyMatches: historyMatches
        };
    }

    // True when the given issue-detail document's history journal
    // contains a status change whose new-value text matches the
    // supplied regex. English-locale only (README + package limit
    // us to English Redmine, so no i18n needed).
    function issueHistoryHasStatus(doc, pattern) {
        const history = doc.querySelector("#history") || doc.querySelector("#issue-history");
        if (!history) return false;
        // Journal property changes: `<ul class="details"><li>
        //   <strong>Status</strong> changed from
        //   <i class="old-value">In Progress</i> to
        //   <i class="new-value">Development: Reopen</i>
        // </li>`. Any other property change ("Assignee", "Priority",
        // etc.) shares this markup, so we filter on the <strong>
        // label first.
        const changeItems = history.querySelectorAll("ul.details li");
        for (const li of changeItems) {
            const strong = li.querySelector("strong");
            if (!strong) continue;
            if (strong.textContent.trim().toLowerCase() !== "status") continue;
            const values = li.querySelectorAll("i");
            if (!values.length) continue;
            // Last <i> is the new value (Redmine renders old before new).
            const newVal = values[values.length - 1].textContent.trim();
            if (pattern.test(newVal)) return true;
        }
        return false;
    }

    //////////////////////////////////////////////////////
    // Similar closed tickets (issue detail pages)
    //////////////////////////////////////////////////////

    const SIMILAR_CACHE_KEY       = "qa.similar.v2";
    const SIMILAR_CACHE_MAX       = 500;
    const SIMILAR_RESULT_LIMIT    = 100;
    const SIMILAR_INITIAL_VISIBLE = 5;
    const SIMILAR_PAGE_SIZE       = 10;
    // Empirically: 0.10 catches partial reworded matches while still filtering
    // one-token coincidences ("login" alone etc.).
    const SIMILAR_MIN_SCORE       = 0.10;

    // Kept small on purpose — over-filtering costs legitimate keywords.
    const SIMILAR_STOPWORDS = new Set([
        "a","an","the","and","or","but","if","of","in","on","at","to","for",
        "with","without","by","from","is","are","was","were","be","been","being",
        "it","its","this","that","these","those","as","when","while","not","no",
        "do","does","did","doing","have","has","had","will","would","should","could",
        "can","cannot","cant","doesnt","isnt","wasnt","werent","dont",
        "bug","issue","ticket","error","problem","fix","fixed"
    ]);

    // Lowercase, strip punctuation, drop stopwords + short tokens, dedupe.
    function similarTokens(text) {
        if (!text) return [];
        const raw = String(text).toLowerCase()
            .replace(/[^a-z0-9\s]+/g, " ")
            .split(/\s+/);
        const seen = new Set();
        const out = [];
        for (const t of raw) {
            if (t.length < 3) continue;
            if (SIMILAR_STOPWORDS.has(t)) continue;
            if (seen.has(t)) continue;
            seen.add(t); out.push(t);
        }
        return out;
    }

    // Redmine's subject filter is substring-only. Passing multiple values
    // as separate `v[subject][]` entries OR's them (`LIKE '%a%' OR LIKE '%b%' …`),
    // so we hand it the top ~5 most discriminative (longest) tokens and let
    // the client re-rank the OR'd result set.
    function similarKeywords(tokens) {
        return tokens.slice().sort((a, b) => b.length - a.length).slice(0, 5);
    }

    function similarJaccard(a, b) {
        if (!a.length || !b.length) return 0;
        const B = new Set(b);
        let inter = 0;
        for (const t of a) if (B.has(t)) inter++;
        const union = a.length + b.length - inter;
        return union ? inter / union : 0;
    }

    // Reads the current issue detail page. Returns null when this isn't
    // an issue detail view or we can't recover the id / subject.
    function similarScrapeCurrent() {
        if (!isIssueDetailPage()) return null;
        const idMatch = location.pathname.match(/\/issues\/(\d+)/);
        if (!idMatch) return null;

        // Prefer `.subject h3` (modern Redmine shows the real subject there;
        // the h2 is just `Tracker #id`). Fall back to `#content h2` for older
        // themes that render `Tracker #id: subject` in a single line.
        const subjEl = document.querySelector(".subject h3, .subject > div > h3");
        let subject = subjEl ? subjEl.textContent.trim().replace(/\s+/g, " ") : "";
        if (!subject) {
            const hdr = document.querySelector("#content h2");
            const rawTitle = hdr ? hdr.textContent.trim().replace(/\s+/g, " ") : "";
            subject = rawTitle.replace(/^[A-Za-z ]+#\d+:?\s*/, "").trim();
        }
        if (!subject) return null;

        const readAttr = (cls) => {
            const el = document.querySelector(".attributes .attribute." + cls + " .value")
                    || document.querySelector(".attributes ." + cls + " .value")
                    || document.querySelector(".attributes td.value." + cls);
            return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
        };

        const descEl = document.querySelector(".description .wiki") || document.querySelector("#issue_description_wiki");
        const description = descEl ? (descEl.innerText || descEl.textContent || "").trim() : "";

        return { id: idMatch[1], subject: subject, tracker: readAttr("tracker"), description: description };
    }

    // The raw Redmine slug the URL uses — projectKeyFromBodyClass() maps
    // to our internal PROJECT key, which is different.
    function similarProjectSlug() {
        if (!document.body || !document.body.className) return null;
        const m = document.body.className.match(/\bproject-([\w-]+)/);
        return m ? m[1] : null;
    }

    // Queries closed tickets in the same project whose subjects overlap
    // the current issue's, then re-ranks locally. Returns { results, keywords }.
    async function fetchSimilarClosedTickets(current, projectSlug) {
        const tokens = similarTokens(current.subject);
        if (tokens.length < 2) return { results: [], keywords: [] };
        const keywords = similarKeywords(tokens);
        const descTokens = similarTokens(current.description);

        const basePath = projectSlug
            ? ("/projects/" + encodeURIComponent(projectSlug) + "/issues")
            : "/issues";
        const params = new URLSearchParams();
        params.append("set_filter", "1");
        params.append("f[]", "status_id");
        params.append("op[status_id]", "c");
        params.append("f[]", "subject");
        params.append("op[subject]", "~");
        // Redmine OR's separate `v[subject][]` entries under `~`.
        keywords.forEach(k => params.append("v[subject][]", k));
        params.append("c[]", "tracker");
        params.append("c[]", "status");
        params.append("c[]", "subject");
        params.append("c[]", "description");
        params.append("c[]", "updated_on");
        params.append("c[]", "cf_" + CLOSED_VERSION_CF_ID);
        params.append("sort", "updated_on:desc");
        params.append("per_page", "100");

        const url = basePath + "?" + params.toString();
        console.info("[QA Assistant] Similar closed tickets — GET", url);
        const res = await fetch(url, {
            credentials: "include",
            headers: { "Accept": "text/html" }
        });
        if (!res.ok) throw new Error("Redmine query failed (HTTP " + res.status + ")");
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");

        const currentTracker = String(current.tracker || "").toLowerCase();
        const candidates = [];
        doc.querySelectorAll("tr[id^='issue-']").forEach(tr => {
            const m = tr.id.match(/^issue-(\d+)$/);
            if (!m) return;
            const id = m[1];
            if (id === current.id) return;
            const subject = ((tr.querySelector("td.subject a") || tr.querySelector("td.subject") || {}).textContent || "").trim();
            const tracker = ((tr.querySelector("td.tracker") || {}).textContent || "").trim();
            // QA-internal test cases would dominate the ranking otherwise.
            if (tracker.toLowerCase() === "test case") return;
            const status = ((tr.querySelector("td.status") || {}).textContent || "").trim();
            const closedVersion = ((tr.querySelector("td.cf_" + CLOSED_VERSION_CF_ID) || {}).textContent || "").trim();
            // Description renders as its own row right after the issue row
            // (no id of its own) rather than a <td> inside the row itself.
            const descRow = tr.nextElementSibling;
            const descText = (descRow && !/^issue-/.test(descRow.id || ""))
                ? ((descRow.querySelector(".wiki") || descRow).textContent || "").trim()
                : "";
            const candTokens = similarTokens(subject);
            const candDescTokens = similarTokens(descText);
            const jacc = similarJaccard(tokens, candTokens);
            const descJacc = similarJaccard(descTokens, candDescTokens);
            const trackerBoost = (currentTracker && tracker.toLowerCase() === currentTracker) ? 0.3 : 0;
            const score = jacc * 0.55 + descJacc * 0.15 + trackerBoost;
            // Kept even below threshold — the panel offers a "show all"
            // control so users can still see every fetched candidate.
            candidates.push({ id, subject, tracker, status, closedVersion, score, lowMatch: score < SIMILAR_MIN_SCORE });
        });
        candidates.sort((a, b) => b.score - a.score);
        return { results: candidates.slice(0, SIMILAR_RESULT_LIMIT), keywords: keywords };
    }

    function similarCacheLoad() {
        try {
            const raw = localStorage.getItem(SIMILAR_CACHE_KEY);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch (_) { return {}; }
    }
    function similarCacheSave(cache) {
        try {
            const entries = Object.entries(cache);
            let trimmed = cache;
            if (entries.length > SIMILAR_CACHE_MAX) {
                entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
                trimmed = Object.fromEntries(entries.slice(0, SIMILAR_CACHE_MAX));
            }
            localStorage.setItem(SIMILAR_CACHE_KEY, JSON.stringify(trimmed));
        } catch (_) { /* quota or storage disabled — non-fatal */ }
    }
    // Ties an entry to the current subject+tracker so a rename invalidates it.
    function similarCacheSig(current) {
        return (current.subject || "") + "|" + (current.tracker || "");
    }

    //////////////////////////////////////////////////////
    // Sprint audit (Agile board)
    //////////////////////////////////////////////////////

    // Multi-status variant of issueHistoryHasStatus — walks the journal
    // once and reports which of the supplied patterns transitioned into.
    // Short-circuits when every pattern has already matched.
    function issueHistoryStatusHits(doc, patterns) {
        const hits = {};
        patterns.forEach(p => { hits[p.key] = false; });
        const history = doc.querySelector("#history") || doc.querySelector("#issue-history");
        if (!history) return hits;
        const changeItems = history.querySelectorAll("ul.details li");
        for (const li of changeItems) {
            const strong = li.querySelector("strong");
            if (!strong) continue;
            if (strong.textContent.trim().toLowerCase() !== "status") continue;
            const values = li.querySelectorAll("i");
            if (!values.length) continue;
            const newVal = values[values.length - 1].textContent.trim();
            let allMatched = true;
            patterns.forEach(p => {
                if (!hits[p.key] && p.regex.test(newVal)) hits[p.key] = true;
                if (!hits[p.key]) allMatched = false;
            });
            if (allMatched) break;
        }
        return hits;
    }

    // Combined journal scanner — fetches each candidate's issue detail
    // page ONCE and reports historical hits for every supplied status
    // pattern. Halves the audit's HTTP cost vs running fetchReopenedIssues
    // twice. Also enriches the sprint list with priority + cf_12 so the
    // audit doesn't need a separate list query.
    async function scanSprintForStatuses({ projectSlug, versionId, patterns, prevPartial, onProgress }) {
        const basePath = projectSlug
            ? ("/projects/" + encodeURIComponent(projectSlug) + "/issues")
            : "/issues";

        async function queryList(extraFilters) {
            const rows = [];
            let total = 0;
            for (let page = 1; page <= 20; page++) {
                const params = new URLSearchParams();
                params.append("set_filter", "1");
                if (versionId) {
                    params.append("f[]", "fixed_version_id");
                    params.append("op[fixed_version_id]", "=");
                    params.append("v[fixed_version_id][]", versionId);
                }
                params.append("c[]", "tracker");
                params.append("c[]", "status");
                params.append("c[]", "subject");
                params.append("c[]", "assigned_to");
                params.append("c[]", "author");
                params.append("c[]", "priority");
                params.append("c[]", "updated_on");
                params.append("c[]", "cf_" + CLOSED_VERSION_CF_ID);
                params.append("per_page", "100");
                if (page > 1) params.append("page", String(page));
                extraFilters(params);
                const res = await fetch(basePath + "?" + params.toString(), {
                    credentials: "include", headers: { "Accept": "text/html" }
                });
                if (!res.ok) throw new Error("Redmine query failed (HTTP " + res.status + ")");
                const doc = new DOMParser().parseFromString(await res.text(), "text/html");
                let pageRows = 0;
                doc.querySelectorAll("tr[id^='issue-']").forEach(tr => {
                    const m = tr.id.match(/^issue-(\d+)$/);
                    if (!m) return;
                    rows.push({
                        id: m[1],
                        subject:       ((tr.querySelector("td.subject a") || tr.querySelector("td.subject") || {}).textContent || "").trim(),
                        status:        ((tr.querySelector("td.status")      || {}).textContent || "").trim(),
                        tracker:       ((tr.querySelector("td.tracker")     || {}).textContent || "").trim().replace(/\s+/g, " "),
                        assignee:      ((tr.querySelector("td.assigned_to") || {}).textContent || "").trim(),
                        author:        ((tr.querySelector("td.author a")    || tr.querySelector("td.author") || {}).textContent || "").trim().replace(/\s+/g, " "),
                        priority:      ((tr.querySelector("td.priority")    || {}).textContent || "").trim(),
                        updated_on:    ((tr.querySelector("td.updated_on")  || {}).textContent || "").trim(),
                        closedVersion: ((tr.querySelector("td.cf_" + CLOSED_VERSION_CF_ID) || {}).textContent || "").trim()
                    });
                    pageRows++;
                });
                const items = doc.querySelector(".pagination .items, span.pagination-info");
                if (items) {
                    const tm = items.textContent.match(/\/\s*(\d+)/);
                    if (tm) total = parseInt(tm[1], 10);
                }
                if (pageRows === 0) break;
                if (rows.length >= (total || rows.length)) break;
            }
            return { rows: rows, total: total || rows.length };
        }

        // Resume vs fresh scan. On resume we skip Phase A/B and reuse the
        // candidate list + hits from the previous partial run.
        let currentlyAt, phaseB, candidates, historyByPattern;
        const scannedIds = new Set();

        if (prevPartial && Array.isArray(prevPartial.candidates) && prevPartial.candidates.length) {
            currentlyAt = prevPartial.currentlyAt || {};
            patterns.forEach(p => { if (!currentlyAt[p.key]) currentlyAt[p.key] = []; });
            phaseB = {
                rows:  prevPartial.allSprintRows    || [],
                total: prevPartial.sprintTotalCount || 0
            };
            candidates       = prevPartial.candidates;
            historyByPattern = prevPartial.historyByPattern || {};
            patterns.forEach(p => { if (!historyByPattern[p.key]) historyByPattern[p.key] = []; });
            (prevPartial.scannedIds || []).forEach(id => scannedIds.add(id));
            console.info("[QA Assistant] Resuming journal scan from checkpoint:",
                scannedIds.size, "/", candidates.length, "already checked");
        } else {
            // Phase A per pattern — currently at each pattern's status.
            currentlyAt = {};
            await Promise.all(patterns.map(async p => {
                try {
                    const q = await queryList((params) => {
                        params.append("f[]", "status_id");
                        params.append("op[status_id]", "=");
                        params.append("v[status_id][]", p.statusId);
                    });
                    currentlyAt[p.key] = q.rows;
                } catch (e) {
                    console.warn("[QA Assistant] Phase A (" + p.key + ") failed:", e);
                    currentlyAt[p.key] = [];
                }
            }));
            patterns.forEach(p => console.info("[QA Assistant] Phase A", p.key + ":", currentlyAt[p.key].length));

            // Phase B — full sprint list.
            phaseB = await queryList((params) => { params.append("status_id", "*"); });
            console.info("[QA Assistant] Phase B (all sprint issues):", phaseB.rows.length, "/", phaseB.total);

            // Subtract union of all Phase-A ids from Phase B candidates.
            const knownIds = new Set();
            patterns.forEach(p => currentlyAt[p.key].forEach(r => knownIds.add(r.id)));
            candidates = phaseB.rows.filter(r => !knownIds.has(r.id));
            console.info("[QA Assistant] Combined journal scan candidates:", candidates.length);

            historyByPattern = {};
            patterns.forEach(p => { historyByPattern[p.key] = []; });
        }

        const CONCURRENCY = 12;
        const SCAN_TIMEOUT_MS = 240000; // 4 min — combined scan does 2× the work per fetch, so budget is roomier
        const scanStart = performance.now();
        const remaining = candidates.filter(c => !scannedIds.has(c.id));
        let checked = scannedIds.size;
        let timedOut = false;

        // Persistent per-issue journal cache — repeat audits skip /issues/<id>
        // when the issue's updated_on hasn't advanced since we last scanned it.
        // patternSig invalidates entries whenever the pattern set changes.
        const JOURNAL_CACHE_KEY = "qa.audit.journalCache.v1";
        const JOURNAL_CACHE_MAX = 5000;
        const patternSig = patterns.map(p => p.key).slice().sort().join(",");
        let jCache = {};
        try {
            const raw = localStorage.getItem(JOURNAL_CACHE_KEY);
            if (raw) jCache = JSON.parse(raw) || {};
        } catch (_) { jCache = {}; }
        let cacheHits = 0;

        if (onProgress) onProgress(checked, candidates.length);
        for (let i = 0; i < remaining.length; i += CONCURRENCY) {
            if (performance.now() - scanStart > SCAN_TIMEOUT_MS) {
                timedOut = true;
                console.warn("[QA Assistant] Combined scan hit cap after", checked, "/", candidates.length);
                break;
            }
            const batch = remaining.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(async (issue) => {
                const cached = jCache[issue.id];
                if (cached && cached.updated === issue.updated_on && cached.sig === patternSig) {
                    cacheHits++;
                    return { issue: issue, hits: cached.hits };
                }
                try {
                    const res = await fetch("/issues/" + issue.id, {
                        credentials: "include", headers: { "Accept": "text/html" }
                    });
                    if (!res.ok) return { issue: issue, hits: null };
                    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
                    const hits = issueHistoryStatusHits(doc, patterns);
                    jCache[issue.id] = { updated: issue.updated_on || "", sig: patternSig, hits: hits, savedAt: Date.now() };
                    return { issue: issue, hits: hits };
                } catch (_) { return { issue: issue, hits: null }; }
            }));
            results.forEach(r => {
                scannedIds.add(r.issue.id);
                if (!r.hits) return;
                patterns.forEach(p => { if (r.hits[p.key]) historyByPattern[p.key].push(r.issue); });
            });
            checked = scannedIds.size;
            if (onProgress) onProgress(checked, candidates.length);
        }

        // Persist the cache; evict oldest entries if it grew past the cap.
        try {
            const entries = Object.entries(jCache);
            if (entries.length > JOURNAL_CACHE_MAX) {
                entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
                jCache = Object.fromEntries(entries.slice(0, JOURNAL_CACHE_MAX));
            }
            localStorage.setItem(JOURNAL_CACHE_KEY, JSON.stringify(jCache));
        } catch (_) { /* quota or storage disabled — non-fatal */ }

        console.info("[QA Assistant] Combined scan done in", Math.round(performance.now() - scanStart), "ms;",
            "cache hits:", cacheHits, "/", remaining.length, ";",
            patterns.map(p => p.key + "=" + historyByPattern[p.key].length).join(", "),
            (timedOut ? "(partial)" : ""));

        const perPattern = {};
        patterns.forEach(p => {
            const merged = currentlyAt[p.key].concat(historyByPattern[p.key])
                .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
            perPattern[p.key] = {
                rows: merged,
                count: merged.length,
                currentlyAt: currentlyAt[p.key]
            };
        });

        return {
            perPattern:       perPattern,
            allSprintRows:    phaseB.rows,
            sprintTotalCount: phaseB.total,
            scannedCount:     checked,
            totalCandidates:  candidates.length,
            timedOut:         timedOut,
            // Only kept when the scan bailed early so the next click can
            // pick up where we left off.
            resumeState: timedOut ? {
                candidates:       candidates,
                scannedIds:       Array.from(scannedIds),
                historyByPattern: historyByPattern,
                currentlyAt:      currentlyAt,
                allSprintRows:    phaseB.rows,
                sprintTotalCount: phaseB.total
            } : null
        };
    }

    // One-click end-of-sprint report against a Redmine version. Returns a
    // structured audit object (overview, per-tracker volume, churn, reopens,
    // assignee stats, verdict). The UI layer renders it into the audit modal.
    async function runSprintAudit({ projectSlug, versionId, prevPartial, onProgress }) {
        const basePath = projectSlug
            ? ("/projects/" + encodeURIComponent(projectSlug) + "/issues")
            : "/issues";

        // Urgent/Immediate-still-open — single list query, no journal scan.
        async function fetchUrgentStillOpen() {
            const params = new URLSearchParams();
            params.append("set_filter", "1");
            if (versionId) {
                params.append("f[]", "fixed_version_id");
                params.append("op[fixed_version_id]", "=");
                params.append("v[fixed_version_id][]", versionId);
            }
            params.append("f[]", "priority_id");
            params.append("op[priority_id]", "=");
            URGENT_PRIORITY_IDS.forEach(id => params.append("v[priority_id][]", id));
            params.append("f[]", "status_id");
            params.append("op[status_id]", "o");
            params.append("c[]", "tracker");
            params.append("c[]", "subject");
            params.append("per_page", "100");
            try {
                const res = await fetch(basePath + "?" + params.toString(), {
                    credentials: "include", headers: { "Accept": "text/html" }
                });
                if (!res.ok) return [];
                const doc = new DOMParser().parseFromString(await res.text(), "text/html");
                const out = [];
                doc.querySelectorAll("tr[id^='issue-']").forEach(tr => {
                    const m = tr.id.match(/^issue-(\d+)$/);
                    if (!m) return;
                    out.push({
                        id: m[1],
                        tracker: ((tr.querySelector("td.tracker") || {}).textContent || "").trim(),
                        subject: ((tr.querySelector("td.subject a") || tr.querySelector("td.subject") || {}).textContent || "").trim()
                    });
                });
                return out;
            } catch (_) { return []; }
        }

        if (onProgress) onProgress(prevPartial ? "Resuming…" : "Preparing…", 0, 0);
        const [scanResult, urgentOpen] = await Promise.all([
            scanSprintForStatuses({
                projectSlug: projectSlug,
                versionId:   versionId,
                patterns: [
                    { key: "reopen",   regex: REOPEN_STATUS_REGEX,   statusId: REOPEN_STATUS_ID },
                    { key: "feedback", regex: FEEDBACK_STATUS_REGEX, statusId: FEEDBACK_STATUS_ID }
                ],
                prevPartial: prevPartial && prevPartial.resumeState ? prevPartial.resumeState : null,
                onProgress: (done, total) => {
                    if (!onProgress) return;
                    if (total > 0) onProgress("Scanning journals…", done, total);
                    else onProgress("Fetching sprint list…", 0, 0);
                }
            }),
            fetchUrgentStillOpen()
        ]);
        console.info("[QA Assistant] Sprint audit —",
            "sprint:", scanResult.allSprintRows.length,
            "urgent-open:", urgentOpen.length,
            "reopens:", scanResult.perPattern.reopen.count,
            "feedback:", scanResult.perPattern.feedback.count,
            scanResult.timedOut ? "(partial)" : "");

        // Test cases are QA-internal artefacts — exclude them from every
        // aggregate the audit reports on (overview, tracker breakdown,
        // untriaged, missing Closed version, reopens, churn, urgent).
        const EXCLUDED_TRACKERS = new Set(["test case"]);
        const notExcluded = (r) => !EXCLUDED_TRACKERS.has(String(r.tracker || "").toLowerCase());

        const sprintRows  = scanResult.allSprintRows.filter(notExcluded);
        const isClosed    = (s) => /closed/i.test(s || "");
        const totalIssues = sprintRows.length;
        const closedRows  = sprintRows.filter(r => isClosed(r.status));
        const openRows    = sprintRows.filter(r => !isClosed(r.status));

        const bucket = new Map();
        sprintRows.forEach(r => {
            const key = r.tracker || "(none)";
            if (!bucket.has(key)) bucket.set(key, { name: key, total: 0, closed: 0, open: 0 });
            const b = bucket.get(key);
            b.total++;
            if (isClosed(r.status)) b.closed++; else b.open++;
        });
        const byTracker = [];
        TRACKER_ORDER.forEach(k => {
            const nm = TRACKERS[k].name;
            if (bucket.has(nm)) { byTracker.push(bucket.get(nm)); bucket.delete(nm); }
        });
        Array.from(bucket.values()).forEach(b => byTracker.push(b));

        const untriaged = sprintRows
            .filter(r => !r.assignee)
            .map(r => ({ id: r.id, subject: r.subject }));

        const mismatched = closedRows
            .filter(r => !r.closedVersion)
            .map(r => ({ id: r.id, subject: r.subject }));

        // Proxy: reopened row's current assignee ≈ dev responsible when it
        // was reopened, since QA usually reassigns back to the dev on reopen.
        function tally(rows, keyFn) {
            const m = new Map();
            rows.forEach(r => {
                const k = keyFn(r) || "(unassigned)";
                m.set(k, (m.get(k) || 0) + 1);
            });
            return Array.from(m.entries())
                .map(([name, count]) => ({ name: name, count: count }))
                .sort((a, b) => b.count - a.count);
        }
        const reopenRows       = scanResult.perPattern.reopen.rows.filter(notExcluded);
        const feedbackRows     = scanResult.perPattern.feedback.rows.filter(notExcluded);
        const reopensAgainst   = tally(reopenRows, r => r.assignee);

        // Reported By — Bugs + Suggestions filed by each QA team member in this sprint.
        const qaSet = new Set(QA_TEAM_MEMBERS);
        const reportedByMap = new Map();
        QA_TEAM_MEMBERS.forEach(n => reportedByMap.set(n, { name: n, bugs: 0, suggestions: 0, total: 0 }));
        sprintRows.forEach(r => {
            if (!qaSet.has(r.author)) return;
            const t = String(r.tracker || "").toLowerCase();
            const b = reportedByMap.get(r.author);
            if (t === "bug")        { b.bugs++; b.total++; }
            else if (t === "suggestion") { b.suggestions++; b.total++; }
        });
        const reportedBy = Array.from(reportedByMap.values())
            .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

        // Historical reopens that are now closed don't block ship.
        const currentlyReopened = reopenRows.filter(r => /reopen/i.test(r.status));

        const verdict = { blockers: [], warnings: [] };
        if (currentlyReopened.length) verdict.blockers.push({
            type: "reopen",
            label: currentlyReopened.length + " ticket" + (currentlyReopened.length === 1 ? "" : "s") + " still in " + REOPEN_STATUS_DISPLAY,
            rows: currentlyReopened
        });
        const urgentOpenFiltered = urgentOpen.filter(notExcluded);
        if (urgentOpenFiltered.length) verdict.blockers.push({
            type: "urgent",
            label: urgentOpenFiltered.length + " Urgent/Immediate ticket" + (urgentOpenFiltered.length === 1 ? "" : "s") + " still open",
            rows: urgentOpenFiltered
        });
        if (mismatched.length) verdict.warnings.push({
            type: "mismatch",
            label: mismatched.length + " Closed ticket" + (mismatched.length === 1 ? "" : "s") + " missing Closed Version tag",
            rows: mismatched
        });
        if (untriaged.length) verdict.warnings.push({
            type: "untriaged",
            label: untriaged.length + " untriaged ticket" + (untriaged.length === 1 ? "" : "s") + " (no assignee)",
            rows: untriaged
        });

        const closedPct   = totalIssues > 0 ? Math.round((closedRows.length / totalIssues) * 100) : 0;
        const reopenPct   = closedRows.length > 0 ? Math.round((reopenRows.length / closedRows.length) * 100) : 0;
        const feedbackPct = totalIssues > 0 ? Math.round((feedbackRows.length / totalIssues) * 100) : 0;

        return {
            overview: { total: totalIssues, closed: closedRows.length, open: openRows.length, closedPct: closedPct },
            byTracker: byTracker,
            untriaged: untriaged,
            mismatched: mismatched,
            feedback:  { count: feedbackRows.length, pct: feedbackPct, rows: feedbackRows, timedOut: scanResult.timedOut },
            reopens:   { count: reopenRows.length,   pct: reopenPct,   rows: reopenRows,   timedOut: scanResult.timedOut, closedTotal: closedRows.length },
            assignees: { reportedBy: reportedBy, reopensAgainst: reopensAgainst },
            verdict:   verdict,
            partial:   scanResult.timedOut,
            resumeState: scanResult.resumeState
        };
    }

    // Serialise an audit result as Markdown. `showAssignees` gates the two
    // per-name sections so the copied Markdown matches what's on screen.
    function renderSprintAuditMarkdown(audit, versionLabel, showAssignees) {
        const lines = [];
        lines.push("# Sprint audit — " + (versionLabel || "current sprint"));
        lines.push("");
        if (audit.partial) {
            lines.push("> ⚠ **Partial results.** The journal scan hit its 4-minute cap before every ticket was checked, so Reopens and Churn counts below may undercount. Re-run the audit or narrow the board to get complete numbers.");
            lines.push("");
        }
        const nB = audit.verdict.blockers.length;
        const nW = audit.verdict.warnings.length;
        const shippable = nB === 0;
        lines.push("## Verdict");
        lines.push("Ready to ship: " + (shippable ? "YES" : "NO") +
            " — " + nB + " blocker" + (nB === 1 ? "" : "s") +
            ", " + nW + " warning" + (nW === 1 ? "" : "s") + ".");
        audit.verdict.blockers.forEach(b => {
            const ids = b.rows.slice(0, 10).map(r => "#" + r.id).join(", ");
            const extra = b.rows.length > 10 ? ", …" : "";
            lines.push("- ❌ " + b.label + (ids ? " (" + ids + extra + ")" : ""));
        });
        audit.verdict.warnings.forEach(w => {
            const ids = w.rows.slice(0, 10).map(r => "#" + r.id).join(", ");
            const extra = w.rows.length > 10 ? ", …" : "";
            lines.push("- ⚠ " + w.label + (ids ? " (" + ids + extra + ")" : ""));
        });
        lines.push("");
        lines.push("## Overview");
        lines.push("Total: " + audit.overview.total +
            " · Closed: " + audit.overview.closed + " (" + audit.overview.closedPct + "%)" +
            " · Open: " + audit.overview.open);
        lines.push("");
        if (audit.byTracker.length) {
            lines.push("## Volume by tracker");
            lines.push("| Tracker | Total | Closed | Open |");
            lines.push("|---------|------:|-------:|-----:|");
            audit.byTracker.forEach(b => {
                lines.push("| " + b.name + " | " + b.total + " | " + b.closed + " | " + b.open + " |");
            });
            lines.push("");
        }
        if (audit.untriaged.length) {
            lines.push("## Untriaged: " + audit.untriaged.length + " ticket" + (audit.untriaged.length === 1 ? "" : "s"));
            audit.untriaged.forEach(u => {
                lines.push("- #" + u.id + " · " + (u.subject || "(no subject)"));
            });
            lines.push("");
        }
        if (audit.mismatched && audit.mismatched.length) {
            lines.push("## Closed tickets missing Closed Version tag: " + audit.mismatched.length + " ticket" + (audit.mismatched.length === 1 ? "" : "s"));
            audit.mismatched.forEach(m => {
                const url = location.origin + "/issues/" + m.id;
                lines.push("- [#" + m.id + "](" + url + ") · " + (m.subject || "(no subject)"));
            });
            lines.push("");
        }
        if (audit.feedback.count) {
            lines.push("## Churn (Feedback bounces): " + audit.feedback.count + " ticket" + (audit.feedback.count === 1 ? "" : "s") + ", " + audit.feedback.pct + "%");
            audit.feedback.rows.forEach(r => {
                const url = location.origin + "/issues/" + r.id;
                lines.push("- [#" + r.id + "](" + url + ") · " + (r.subject || "(no subject)"));
            });
            lines.push("");
        }
        if (audit.reopens.count) {
            lines.push("## Reopens: " + audit.reopens.count + " ticket" + (audit.reopens.count === 1 ? "" : "s") + ", " + audit.reopens.pct + "% (" + audit.reopens.count + " / " + audit.reopens.closedTotal + " closed)");
            audit.reopens.rows.forEach(r => {
                const url = location.origin + "/issues/" + r.id;
                lines.push("- [#" + r.id + "](" + url + ") · " + (r.subject || "(no subject)"));
            });
            lines.push("");
        }
        if (showAssignees && audit.assignees.reportedBy.length) {
            lines.push("## Reported By (Bugs + Suggestions per QA member)");
            lines.push("| QA Member | Bugs | Suggestions | Total |");
            lines.push("|-----------|-----:|------------:|------:|");
            audit.assignees.reportedBy.forEach(b => {
                lines.push("| " + b.name + " | " + b.bugs + " | " + b.suggestions + " | " + b.total + " |");
            });
            lines.push("");
        }
        if (showAssignees && audit.assignees.reopensAgainst.length) {
            lines.push("## Reopens against");
            lines.push(audit.assignees.reopensAgainst.map(a => a.name + " " + a.count).join(" · "));
            lines.push("");
        }
        return lines.join("\n").trim() + "\n";
    }

    // Plain-text variant — same content as renderSprintAuditMarkdown but
    // stripped of Markdown syntax so it can be pasted into email, Teams,
    // release-manager DMs, etc. without rendering artifacts.
    function renderSprintAuditPlain(audit, versionLabel, showAssignees) {
        const lines = [];
        const rule = (s, ch) => ch.repeat(Math.max(s.length, 3));
        const heading = (s) => { lines.push(s); lines.push(rule(s, "-")); };
        const title = "Sprint audit — " + (versionLabel || "current sprint");
        lines.push(title);
        lines.push(rule(title, "="));
        lines.push("");

        if (audit.partial) {
            lines.push("[!] PARTIAL RESULTS — the journal scan hit its 4-minute cap before every ticket was checked.");
            lines.push("    Reopens and Churn counts below may undercount. Re-run the audit or narrow the board");
            lines.push("    (e.g. by tracker or assignee) to get complete numbers.");
            lines.push("");
        }
        const nB = audit.verdict.blockers.length;
        const nW = audit.verdict.warnings.length;
        const shippable = nB === 0;
        heading("Verdict");
        lines.push("Ready to ship: " + (shippable ? "YES" : "NO") +
            " — " + nB + " blocker" + (nB === 1 ? "" : "s") +
            ", " + nW + " warning" + (nW === 1 ? "" : "s") + ".");
        audit.verdict.blockers.forEach(b => {
            const ids = b.rows.slice(0, 10).map(r => "#" + r.id).join(", ");
            const extra = b.rows.length > 10 ? ", …" : "";
            lines.push("  [X] " + b.label + (ids ? " (" + ids + extra + ")" : ""));
        });
        audit.verdict.warnings.forEach(w => {
            const ids = w.rows.slice(0, 10).map(r => "#" + r.id).join(", ");
            const extra = w.rows.length > 10 ? ", …" : "";
            lines.push("  [!] " + w.label + (ids ? " (" + ids + extra + ")" : ""));
        });
        lines.push("");

        heading("Overview");
        lines.push("Total: " + audit.overview.total +
            " · Closed: " + audit.overview.closed + " (" + audit.overview.closedPct + "%)" +
            " · Open: " + audit.overview.open);
        lines.push("");

        if (audit.byTracker.length) {
            heading("Volume by tracker");
            const nameW = Math.max.apply(null, audit.byTracker.map(b => b.name.length).concat([7]));
            audit.byTracker.forEach(b => {
                const nm = b.name + " ".repeat(nameW - b.name.length);
                lines.push("  " + nm + "   Total " + String(b.total).padStart(4) +
                    "   Closed " + String(b.closed).padStart(4) +
                    "   Open " + String(b.open).padStart(4));
            });
            lines.push("");
        }
        if (audit.untriaged.length) {
            heading("Untriaged: " + audit.untriaged.length + " ticket" + (audit.untriaged.length === 1 ? "" : "s"));
            audit.untriaged.forEach(u => {
                lines.push("  #" + u.id + " · " + (u.subject || "(no subject)"));
            });
            lines.push("");
        }
        if (audit.mismatched && audit.mismatched.length) {
            heading("Closed tickets missing Closed Version tag: " + audit.mismatched.length + " ticket" + (audit.mismatched.length === 1 ? "" : "s"));
            audit.mismatched.forEach(m => {
                const url = location.origin + "/issues/" + m.id;
                lines.push("  #" + m.id + " · " + (m.subject || "(no subject)") + " · " + url);
            });
            lines.push("");
        }
        if (audit.feedback.count) {
            heading("Churn (Feedback bounces): " + audit.feedback.count + " ticket" + (audit.feedback.count === 1 ? "" : "s") + ", " + audit.feedback.pct + "%");
            audit.feedback.rows.forEach(r => {
                const url = location.origin + "/issues/" + r.id;
                lines.push("  #" + r.id + " · " + (r.subject || "(no subject)") + " · " + url);
            });
            lines.push("");
        }
        if (audit.reopens.count) {
            heading("Reopens: " + audit.reopens.count + " ticket" + (audit.reopens.count === 1 ? "" : "s") + ", " + audit.reopens.pct + "% (" + audit.reopens.count + " / " + audit.reopens.closedTotal + " closed)");
            audit.reopens.rows.forEach(r => {
                const url = location.origin + "/issues/" + r.id;
                lines.push("  #" + r.id + " · " + (r.subject || "(no subject)") + " · " + url);
            });
            lines.push("");
        }
        if (showAssignees && audit.assignees.reportedBy.length) {
            heading("Reported By (Bugs + Suggestions per QA member)");
            const nameW = Math.max.apply(null, audit.assignees.reportedBy.map(b => b.name.length).concat([9]));
            audit.assignees.reportedBy.forEach(b => {
                const nm = b.name + " ".repeat(nameW - b.name.length);
                lines.push("  " + nm + "   Bugs " + String(b.bugs).padStart(3) +
                    "   Suggestions " + String(b.suggestions).padStart(3) +
                    "   Total " + String(b.total).padStart(3));
            });
            lines.push("");
        }
        if (showAssignees && audit.assignees.reopensAgainst.length) {
            heading("Reopens against");
            lines.push(audit.assignees.reopensAgainst.map(a => a.name + " " + a.count).join(" · "));
            lines.push("");
        }
        return lines.join("\n").trim() + "\n";
    }

    //////////////////////////////////////////////////////
    // Navigation
    //////////////////////////////////////////////////////

    // Build the new-issue URL for a project under a given tracker id. The
    // #qa=<project>&t=<id> marker tells the opened tab which project to auto-fill
    // (assignee) and which tracker to keep selected.
    function newIssueUrl(project, trackerId) {
        const p = PROJECTS[project];
        if (!p) return "#";
        return REDMINE + p.path + "?issue[tracker_id]=" + trackerId + "#qa=" + project + "&t=" + trackerId;
    }

    function gotoProject(project) {
        if (!PROJECTS[project]) return;
        const t = TRACKERS[selectedTracker] || TRACKERS[DEFAULT_TRACKER];
        window.open(newIssueUrl(project, t.id), "_blank", "noopener");
    }

    // If the URL carries a #qa=<project> marker (from a Report link/shortcut
    // opened in a new tab), record it so auto-fill and manual Fill know the
    // project and tracker.
    function consumeProjectHash() {
        const m = location.hash.match(/(?:^#|[#&])qa=([a-z]+)/i);
        if (m && PROJECTS[m[1]]) {
            sessionStorage.setItem(STORAGE.project, m[1]);
            const tm = location.hash.match(/[#&]t=(\d+)/);
            if (tm) sessionStorage.setItem(STORAGE.tracker, tm[1]);
            history.replaceState(null, "", location.pathname + location.search);
        }
    }

    // Ensure a board URL is absolute (Redmine origin) so links work from any site.
    function toRedmineAbs(u) {
        if (!u) return u;
        return /^https?:\/\//i.test(u) ? u : REDMINE + u;
    }

    // Build a board URL filtered to the project's current sprint (target version).
    function boardUrl(project) {
        const p = PROJECTS[project];
        if (!p || !p.board) return null;
        if (!p.version) return REDMINE + p.board;
        const q = "set_filter=1"
            + "&f%5B%5D=fixed_version_id"
            + "&op%5Bfixed_version_id%5D=%3D"
            + "&v%5Bfixed_version_id%5D%5B%5D=" + encodeURIComponent(p.version);
        return REDMINE + p.board + "?" + q;
    }

    // Per-project map of the last agile board the user viewed.
    function getLastBoards() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE.lastBoard) || "{}") || {};
        } catch (e) {
            return {};
        }
    }

    // If we're on a project's agile board, remember its exact URL so the panel
    // button reopens that board next time (falling back to the current sprint).
    function rememberCurrentBoard() {
        const m = location.pathname.match(/^\/projects\/([^/]+)\/agile\/board/);
        if (!m) return;
        const slug = m[1];
        const key = PROJECT_ORDER.find(k => PROJECTS[k].board === `/projects/${slug}/agile/board`);
        if (!key) return;
        const boards = getLastBoards();
        boards[key] = location.origin + location.pathname + location.search;
        localStorage.setItem(STORAGE.lastBoard, JSON.stringify(boards));
    }

    // Open a project's agile board in a new tab so the panel/page is preserved.
    // Prefers the last board the user viewed for that project; otherwise opens
    // the current sprint (target version) board.
    function gotoBoard(project) {
        const p = PROJECTS[project];
        if (!p || !p.board) return;
        const url = toRedmineAbs(getLastBoards()[project] || boardUrl(project));
        window.open(url, "_blank", "noopener");
    }

    //////////////////////////////////////////////////////
    // Floating Panel
    //////////////////////////////////////////////////////

    function createPanel() {
        if (document.getElementById("qa-panel")) return;

        const panel = document.createElement("div");
        panel.id = "qa-panel";

        // The Description Source section (with Fill / Copy / Clear + template
        // editor + AI) only makes sense on the New-issue form — it targets
        // `#issue_subject` / `#issue_description`, which only exist there.
        // On other Redmine pages (issue detail, list, project overview, …) the
        // section would just be dead weight, so it's gated on isNewIssuePage().
        // On the app under test the panel is a launcher only.
        const onRedmine  = location.origin === REDMINE;
        const onNewIssue = onRedmine && isNewIssuePage();

        // Launcher hosts (dev.cloudapper.com etc.) show a shorter body — no
        // Description Source section. Tag the panel so CSS can raise the
        // expanded min-height enough to keep the version footer visible
        // without scrolling.
        if (!onRedmine) panel.classList.add("qa-launcher");

        const projectButtons = PROJECT_ORDER.map((key) => {
            const p = PROJECTS[key];
            // Icon (from QA_ICONS) sits in the same slot as the old emoji.
            return `<a class="qa-project-card qa-project-btn" data-project="${key}"
                        href="${newIssueUrl(key, TRACKERS[DEFAULT_TRACKER].id)}" target="_blank" rel="noopener">
                        <span class="qa-project-emoji">${svgIcon(p.icon)}</span><span>${p.label}</span>
                    </a>`;
        }).join("");

        const trackerCards = TRACKER_ORDER.map((key) => {
            const t = TRACKERS[key];
            return `<button class="qa-tracker-card" data-tracker="${key}" type="button">
                        <span class="qa-tracker-emoji">${svgIcon(t.icon)}</span><span>${t.name}</span>
                    </button>`;
        }).join("");

        const boardButtons = PROJECT_ORDER.map((key, i) => {
            const p = PROJECTS[key];
            const href = toRedmineAbs(getLastBoards()[key] || boardUrl(key));
            // Split the label into two spans so the row layout on Redmine can
            // drop the trailing " Board" word (via CSS) while the launcher keeps
            // the full "Web Board" text in its stacked layout.
            return `<a class="qa-btn qa-board-btn" data-board="${key}"
                        href="${href}" target="_blank" rel="noopener"
                        title="${p.label} agile board" aria-label="${p.label} agile board">
                        <span class="qa-board-label"><span class="qa-board-emoji">${svgIcon(p.icon)}</span><span class="qa-board-name">${p.label}</span><span class="qa-board-suffix"> Board</span></span><kbd>⇧${i + 1}</kbd>
                    </a>`;
        }).join("");

        const templateHtml = onNewIssue ? `
                <div class="qa-divider"></div>
                <div class="qa-section-label">Step 3 · Description source</div>
                <div class="qa-tmpl-wrap" id="qa-tmpl-wrap">
                    <div class="qa-mode-switch" id="qa-mode-switch" role="tablist" aria-label="Description source" data-active="ai">
                        <button type="button" class="qa-mode-btn active" data-mode="ai"><span class="qa-mode-icon">${svgIcon("bot")}</span>AI</button>
                        <button type="button" class="qa-mode-btn" data-mode="template"><span class="qa-mode-icon">${svgIcon("file-text")}</span>Template</button>
                    </div>

                    <div id="qa-tmpl-mode" hidden>
                        <textarea id="qa-template-input" class="qa-template-input"
                                  spellcheck="false"
                                  placeholder="Type your description template here…"></textarea>
                        <div class="qa-template-actions">
                            <button class="qa-btn qa-tmpl-btn" data-action="save-template" title="Save template"><span class="qa-btn-icon">${svgIcon("save")}</span><span class="qa-btn-label">Save</span></button>
                            <button class="qa-btn qa-tmpl-btn" data-action="reset-template" title="Reset to default template"><span class="qa-btn-icon">${svgIcon("rotate-ccw")}</span><span class="qa-btn-label">Reset</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="fill" title="Fill the issue form (Alt+F)"><span class="qa-btn-icon">${svgIcon("download")}</span><span class="qa-btn-label">Fill</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="copy" title="Copy this template to clipboard (Alt+C)"><span class="qa-btn-icon">${svgIcon("copy")}</span><span class="qa-btn-label">Copy</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action qa-danger" data-action="clear" title="Clear the issue form (Alt+X)"><span class="qa-btn-icon">${svgIcon("trash-2")}</span><span class="qa-btn-label">Clear</span></button>
                        </div>
                    </div>

                    <div id="qa-ai-mode">
                        <div class="qa-ai-key" id="qa-ai-key">
                            <div class="qa-ai-key-saved" id="qa-ai-key-saved" hidden>
                                <span class="qa-ai-key-status"><span class="qa-btn-icon">${svgIcon("key")}</span> API key saved</span>
                                <button class="qa-btn qa-tmpl-btn" data-action="ai-change-key">Change</button>
                            </div>
                            <div class="qa-ai-key-edit" id="qa-ai-key-edit">
                                <input type="text" id="qa-ai-key-input" class="qa-ai-field qa-secret"
                                       placeholder="OpenAI API key (sk-…)"
                                       autocomplete="off" spellcheck="false"
                                       data-lpignore="true" data-1p-ignore data-form-type="other">
                                <button class="qa-btn qa-tmpl-btn qa-icon-btn" type="button"
                                        data-action="ai-toggle-key" title="Show / hide key">${svgIcon("eye")}</button>
                                <button class="qa-btn qa-tmpl-btn" data-action="ai-save-key"><span class="qa-btn-icon">${svgIcon("key")}</span>Save</button>
                            </div>
                        </div>
                        <label class="qa-ai-model-row">
                            <span>Model</span>
                            <select id="qa-ai-model" class="qa-ai-field">
                                ${AI_MODELS.map((m) => `<option value="${m}">${m}</option>`).join("")}
                            </select>
                        </label>
                        <div class="qa-ai-chat" id="qa-ai-chat"></div>
                        <textarea id="qa-ai-input" class="qa-ai-field qa-ai-compose"
                                  rows="3" spellcheck="false"
                                  placeholder="Describe the bug in rough words… (Ctrl+Enter to send)"></textarea>
                        <div class="qa-template-actions">
                            <button class="qa-btn qa-tmpl-btn" data-action="ai-send"><span class="qa-btn-icon">${svgIcon("sparkles")}</span>Structure</button>
                            <button class="qa-btn qa-tmpl-btn" data-action="ai-clear"><span class="qa-btn-icon">${svgIcon("eraser")}</span>Reset Chat</button>
                        </div>
                        <div class="qa-ai-review" id="qa-ai-review" hidden>
                            <div class="qa-section-label">Review &amp; edit before filling</div>
                            <input type="text" id="qa-ai-subject" class="qa-ai-field" placeholder="Subject">
                            <textarea id="qa-ai-desc" class="qa-template-input" spellcheck="false" placeholder="Description"></textarea>
                            <button class="qa-btn qa-tmpl-btn qa-ai-fill" data-action="ai-fill"><span class="qa-btn-icon">${svgIcon("arrow-down-to-line")}</span>Fill Subject &amp; Description</button>
                        </div>
                    </div>
                </div>` : "";

        // 'Close this issue' section — only rendered on Redmine, and only made
        // visible when the current URL matches /issues/<id> (populated at init).
        // Reads the 'Closed Version' custom-field options from the page, lets
        // the user pick one, previews the auto-generated note, and offers
        // Fill-only vs Fill+Submit. Both buttons stay disabled until a version
        // is picked (per the design spec).
        const closeIssueHtml = onRedmine ? `
                <div class="qa-close-issue-wrap" id="qa-close-issue-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Close this issue</div>
                    <label class="qa-ai-model-row">
                        <span>Closed version</span>
                        <select id="qa-close-version" class="qa-ai-field">
                            <option value="">— pick a version —</option>
                        </select>
                    </label>
                    <textarea id="qa-close-note" class="qa-close-note-input"
                              spellcheck="false" rows="2" disabled
                              placeholder="Pick a closed version above to preview the note. You can edit it before filling."></textarea>
                    <div class="qa-template-actions">
                        <button class="qa-btn qa-tmpl-btn" data-action="close-fill" disabled title="Fill status, closed version and note — you review and Submit"><span class="qa-btn-icon">${svgIcon("download")}</span><span class="qa-btn-label">Fill only</span></button>
                        <button class="qa-btn qa-tmpl-btn qa-action" data-action="close-submit" disabled title="Fill everything and submit — closes the issue"><span class="qa-btn-icon">${svgIcon("check-square")}</span><span class="qa-btn-label">Close issue</span></button>
                    </div>
                </div>` : "";

        // 'Analyze Ticket' section — rendered on every Redmine page but
        // self-hides via [hidden] until isIssueDetailPage() confirms an
        // issue detail view. On click it scrapes title/description/checklist
        // (+ optional metadata + last journal notes) and asks the AI for a
        // QA-friendly report, shown in the wide analysis modal below.
        const analyzeTicketHtml = onRedmine ? `
                <div class="qa-analyze-wrap" id="qa-analyze-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Analyze Ticket</div>
                    <div class="qa-analyze-row">
                        <button class="qa-btn qa-tmpl-btn qa-action" data-action="analyze-ticket" id="qa-analyze-btn" type="button" title="Ask the AI for a QA-friendly analysis of this ticket"><span class="qa-btn-icon">${svgIcon("sparkles")}</span><span class="qa-btn-label" id="qa-analyze-btn-label">Analyze this ticket</span></button>
                    </div>
                </div>` : "";

        // "Similar closed tickets" section — issue detail pages only. Runs
        // a token-ranked substring search against Redmine's closed-issue
        // list scoped to the current project and renders the top matches
        // inline (no modal). Cache lives in localStorage so revisiting
        // the same ticket doesn't hit the network.
        const similarClosedHtml = onRedmine ? `
                <div class="qa-similar-wrap" id="qa-similar-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Similar closed tickets</div>
                    <div class="qa-similar-status" id="qa-similar-status" role="status">
                        <span class="qa-spinner" aria-hidden="true"></span>
                        <span class="qa-similar-status-text">Searching…</span>
                    </div>
                    <ul class="qa-similar-list" id="qa-similar-list" hidden></ul>
                    <div class="qa-similar-empty" id="qa-similar-empty" hidden>No similar closed tickets found in this project.</div>
                    <div class="qa-similar-actions">
                        <button class="qa-btn qa-tmpl-btn" data-action="similar-more" id="qa-similar-more" type="button" hidden><span class="qa-btn-icon">${svgIcon("chevron-right")}</span><span class="qa-btn-label" id="qa-similar-more-label">See more</span></button>
                        <button class="qa-btn qa-tmpl-btn" data-action="similar-show-all" id="qa-similar-show-all" type="button" hidden title="Show every fetched candidate, including low-relevance matches"><span class="qa-btn-icon">${svgIcon("chevron-right")}</span><span class="qa-btn-label" id="qa-similar-show-all-label">Show all</span></button>
                        <button class="qa-btn qa-tmpl-btn" data-action="similar-refresh" id="qa-similar-refresh" type="button" title="Search again (bypass cache)"><span class="qa-btn-icon">${svgIcon("rotate-ccw")}</span><span class="qa-btn-label">Refresh</span></button>
                    </div>
                </div>` : "";

        // "Close multiple issues" section — only rendered on Redmine, and only
        // made visible on Agile board pages (populated at init). Enters a
        // "select mode" that overlays a checkbox on every card so the user
        // can pick multiple issues, then closes them all in one bulk_update
        // POST after a confirmation modal.
        const bulkCloseHtml = onRedmine ? `
                <div class="qa-bulk-close-wrap" id="qa-bulk-close-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Close multiple issues</div>
                    <div class="qa-bulk-toggle-row">
                        <button class="qa-btn qa-tmpl-btn qa-bulk-select-btn" data-action="bulk-select-toggle" type="button"><span class="qa-btn-icon">${svgIcon("check-square")}</span><span class="qa-btn-label" id="qa-bulk-select-label">Enter select mode</span></button>
                        <span class="qa-bulk-count" id="qa-bulk-count" hidden>0 selected</span>
                    </div>
                    <div class="qa-bulk-fields" id="qa-bulk-fields" hidden>
                        <label class="qa-ai-model-row">
                            <span>Closed version</span>
                            <select id="qa-bulk-version" class="qa-ai-field" disabled>
                                <option value="">— loading versions —</option>
                            </select>
                        </label>
                        <textarea id="qa-bulk-note" class="qa-close-note-input"
                                  spellcheck="false" rows="2" disabled
                                  placeholder="Pick a version above to preview the note. Edit before sending."></textarea>
                        <div class="qa-template-actions">
                            <button class="qa-btn qa-tmpl-btn" data-action="bulk-cancel" type="button" title="Leave select mode without closing anything"><span class="qa-btn-icon">${svgIcon("x")}</span><span class="qa-btn-label">Cancel</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="bulk-submit" id="qa-bulk-submit" disabled type="button" title="Review the list, then confirm the bulk close"><span class="qa-btn-icon">${svgIcon("check-square")}</span><span class="qa-btn-label" id="qa-bulk-submit-label">Close…</span></button>
                        </div>
                    </div>
                </div>` : "";

        // Confirmation modal for the bulk close. Rendered inside the panel so
        // it inherits theme + accent classes, then moved to document.body at
        // wiring time (like #qa-accent-popover) so the panel's overflow:hidden
        // and backdrop-filter don't clip its overlay.
        const bulkModalHtml = onRedmine ? `
                <div class="qa-modal-overlay" id="qa-bulk-modal" hidden role="dialog" aria-modal="true" aria-labelledby="qa-bulk-modal-title">
                    <div class="qa-modal">
                        <div class="qa-modal-header">
                            <span class="qa-modal-title" id="qa-bulk-modal-title">Close issues?</span>
                            <button class="qa-hbtn qa-modal-close" data-action="modal-cancel" type="button" title="Cancel">${svgIcon("x")}</button>
                        </div>
                        <div class="qa-modal-body">
                            <p class="qa-modal-lede">These issues will be set to <strong>Closed</strong>, tagged with the picked version, and receive your note as a comment.</p>
                            <ul class="qa-modal-list" id="qa-bulk-modal-list"></ul>
                            <div class="qa-modal-summary" id="qa-bulk-modal-summary" hidden></div>
                            <div class="qa-modal-meta">
                                <div class="qa-modal-meta-row"><strong>Version:</strong> <span id="qa-bulk-modal-version">—</span></div>
                                <div class="qa-modal-meta-row qa-modal-note-label"><strong>Note:</strong></div>
                                <pre class="qa-modal-note" id="qa-bulk-modal-note"></pre>
                            </div>
                            <div class="qa-modal-progress" id="qa-bulk-modal-progress" hidden>
                                <div class="qa-modal-progress-header">
                                    <span class="qa-spinner" aria-hidden="true"></span>
                                    <span class="qa-modal-progress-text" id="qa-bulk-modal-progress-text">Closing…</span>
                                </div>
                                <div class="qa-modal-progress-track"><div class="qa-modal-progress-fill" id="qa-bulk-modal-progress-fill"></div></div>
                            </div>
                        </div>
                        <div class="qa-modal-actions">
                            <button class="qa-btn qa-tmpl-btn" data-action="modal-cancel" type="button"><span class="qa-btn-label">Cancel</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="modal-confirm" type="button"><span class="qa-btn-icon">${svgIcon("check-square")}</span><span class="qa-btn-label" id="qa-bulk-modal-confirm-label">Close them</span></button>
                        </div>
                    </div>
                </div>` : "";

        // "Show Reopened Issues" section — lives directly below Bulk
        // Close, only revealed on Agile board pages. Button trips a
        // one-shot HTML query for issues that ever had the reopen
        // status in the current sprint, then hands the result to the
        // view-only reopened-issues modal below.
        const reopenedIssuesHtml = onRedmine ? `
                <div class="qa-reopened-wrap" id="qa-reopened-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Reopened issues</div>
                    <div class="qa-reopened-row">
                        <button class="qa-btn qa-tmpl-btn qa-action" data-action="show-reopened" id="qa-show-reopened" type="button" title="List issues in the current sprint that ever had the '${REOPEN_STATUS_DISPLAY}' status"><span class="qa-btn-icon">${svgIcon("rotate-ccw")}</span><span class="qa-btn-label" id="qa-show-reopened-label">Get Reopened Issues</span></button>
                    </div>
                    <div class="qa-reopened-warn" id="qa-reopened-warn" role="status" hidden>Partially synced. Please sync again to get remaining issues.</div>
                </div>` : "";

        // Sprint audit — end-of-sprint report button. Shares the reopened-row
        // markup for a consistent Agile-board section look.
        const auditWrapHtml = onRedmine ? `
                <div class="qa-audit-wrap" id="qa-audit-wrap" hidden>
                    <div class="qa-divider"></div>
                    <div class="qa-section-label">Sprint audit</div>
                    <div class="qa-reopened-row">
                        <button class="qa-btn qa-tmpl-btn qa-action" data-action="show-audit" id="qa-show-audit" type="button" title="Run an end-of-sprint audit against the current board's version"><span class="qa-btn-icon">${svgIcon("check-square")}</span><span class="qa-btn-label" id="qa-show-audit-label">Audit this sprint</span></button>
                    </div>
                </div>` : "";

        // View-only modal that displays the reopened-issues result set.
        // Same overlay chrome as the bulk-close modal (theme, close X,
        // list styling) but no confirm button, no note, no version —
        // rows are links out to each issue's detail page.
        const reopenedModalHtml = onRedmine ? `
                <div class="qa-modal-overlay" id="qa-reopened-modal" hidden role="dialog" aria-modal="true" aria-labelledby="qa-reopened-modal-title">
                    <div class="qa-modal">
                        <div class="qa-modal-header">
                            <span class="qa-modal-title" id="qa-reopened-modal-title">Reopened issues<span class="qa-modal-count-badge" id="qa-reopened-modal-count" hidden></span></span>
                            <button class="qa-hbtn qa-modal-close" data-action="reopened-close" type="button" title="Close">${svgIcon("x")}</button>
                        </div>
                        <div class="qa-modal-body">
                            <p class="qa-modal-lede" id="qa-reopened-modal-lede">These issues have passed through the <strong>${REOPEN_STATUS_DISPLAY}</strong> status at least once.</p>
                            <ul class="qa-modal-list qa-modal-list-reopened" id="qa-reopened-modal-list"></ul>
                            <div class="qa-modal-summary" id="qa-reopened-modal-summary" hidden></div>
                        </div>
                        <div class="qa-modal-actions">
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="reopened-copy" id="qa-reopened-copy" type="button" title="Copy the list (id + subject with hyperlinks) to the clipboard"><span class="qa-btn-icon">${svgIcon("copy")}</span><span class="qa-btn-label" id="qa-reopened-copy-label">Copy list</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="reopened-close" type="button"><span class="qa-btn-label">Close</span></button>
                        </div>
                    </div>
                </div>` : "";

        // Sprint audit modal — wider than the confirmation modals; contains
        // a Verdict + several report sections rendered from runSprintAudit().
        const auditModalHtml = onRedmine ? `
                <div class="qa-modal-overlay" id="qa-audit-modal" hidden role="dialog" aria-modal="true" aria-labelledby="qa-audit-modal-title">
                    <div class="qa-modal qa-audit-modal">
                        <div class="qa-modal-header">
                            <span class="qa-modal-title" id="qa-audit-modal-title">Sprint audit</span>
                            <button class="qa-hbtn qa-modal-close" data-action="audit-close" type="button" title="Close">${svgIcon("x")}</button>
                        </div>
                        <div class="qa-modal-body">
                            <div class="qa-audit-loading" id="qa-audit-loading">
                                <span class="qa-spinner" aria-hidden="true"></span>
                                <span id="qa-audit-loading-text">Running audit…</span>
                            </div>
                            <div class="qa-audit-report" id="qa-audit-report" hidden></div>
                        </div>
                        <div class="qa-modal-actions">
                            <label class="qa-audit-toggle" id="qa-audit-toggle-wrap" hidden>
                                <input type="checkbox" id="qa-audit-show-assignees">
                                <span>Show individual assignee stats</span>
                            </label>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="audit-refresh" id="qa-audit-refresh" type="button" title="Re-run the audit (bypass cache)"><span class="qa-btn-icon">${svgIcon("rotate-ccw")}</span><span class="qa-btn-label">Refresh</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="audit-copy" id="qa-audit-copy" disabled type="button" title="Copy full report as Markdown"><span class="qa-btn-icon">${svgIcon("copy")}</span><span class="qa-btn-label">Copy report</span></button>
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="audit-copy-plain" id="qa-audit-copy-plain" disabled type="button" title="Copy full report as plain text (no Markdown)"><span class="qa-btn-icon">${svgIcon("copy")}</span><span class="qa-btn-label">Copy plain</span></button>
                            <button class="qa-btn qa-tmpl-btn" data-action="audit-close" type="button"><span class="qa-btn-label">Close</span></button>
                        </div>
                    </div>
                </div>` : "";

        // Ticket-analysis modal — wider than the confirmation modals since
        // the AI's report is a multi-section Markdown document. Same overlay
        // chrome (theme + accent classes mirrored at open time).
        const analyzeModalHtml = onRedmine ? `
                <div class="qa-modal-overlay" id="qa-analyze-modal" hidden role="dialog" aria-modal="true" aria-labelledby="qa-analyze-modal-title">
                    <div class="qa-modal qa-modal-wide">
                        <div class="qa-modal-header">
                            <span class="qa-modal-title" id="qa-analyze-modal-title">Ticket analysis</span>
                            <button class="qa-hbtn qa-modal-close" data-action="analyze-close" type="button" title="Close">${svgIcon("x")}</button>
                        </div>
                        <div class="qa-modal-body">
                            <div class="qa-analyze-loading" id="qa-analyze-loading">
                                <span class="qa-spinner" aria-hidden="true"></span>
                                <span>Analyzing this ticket…</span>
                            </div>
                            <div class="qa-analyze-report" id="qa-analyze-report" hidden></div>
                        </div>
                        <div class="qa-modal-actions">
                            <button class="qa-btn qa-tmpl-btn qa-action" data-action="analyze-copy" id="qa-analyze-copy" disabled type="button" title="Copy the analysis to the clipboard as Markdown"><span class="qa-btn-icon">${svgIcon("copy")}</span><span class="qa-btn-label" id="qa-analyze-copy-label">Copy</span></button>
                            <button class="qa-btn qa-tmpl-btn" data-action="analyze-close" type="button"><span class="qa-btn-label">Close</span></button>
                        </div>
                    </div>
                </div>` : "";

        panel.innerHTML = `
            <div class="qa-header" id="qa-header">
                <span class="qa-title"><span class="qa-title-icon" id="qa-title-icon">${svgIcon("rocket")}</span>QA Assistant</span>
                <div class="qa-quote-bubble" id="qa-quote-bubble" role="tooltip" hidden></div>
                <div class="qa-header-btns">
                    <button class="qa-hbtn" id="qa-accent-btn" title="Accent colour" aria-haspopup="true" aria-expanded="false">${svgIcon("palette")}</button>
                    <button class="qa-hbtn" id="qa-theme" title="Switch to dark mode">${svgIcon("moon")}</button>
                    <button class="qa-hbtn" id="qa-dock" title="Dock to screen edge">${svgIcon("pin")}</button>
                    <button class="qa-hbtn qa-collapse" id="qa-collapse" title="Collapse / Expand">${svgIcon("minus")}</button>
                </div>
                <div class="qa-accent-popover" id="qa-accent-popover" role="menu" aria-label="Accent colour">
                    <button type="button" class="qa-swatch qa-swatch-blue"     data-accent="blue"     title="Ocean blue"     aria-label="Ocean blue"></button>
                    <button type="button" class="qa-swatch qa-swatch-lavender" data-accent="lavender" title="Lavender"       aria-label="Lavender"></button>
                    <button type="button" class="qa-swatch qa-swatch-orange"   data-accent="orange"   title="Sunset orange" aria-label="Sunset orange"></button>
                    <button type="button" class="qa-swatch qa-swatch-red"      data-accent="red"      title="Soft red"      aria-label="Soft red"></button>
                </div>
            </div>
            <div class="qa-dock-face" id="qa-dock-face" title="Click to restore QA Assistant">QA</div>
            <div class="qa-body" id="qa-body">
                <div class="qa-section-label">Report an Issue</div>
                <div class="qa-report-substep">Step 1 · choose a tracker</div>
                <div class="qa-tracker-grid" id="qa-tracker-grid">${trackerCards}</div>
                <div class="qa-report-substep qa-project-step" id="qa-project-step" hidden>
                    <span>Step 2 · choose a project</span>
                    <span class="qa-report-for" id="qa-report-for"></span>
                </div>
                <div class="qa-project-grid" id="qa-project-list" hidden>${projectButtons}</div>
                ${templateHtml}
                ${closeIssueHtml}
                ${analyzeTicketHtml}
                ${similarClosedHtml}
                ${bulkCloseHtml}
                ${reopenedIssuesHtml}
                ${auditWrapHtml}
                <div class="qa-divider"></div>
                <div class="qa-section-label">Agile Boards</div>
                <div class="qa-boards-row" id="qa-boards-wrap">
                    ${boardButtons}
                </div>
                <div class="qa-version">${QA_VERSION ? "v" + QA_VERSION : ""}</div>
            </div>
            ${bulkModalHtml}
            ${reopenedModalHtml}
            ${auditModalHtml}
            ${analyzeModalHtml}
        `;

        document.body.appendChild(panel);

        // Report links are plain <a target="_blank"> elements; the new tab reads
        // the #qa=<project>&t=<tracker> marker in the URL to run auto-fill.

        // ---- Report: pick a tracker, then reveal the project picker ----
        const trackerGrid  = panel.querySelector("#qa-tracker-grid");
        const projectStep  = panel.querySelector("#qa-project-step");
        const projectList  = panel.querySelector("#qa-project-list");
        const reportFor    = panel.querySelector("#qa-report-for");
        const projectLinks = panel.querySelectorAll(".qa-project-btn");

        // Refresh hook for the template editor — gets wired up further down in
        // the onRedmine branch once #qa-template-input exists. applyTracker()
        // calls it so switching trackers repopulates the textarea with the new
        // tracker's saved / default template.
        let refreshTemplateEditor = null;

        // Keeps the AI compose textarea's placeholder aligned with the active
        // tracker so the prompt hint matches the kind of report being written.
        function refreshAiPlaceholder() {
            const aiInputEl = panel.querySelector("#qa-ai-input");
            if (!aiInputEl) return;
            const t = TRACKER_PROMPTS[currentTrackerKey()] || TRACKER_PROMPTS[DEFAULT_TRACKER];
            aiInputEl.placeholder = t.placeholder;
        }

        function applyTracker(key) {
            const t = TRACKERS[key];
            if (!t) return;
            selectedTracker = key;
            localStorage.setItem(STORAGE.lastTracker, key);
            trackerGrid.querySelectorAll(".qa-tracker-card").forEach(c =>
                c.classList.toggle("active", c.dataset.tracker === key));
            // reportFor renders as an inline SVG icon + name (was emoji + name).
            // Wrap the tracker name in its own span so the flex row's
            // ellipsis + max-width apply cleanly, and drop the raw space
            // between the icon and the name (gap:6px on .qa-report-for
            // handles the spacing).
            reportFor.innerHTML = `<span class="qa-tracker-emoji">${svgIcon(t.icon)}</span><span class="qa-report-for-name">${t.name}</span>`;
            projectStep.hidden = false;
            projectList.hidden = false;
            projectLinks.forEach(a => { a.href = newIssueUrl(a.dataset.project, t.id); });
            refreshAiPlaceholder();
            if (refreshTemplateEditor) refreshTemplateEditor();
        }
        trackerGrid.querySelectorAll(".qa-tracker-card").forEach(card => {
            card.addEventListener("click", (e) => {
                e.stopPropagation();
                applyTracker(card.dataset.tracker);
            });
        });
        // Restore the last-used tracker (default Bug) so the picker is ready.
        applyTracker(localStorage.getItem(STORAGE.lastTracker) || DEFAULT_TRACKER);

        // Agile board links: refresh the href just before navigation so it points
        // at the last-viewed board (or the current sprint) for that project.
        // mousedown covers left / middle / ctrl-click.
        panel.querySelectorAll(".qa-board-btn").forEach(a => {
            a.addEventListener("mousedown", () => {
                a.href = toRedmineAbs(getLastBoards()[a.dataset.board] || boardUrl(a.dataset.board));
            });
        });

        // Action buttons + template editor + AI panel only exist on the
        // New-issue page (see the onNewIssue gate on templateHtml above).
        // On other Redmine pages this whole wiring block is skipped.
        if (onNewIssue) {
            panel.querySelector('[data-action="fill"]').addEventListener("click", () => {
                fillIssue(sessionStorage.getItem(STORAGE.project));
                toast("Template filled");
            });
            panel.querySelector('[data-action="copy"]').addEventListener("click", copyDescription);
            panel.querySelector('[data-action="clear"]').addEventListener("click", clearForm);

            // Template editor
            const tmplInput = panel.querySelector("#qa-template-input");
            tmplInput.value = getTemplate(selectedTracker);
            // Repopulate the editor whenever the selected tracker changes so the
            // textarea always shows that tracker's saved (or default) template.
            // Uses selectedTracker (the tracker card in the panel) rather than
            // currentTrackerKey() so the editor stays in sync with the user's
            // panel choice even if the Redmine form's tracker dropdown differs.
            refreshTemplateEditor = () => { tmplInput.value = getTemplate(selectedTracker); };
            // Don't let clicks/keys inside the textarea trigger drag or shortcuts.
            tmplInput.addEventListener("mousedown", (e) => e.stopPropagation());
            tmplInput.addEventListener("keydown", (e) => e.stopPropagation());
            panel.querySelector('[data-action="save-template"]').addEventListener("click", () => {
                saveTemplate(tmplInput.value, selectedTracker);
                toast("Template saved");
            });
            panel.querySelector('[data-action="reset-template"]').addEventListener("click", () => {
                resetTemplate(selectedTracker);
                tmplInput.value = getTemplate(selectedTracker);
                toast("Template reset to default");
            });

            // ---- AI assistant mode ----
            const modeSwitchEl = panel.querySelector("#qa-mode-switch");
            const modeBtns   = panel.querySelectorAll(".qa-mode-btn");
            const tmplModeEl = panel.querySelector("#qa-tmpl-mode");
            const aiModeEl   = panel.querySelector("#qa-ai-mode");
            const aiKeyRow   = panel.querySelector("#qa-ai-key");
            const aiKeySaved = panel.querySelector("#qa-ai-key-saved");
            const aiKeyEdit  = panel.querySelector("#qa-ai-key-edit");
            const aiKeyInput = panel.querySelector("#qa-ai-key-input");
            const aiModelSel = panel.querySelector("#qa-ai-model");
            const aiChatEl   = panel.querySelector("#qa-ai-chat");
            const aiInput    = panel.querySelector("#qa-ai-input");
            const aiReview   = panel.querySelector("#qa-ai-review");
            const aiSubject  = panel.querySelector("#qa-ai-subject");
            const aiDesc     = panel.querySelector("#qa-ai-desc");

            // Set the initial placeholder now that #qa-ai-input exists, and keep
            // it in sync when the Redmine form's tracker dropdown changes.
            refreshAiPlaceholder();
            const issueTrackerSel = document.getElementById("issue_tracker_id");
            if (issueTrackerSel) {
                issueTrackerSel.addEventListener("change", refreshAiPlaceholder);
            }

            // Keep typing inside AI fields from triggering drag / shortcuts.
            [aiKeyInput, aiInput, aiSubject, aiDesc].forEach((el) => {
                el.addEventListener("mousedown", (e) => e.stopPropagation());
                el.addEventListener("keydown",   (e) => e.stopPropagation());
            });

            // Conversation history sent to OpenAI (roles: user / assistant).
            const aiHistory = [];

            function refreshKeyRow() {
                const hasKey = !!AI.key();
                aiKeySaved.hidden = !hasKey;
                aiKeyEdit.hidden = hasKey;
            }

            function addBubble(role, text) {
                const b = document.createElement("div");
                b.className = "qa-bubble qa-bubble-" + role;
                b.textContent = text;
                aiChatEl.appendChild(b);
                aiChatEl.scrollTop = aiChatEl.scrollHeight;
                return b;
            }

            // Loading placeholder while an AI response is in flight. Three dots
            // pulse in sequence (see .qa-typing / @keyframes qa-dot-pulse in
            // the injected styles) — the .qa-typing class is stripped when the
            // reply arrives and normal textContent takes over.
            function addTypingBubble() {
                const b = document.createElement("div");
                b.className = "qa-bubble qa-bubble-ai qa-typing";
                b.innerHTML = '<span class="qa-dot"></span><span class="qa-dot"></span><span class="qa-dot"></span>';
                aiChatEl.appendChild(b);
                aiChatEl.scrollTop = aiChatEl.scrollHeight;
                return b;
            }

            function setAiMode(on) {
                aiModeEl.hidden = !on;
                tmplModeEl.hidden = on;
                modeBtns.forEach((b) => b.classList.toggle("active", (b.dataset.mode === "ai") === on));
                // Drive the sliding pill in .qa-mode-switch via a data attribute so the
                // animation is pure CSS (see .qa-mode-switch::before in the injected styles).
                if (modeSwitchEl) modeSwitchEl.dataset.active = on ? "ai" : "template";
                localStorage.setItem(STORAGE.aiMode, on ? "1" : "0");
                if (on) refreshKeyRow();
            }

            modeBtns.forEach((btn) => btn.addEventListener("click", (e) => {
                e.stopPropagation();
                setAiMode(btn.dataset.mode === "ai");
            }));

            // Model selector (persisted; falls back to the default).
            aiModelSel.value = AI.model();
            if (!aiModelSel.value) aiModelSel.value = AI_DEFAULT_MODEL;
            aiModelSel.addEventListener("mousedown", (e) => e.stopPropagation());
            aiModelSel.addEventListener("change", () => {
                localStorage.setItem(STORAGE.aiModel, aiModelSel.value);
                toast("Model: " + aiModelSel.value);
            });

            panel.querySelector('[data-action="ai-save-key"]').addEventListener("click", () => {
                const k = aiKeyInput.value.trim();
                if (!k) { toast("Paste a key first"); return; }
                AI.setKey(k);
                aiKeyInput.value = "";
                refreshKeyRow();
                toast("API key saved");
            });

            // "Change" reveals the input again so the user can replace the key.
            panel.querySelector('[data-action="ai-change-key"]').addEventListener("click", () => {
                aiKeySaved.hidden = true;
                aiKeyEdit.hidden = false;
                aiKeyInput.placeholder = "Enter new OpenAI API key (sk-…)";
                aiKeyInput.focus();
            });

            // Toggle masked / plain rendering of the key input. We use
            // -webkit-text-security on a regular text input (see .qa-secret)
            // instead of type="password" so browsers and password managers
            // don't attach autofill to other inputs on the page (e.g. the
            // Agile board's search field).
            panel.querySelector('[data-action="ai-toggle-key"]').addEventListener("click", (e) => {
                e.stopPropagation();
                aiKeyInput.classList.toggle("qa-secret");
                e.currentTarget.innerHTML = svgIcon(aiKeyInput.classList.contains("qa-secret") ? "eye" : "eye-off");
            });

            async function sendToAi() {
                const text = aiInput.value.trim();
                if (!text) return;
                if (!AI.key()) { refreshKeyRow(); toast("Add your OpenAI API key first"); return; }

                addBubble("user", text);
                aiHistory.push({ role: "user", content: text });
                aiInput.value = "";

                const thinking = addTypingBubble();
                const sendBtn = panel.querySelector('[data-action="ai-send"]');
                sendBtn.disabled = true;
                try {
                    const res = await aiChat(aiHistory);
                    aiHistory.push({ role: "assistant", content: res.raw || JSON.stringify(res) });
                    thinking.classList.remove("qa-typing");
                    const hasDraft = !!(res.subject || res.description);
                    // When the model omitted a chat reply, tell the user WHERE
                    // to look next instead of a bare "Done." — the review card
                    // is often below the fold and easy to miss otherwise.
                    thinking.textContent = res.reply || (hasDraft
                        ? "Draft ready \u2014 review the subject and description below, then click Fill."
                        : "Done.");
                    if (hasDraft) {
                        aiSubject.value = res.subject || aiSubject.value;
                        aiDesc.value = res.description || aiDesc.value;
                        aiReview.hidden = false;
                        // Pulse the review card + scroll it into view so it's
                        // obvious that a new panel just appeared. Removing the
                        // class then forcing a reflow (offsetWidth read)
                        // restarts the animation on every fresh draft.
                        aiReview.classList.remove("qa-ai-review-reveal");
                        void aiReview.offsetWidth;
                        aiReview.classList.add("qa-ai-review-reveal");
                        aiReview.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }
                } catch (err) {
                    thinking.classList.remove("qa-typing");
                    thinking.classList.add("qa-bubble-error");
                    // Render the SVG icon safely + append the raw message as a
                    // text node so err.message is never treated as HTML.
                    thinking.innerHTML = `<span class="qa-btn-icon">${svgIcon("alert-triangle")}</span> `;
                    thinking.appendChild(document.createTextNode(err.message));
                } finally {
                    sendBtn.disabled = false;
                }
            }

            panel.querySelector('[data-action="ai-send"]').addEventListener("click", sendToAi);
            aiInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendToAi();
                }
            });

            panel.querySelector('[data-action="ai-clear"]').addEventListener("click", () => {
                aiHistory.length = 0;
                aiChatEl.innerHTML = "";
                aiReview.hidden = true;
                aiSubject.value = "";
                aiDesc.value = "";
                toast("Chat reset");
            });

            panel.querySelector('[data-action="ai-fill"]').addEventListener("click", () => {
                fillIssueFields(aiSubject.value, aiDesc.value);
            });

            // Default to AI mode when nothing has been saved yet — users
            // typically want the assistant first, and can flip to Template.
            setAiMode(localStorage.getItem(STORAGE.aiMode) !== "0");
        }

        // ---- Close this issue (rendered on every Redmine page, revealed only on /issues/<n>) ----
        // The close-issue markup lives outside the Description Source gate:
        // it renders on any Redmine page but self-hides via [hidden] until
        // isIssueDetailPage() confirms we're actually looking at an issue.
        if (onRedmine) {
            const closeWrap    = panel.querySelector("#qa-close-issue-wrap");
            const closeVerSel  = panel.querySelector("#qa-close-version");
            const closeNote    = panel.querySelector("#qa-close-note");
            const closeFillBtn = panel.querySelector('[data-action="close-fill"]');
            const closeSubBtn  = panel.querySelector('[data-action="close-submit"]');

            // Keep the select + textarea out of the way of panel drag / global
            // shortcut handlers, matching the other form controls in this panel.
            closeVerSel.addEventListener("mousedown", (e) => e.stopPropagation());
            closeVerSel.addEventListener("keydown",   (e) => e.stopPropagation());
            closeNote.addEventListener("mousedown",   (e) => e.stopPropagation());
            closeNote.addEventListener("keydown",     (e) => e.stopPropagation());

            // Enable Fill / Close only when the textarea has content AND a
            // version is picked. Called after both a version change and any
            // user edit of the note.
            function updateCloseButtons() {
                const hasVersion = !!closeVerSel.value;
                const hasNote = closeNote.value.trim().length > 0;
                const ok = hasVersion && hasNote;
                closeFillBtn.disabled = !ok;
                closeSubBtn.disabled  = !ok;
            }

            // When the version changes we (re)generate the default note text
            // and drop it into the textarea so the user always starts from a
            // fresh, correct baseline for the newly picked version. If they
            // want to tweak wording, they can do so freely afterwards — their
            // edits are only overwritten when they change the version again.
            closeVerSel.addEventListener("change", () => {
                const opt = closeVerSel.options[closeVerSel.selectedIndex];
                const versionLabel = (opt && opt.value) ? opt.text : "";
                const projectKey = projectKeyFromBodyClass();
                if (versionLabel) {
                    closeNote.value = buildCloseNote(projectKey, versionLabel);
                    closeNote.disabled = false;
                } else {
                    closeNote.value = "";
                    closeNote.disabled = true;
                }
                updateCloseButtons();
            });

            // User edits to the note also re-evaluate button state, so
            // emptying the textarea disables Fill/Close (prevents submitting
            // an issue-close with a blank note).
            closeNote.addEventListener("input", updateCloseButtons);

            closeFillBtn.addEventListener("click", () => {
                if (!closeVerSel.value) return;
                const ok = fillCloseFields(closeVerSel.value, closeNote.value);
                toast(ok ? "Close fields filled — review, then Submit" : "Couldn't find the update form");
            });

            closeSubBtn.addEventListener("click", () => {
                if (!closeVerSel.value) return;
                const filled = fillCloseFields(closeVerSel.value, closeNote.value);
                if (!filled) { toast("Couldn't find the update form"); return; }
                // Small delay so the change events dispatched by fillCloseFields
                // flush before the form submits (avoids Redmine skipping the
                // status/notes we just wrote).
                setTimeout(() => {
                    submitCloseForm() || toast("Couldn't submit the update form");
                }, 60);
            });

            // Populate + reveal the section only when we're actually looking at
            // an issue detail page. On the new-issue form the section stays
            // hidden — no need to close a not-yet-created issue.
            if (isIssueDetailPage()) {
                if (populateCloseVersionSelect(closeVerSel)) {
                    closeWrap.hidden = false;
                    updateCloseButtons();
                }
            }

            // ---- Analyze Ticket (issue detail pages) ----
            // Reuses the AI transport already wired up for the report drafter,
            // so no extra key/model plumbing here — we just scrape the page,
            // ask, and render.
            const analyzeWrap    = panel.querySelector("#qa-analyze-wrap");
            const analyzeBtn     = panel.querySelector("#qa-analyze-btn");
            const analyzeBtnLbl  = panel.querySelector("#qa-analyze-btn-label");
            const analyzeModal   = panel.querySelector("#qa-analyze-modal");
            const analyzeLoading = analyzeModal && analyzeModal.querySelector("#qa-analyze-loading");
            const analyzeReport  = analyzeModal && analyzeModal.querySelector("#qa-analyze-report");
            const analyzeCopyBtn = analyzeModal && analyzeModal.querySelector("#qa-analyze-copy");
            // Move to document.body so the panel's overflow/backdrop-filter
            // don't clip the overlay (same trick as the bulk-close modal).
            if (analyzeModal) document.body.appendChild(analyzeModal);

            let analyzeRawMd   = "";
            let analyzeRunning = false;

            function openAnalyzeModal() {
                if (!analyzeModal) return;
                analyzeModal.className = "qa-modal-overlay";
                if (panel.classList.contains("qa-dark")) analyzeModal.classList.add("qa-dark");
                Array.from(panel.classList).forEach(c => {
                    if (c.indexOf("qa-accent-") === 0) analyzeModal.classList.add(c);
                });
                analyzeModal.hidden = false;
                requestAnimationFrame(() => analyzeModal.classList.add("qa-modal-open"));
            }
            function closeAnalyzeModal() {
                if (!analyzeModal) return;
                analyzeModal.classList.remove("qa-modal-open");
                setTimeout(() => { analyzeModal.hidden = true; }, 180);
            }

            if (analyzeModal) {
                analyzeModal.querySelectorAll('[data-action="analyze-close"]').forEach(b =>
                    b.addEventListener("click", (e) => { e.stopPropagation(); closeAnalyzeModal(); }));
                // Backdrop click closes; clicks inside .qa-modal don't bubble past it.
                analyzeModal.addEventListener("click", (e) => {
                    if (e.target === analyzeModal) closeAnalyzeModal();
                });
            }

            if (analyzeCopyBtn) {
                analyzeCopyBtn.addEventListener("click", async () => {
                    if (!analyzeRawMd) return;
                    try {
                        await navigator.clipboard.writeText(analyzeRawMd);
                        toast("Analysis copied");
                    } catch (_) {
                        toast("Couldn't copy — check clipboard permissions");
                    }
                });
            }

            if (analyzeBtn) {
                analyzeBtn.addEventListener("click", async () => {
                    if (analyzeRunning) return;
                    if (!AI.key()) { toast("Add your OpenAI API key first"); return; }
                    const payloadObj = scrapeTicketForAnalysis();
                    if (!payloadObj || (!payloadObj.title && !payloadObj.description)) {
                        toast("Nothing to analyze on this ticket");
                        return;
                    }
                    analyzeRunning = true;
                    analyzeBtn.disabled = true;
                    if (analyzeBtnLbl) analyzeBtnLbl.textContent = "Analyzing…";
                    analyzeRawMd = "";
                    if (analyzeReport) { analyzeReport.innerHTML = ""; analyzeReport.hidden = true; }
                    if (analyzeLoading) analyzeLoading.hidden = false;
                    if (analyzeCopyBtn) analyzeCopyBtn.disabled = true;
                    openAnalyzeModal();
                    try {
                        const md = await runTicketAnalysis(payloadObj);
                        analyzeRawMd = md;
                        if (analyzeReport) {
                            analyzeReport.innerHTML = renderAnalysisMarkdown(md);
                            analyzeReport.hidden = false;
                        }
                        if (analyzeLoading) analyzeLoading.hidden = true;
                        if (analyzeCopyBtn) analyzeCopyBtn.disabled = false;
                    } catch (err) {
                        closeAnalyzeModal();
                        toast(err.message || "Couldn't analyze the ticket");
                        console.info("[QA Assistant] Analyze failed:", err);
                    } finally {
                        analyzeRunning = false;
                        analyzeBtn.disabled = false;
                        if (analyzeBtnLbl) analyzeBtnLbl.textContent = "Analyze this ticket";
                    }
                });
            }

            if (analyzeWrap && isIssueDetailPage()) analyzeWrap.hidden = false;

            // ---- Similar closed tickets (issue detail pages) ----
            // Auto-runs once per ticket view. Results cached in localStorage
            // and invalidated by the ticket's subject+tracker signature.
            const similarWrap       = panel.querySelector("#qa-similar-wrap");
            const similarStatus     = panel.querySelector("#qa-similar-status");
            const similarStatusTxt  = similarStatus && similarStatus.querySelector(".qa-similar-status-text");
            const similarList       = panel.querySelector("#qa-similar-list");
            const similarEmpty      = panel.querySelector("#qa-similar-empty");
            const similarRefresh    = panel.querySelector("#qa-similar-refresh");
            const similarMore       = panel.querySelector("#qa-similar-more");
            const similarMoreLbl    = panel.querySelector("#qa-similar-more-label");
            const similarShowAll    = panel.querySelector("#qa-similar-show-all");
            const similarShowAllLbl = panel.querySelector("#qa-similar-show-all-label");

            // Full ranked result set (relevant matches first, then below-
            // threshold ones) + how many rows are currently rendered — drives
            // the "See more" click and the scroll-triggered loads below.
            let similarAllResults      = [];
            let similarVisibleCount    = 0;
            let similarRelevantCount   = 0;
            let similarShowAllUnlocked = false;

            function similarShowStatus(text, spinner) {
                if (!similarStatus) return;
                similarStatus.hidden = false;
                if (similarStatusTxt) similarStatusTxt.textContent = text;
                const s = similarStatus.querySelector(".qa-spinner");
                if (s) s.style.display = spinner ? "" : "none";
                if (similarList)  { similarList.hidden  = true; similarList.innerHTML = ""; }
                if (similarEmpty) similarEmpty.hidden = true;
                if (similarShowAll) similarShowAll.hidden = true;
            }
            function similarShowEmpty() {
                if (similarStatus) similarStatus.hidden = true;
                if (similarList)   { similarList.hidden = true; similarList.innerHTML = ""; }
                if (similarEmpty)  {
                    similarEmpty.hidden = false;
                    similarEmpty.textContent = "No similar closed tickets found in this project.";
                }
                if (similarShowAll) similarShowAll.hidden = true;
            }
            function similarItemHtml(r) {
                const pct = Math.round(r.score * 100);
                const trackerCls = "qa-similar-badge qa-similar-tracker-" + String(r.tracker || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const href = REDMINE + "/issues/" + r.id;
                const meta = r.closedVersion ? ("Closed in " + escapeText(r.closedVersion)) : "Closed";
                const lowCls = r.lowMatch ? " qa-similar-item-low" : "";
                return `
                        <li class="qa-similar-item${lowCls}">
                            <a href="${href}" target="_blank" rel="noopener" title="${escapeText(r.subject)}">
                                <span class="qa-similar-row-top">
                                    <span class="qa-similar-id">#${escapeText(r.id)}</span>
                                    <span class="${trackerCls}">${escapeText(r.tracker || "")}</span>
                                    <span class="qa-similar-score" title="${pct}% match">${pct}%</span>
                                </span>
                                <span class="qa-similar-subject">${escapeText(r.subject)}</span>
                                <span class="qa-similar-meta">${meta}</span>
                            </a>
                        </li>`;
            }
            // Reveal is capped at the relevant matches until "Show all" unlocks the rest.
            function similarEffectiveCap() {
                return similarShowAllUnlocked ? similarAllResults.length : similarRelevantCount;
            }
            // Appends the next `amount` not-yet-rendered results to the list.
            function similarRevealMore(amount) {
                const cap = similarEffectiveCap();
                const start = similarVisibleCount;
                const end = Math.min(start + amount, cap);
                if (end <= start) return;
                similarList.insertAdjacentHTML("beforeend", similarAllResults.slice(start, end).map(similarItemHtml).join(""));
                similarVisibleCount = end;
            }
            // Shows/hides the "Show N more (low relevance)" control once every
            // relevant match has been revealed and lower-scored extras exist.
            function similarUpdateShowAllControl() {
                if (!similarShowAll) return;
                const extra = similarAllResults.length - similarRelevantCount;
                const relevantFullyShown = similarVisibleCount >= similarRelevantCount;
                const show = extra > 0 && !similarShowAllUnlocked && relevantFullyShown;
                similarShowAll.hidden = !show;
                if (show && similarShowAllLbl) similarShowAllLbl.textContent = "Show " + extra + " more (low relevance)";
            }
            function similarRenderResults(results) {
                if (!similarList) return;
                similarAllResults      = results || [];
                similarVisibleCount    = 0;
                similarShowAllUnlocked = false;
                similarRelevantCount   = similarAllResults.reduce((n, r) => n + (r.lowMatch ? 0 : 1), 0);
                if (!similarAllResults.length) { similarShowEmpty(); return; }
                if (similarStatus) similarStatus.hidden = true;
                similarList.innerHTML = "";
                similarList.scrollTop = 0;

                if (similarRelevantCount === 0) {
                    similarList.hidden = true;
                    if (similarEmpty) {
                        similarEmpty.hidden = false;
                        similarEmpty.textContent = "No close matches — " + similarAllResults.length
                            + " loosely related ticket" + (similarAllResults.length === 1 ? "" : "s") + " available below.";
                    }
                } else {
                    if (similarEmpty) similarEmpty.hidden = true;
                    similarList.hidden = false;
                    similarRevealMore(SIMILAR_INITIAL_VISIBLE);
                    // The button only ever offers the first expansion (5 → 10)
                    // within the relevant matches; everything past that loads
                    // by scrolling the list itself.
                    const firstBatchTarget = Math.min(SIMILAR_PAGE_SIZE, similarRelevantCount);
                    const firstBatchRemaining = firstBatchTarget - similarVisibleCount;
                    if (similarMore) {
                        similarMore.hidden = firstBatchRemaining <= 0;
                        if (similarMoreLbl) similarMoreLbl.textContent = "See more (" + firstBatchRemaining + ")";
                    }
                }
                similarUpdateShowAllControl();
            }

            // Small local HTML-escaper — model output goes into innerHTML.
            function escapeText(s) {
                return String(s == null ? "" : s)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
            }

            let similarRunning = false;
            async function runSimilarSearch(bypassCache) {
                if (similarRunning) return;
                const current = similarScrapeCurrent();
                if (!current) return;
                const projectSlug = similarProjectSlug();
                const cache = similarCacheLoad();
                const sig = similarCacheSig(current);
                if (!bypassCache) {
                    const hit = cache[current.id];
                    if (hit && hit.sig === sig && Array.isArray(hit.results)) {
                        similarRenderResults(hit.results);
                        return;
                    }
                }
                similarRunning = true;
                if (similarRefresh) similarRefresh.disabled = true;
                similarShowStatus("Searching…", true);
                try {
                    const { results } = await fetchSimilarClosedTickets(current, projectSlug);
                    cache[current.id] = { sig: sig, results: results, savedAt: Date.now() };
                    similarCacheSave(cache);
                    similarRenderResults(results);
                } catch (err) {
                    console.info("[QA Assistant] Similar closed tickets failed:", err);
                    similarShowStatus("Couldn't reach Redmine — try Refresh.", false);
                } finally {
                    similarRunning = false;
                    if (similarRefresh) similarRefresh.disabled = false;
                }
            }
            if (similarRefresh) similarRefresh.addEventListener("click", () => runSimilarSearch(true));
            if (similarMore) similarMore.addEventListener("click", () => {
                similarRevealMore(SIMILAR_PAGE_SIZE - SIMILAR_INITIAL_VISIBLE);
                similarMore.hidden = true;
                similarUpdateShowAllControl();
            });
            if (similarShowAll) similarShowAll.addEventListener("click", () => {
                similarShowAllUnlocked = true;
                similarShowAll.hidden = true;
                // Zero-relevant-match state leaves the list itself hidden
                // (empty-state message shown instead) — surface it now.
                if (similarList.hidden) {
                    similarList.hidden = false;
                    if (similarEmpty) similarEmpty.hidden = true;
                }
                similarRevealMore(SIMILAR_PAGE_SIZE);
            });
            // Infinite-scroll: once the current batch (relevant matches, or the
            // unlocked full set) is exhausted, reaching the bottom of the list
            // loads the next page of already-fetched, already-ranked results.
            if (similarList) similarList.addEventListener("scroll", () => {
                if (similarVisibleCount >= similarEffectiveCap()) return;
                const nearBottom = similarList.scrollTop + similarList.clientHeight >= similarList.scrollHeight - 24;
                if (nearBottom) { similarRevealMore(SIMILAR_PAGE_SIZE); similarUpdateShowAllControl(); }
            });
            if (similarWrap && isIssueDetailPage()) {
                similarWrap.hidden = false;
                runSimilarSearch(false);
            }

            // ---- Bulk close (Agile board) ----
            // Wire the "Close multiple issues" section. All handlers are set
            // up regardless of page, but the section stays hidden unless
            // we're actually on an Agile board (checked at the bottom).
            const bulkWrap        = panel.querySelector("#qa-bulk-close-wrap");
            const bulkFields      = panel.querySelector("#qa-bulk-fields");
            const bulkSelectBtn   = panel.querySelector('[data-action="bulk-select-toggle"]');
            const bulkSelectLabel = panel.querySelector("#qa-bulk-select-label");
            const bulkCancelBtn   = panel.querySelector('[data-action="bulk-cancel"]');
            const bulkSubmitBtn   = panel.querySelector("#qa-bulk-submit");
            const bulkSubmitLabel = panel.querySelector("#qa-bulk-submit-label");
            const bulkVerSel      = panel.querySelector("#qa-bulk-version");
            const bulkNote        = panel.querySelector("#qa-bulk-note");
            const bulkCountEl     = panel.querySelector("#qa-bulk-count");
            const bulkModal       = panel.querySelector("#qa-bulk-modal");
            const bulkModalList   = bulkModal && bulkModal.querySelector("#qa-bulk-modal-list");
            const bulkModalSummary= bulkModal && bulkModal.querySelector("#qa-bulk-modal-summary");
            const bulkModalVer    = bulkModal && bulkModal.querySelector("#qa-bulk-modal-version");
            const bulkModalNote   = bulkModal && bulkModal.querySelector("#qa-bulk-modal-note");
            const bulkModalTitle  = bulkModal && bulkModal.querySelector("#qa-bulk-modal-title");
            const bulkModalOkLbl  = bulkModal && bulkModal.querySelector("#qa-bulk-modal-confirm-label");
            const bulkModalOkBtn  = bulkModal && bulkModal.querySelector('[data-action="modal-confirm"]');
            const bulkModalProgress     = bulkModal && bulkModal.querySelector("#qa-bulk-modal-progress");
            const bulkModalProgressText = bulkModal && bulkModal.querySelector("#qa-bulk-modal-progress-text");
            const bulkModalProgressFill = bulkModal && bulkModal.querySelector("#qa-bulk-modal-progress-fill");

            // Move the modal out of #qa-panel so backdrop-filter + overflow
            // don't clip the overlay (same trick as the accent popover).
            if (bulkModal) document.body.appendChild(bulkModal);

            // Keep the select + textarea out of the way of panel drag / global
            // shortcut handlers, matching every other form control in the panel.
            [bulkVerSel, bulkNote].forEach(el => {
                if (!el) return;
                el.addEventListener("mousedown", (e) => e.stopPropagation());
                el.addEventListener("keydown",   (e) => e.stopPropagation());
            });

            let bulkSelecting  = false;
            let bulkSelected   = new Set();  // Set<string> of picked issue IDs
            let bulkCardCtx    = new Map();  // Map<id, { card, subject, statusId }>
            let bulkContext    = null;       // { csrf, closedStatusId, versions }
            let bulkCtxLoading = false;
            // Workflow-probe cache keyed by current status id. Value is either
            // a boolean (probe finished: true = "Closed" is a legal transition)
            // or a Promise<boolean> (probe still in flight). Populated lazily
            // as cards are ticked so openBulkModal() usually has answers ready.
            let bulkWorkflowOk = new Map();
            let bulkWillCloseIds = [];       // Ids the POST will actually send
            // Flipped to true once the confirm-click loop has finished. When
            // set, any dismissal of the modal (Close button, backdrop, X)
            // removes the closed cards from the Agile board and hides the
            // modal without navigating — a reload here would fire Redmine's
            // warnLeavingUnsaved beforeunload prompt.
            let bulkOperationDone = false;
            // Ids that postSingleIssueUpdate returned success for. Used by
            // closeBulkModal() to strip those cards from the Agile board
            // DOM so the visible state matches reality without a reload.
            let bulkClosedIds = new Set();

            // Ids to POST are computed at modal-open time (excludes cards that
            // are already Closed and cards whose current status has no direct
            // "Closed" transition).


            function bulkProjectLabel() {
                const key = projectKeyFromBodyClass();
                return (PROJECTS[key] && PROJECTS[key].label) || "this project";
            }

            // Re-computes the count chip, submit button label + enabled state
            // based on selected size + note + version. Called from every
            // interaction that could affect any of the three.
            function updateBulkCount() {
                const n = bulkSelected.size;
                bulkCountEl.hidden = n === 0;
                bulkCountEl.textContent = n === 1 ? "1 selected" : (n + " selected");
                const ready = n > 0 && !!bulkVerSel.value && bulkNote.value.trim().length > 0;
                bulkSubmitBtn.disabled = !ready;
                bulkSubmitLabel.textContent = n > 0 ? ("Close " + n + "…") : "Close…";
                bulkFields.hidden = n === 0;
            }

            // Inject a checkbox overlay into a card and wire it to the shared
            // selection Set. Cards are only marked with .qa-card-selected
            // (via the checkbox change) — no visual chrome outside select mode.
            function bulkMakeCheckbox(card, id) {
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "qa-card-checkbox";
                cb.setAttribute("data-qa-id", id);
                // Cards on the agile board are draggable — stop mousedown
                // reaching the drag handler so ticking a card doesn't start
                // a drag.
                cb.addEventListener("mousedown", (e) => e.stopPropagation());
                cb.addEventListener("click", (e) => e.stopPropagation());
                cb.addEventListener("change", () => {
                    if (cb.checked) {
                        bulkSelected.add(id);
                        card.classList.add("qa-card-selected");
                        // Kick off a workflow probe for this card's current
                        // status so the confirmation modal can render badges
                        // without a spinner in the common case.
                        const ctx = bulkCardCtx.get(id);
                        if (ctx && ctx.statusId) primeWorkflowProbe(ctx.statusId, id);
                    } else {
                        bulkSelected.delete(id);
                        card.classList.remove("qa-card-selected");
                    }
                    updateBulkCount();
                    ensureBulkContext();
                });
                return cb;
            }

            function bulkAttachCheckboxes() {
                bulkCardCtx.clear();
                getBoardCards().forEach(card => {
                    const id = cardIssueId(card);
                    if (!id) return;
                    if (card.querySelector(".qa-card-checkbox")) return;
                    bulkCardCtx.set(id, {
                        card,
                        subject: cardSubject(card),
                        statusId: cardCurrentStatusId(card)
                    });
                    card.appendChild(bulkMakeCheckbox(card, id));
                });
            }

            function bulkDetachCheckboxes() {
                document.querySelectorAll(".qa-card-checkbox").forEach(el => el.remove());
                document.querySelectorAll(".qa-card-selected").forEach(el =>
                    el.classList.remove("qa-card-selected"));
            }

            function exitBulkSelect() {
                bulkSelecting = false;
                document.body.classList.remove("qa-selecting");
                bulkSelectBtn.classList.remove("qa-active");
                bulkSelectLabel.textContent = "Enter select mode";
                bulkDetachCheckboxes();
                bulkSelected.clear();
                bulkCardCtx.clear();
                bulkWorkflowOk.clear();
                bulkWillCloseIds = [];
                bulkFields.hidden = true;
                bulkCountEl.hidden = true;
                bulkNote.value = "";
                bulkNote.disabled = true;
                bulkVerSel.value = "";
                updateBulkCount();
            }

            function enterBulkSelect() {
                bulkSelecting = true;
                document.body.classList.add("qa-selecting");
                bulkSelectBtn.classList.add("qa-active");
                bulkSelectLabel.textContent = "Exit select mode";
                bulkAttachCheckboxes();
                bulkFields.hidden = false;
                updateBulkCount();
                ensureBulkContext();
            }

            // On version change, regenerate the default note from the standard
            // template (same buildCloseNote helper the single-issue close uses)
            // so the user sees a fresh baseline. They can edit freely afterwards.
            function refreshBulkNote() {
                const opt = bulkVerSel.options[bulkVerSel.selectedIndex];
                const versionLabel = (opt && opt.value) ? opt.text : "";
                const projectKey = projectKeyFromBodyClass();
                if (versionLabel) {
                    bulkNote.value = buildCloseNote(projectKey, versionLabel);
                    bulkNote.disabled = false;
                } else {
                    bulkNote.value = "";
                    bulkNote.disabled = true;
                }
                updateBulkCount();
            }

            function bulkPopulateVersionSelect(versions) {
                bulkVerSel.innerHTML = '<option value="">— pick a version —</option>';
                versions.forEach(v => {
                    const opt = document.createElement("option");
                    opt.value = v.value;
                    opt.textContent = v.label;
                    bulkVerSel.appendChild(opt);
                });
                bulkVerSel.disabled = false;
            }

            // Lazily fetch the bulk-edit form on first tick so we don't hit
            // Redmine unless the user actually starts selecting. Cached for
            // the lifetime of the page (versions are project-wide).
            function ensureBulkContext() {
                if (bulkContext || bulkCtxLoading) return;
                const anyId = Array.from(bulkCardCtx.keys())[0]
                    || getBoardCards().map(cardIssueId).find(Boolean);
                if (!anyId) return;
                bulkCtxLoading = true;
                fetchBulkEditContext([anyId])
                    .then(ctx => {
                        bulkContext = ctx;
                        bulkPopulateVersionSelect(ctx.versions);
                    })
                    .catch(err => {
                        toast(err.message || "Couldn't load the Closed Version list");
                    })
                    .finally(() => { bulkCtxLoading = false; });
            }

            // Fire-and-cache a workflow probe for one current-status id.
            // Uses `representativeIssueId` (any selected card sitting in that
            // status) to ask Redmine whether "Closed" is a legal transition.
            // Cards already in the closed column resolve trivially to
            // "already-closed" and are skipped from the POST.
            function primeWorkflowProbe(statusId, representativeIssueId) {
                if (!statusId) return;
                if (bulkWorkflowOk.has(statusId)) return;
                if (!bulkContext || !bulkContext.closedStatusId) {
                    // Context not ready yet — openBulkModal will re-prime
                    // once the form has loaded.
                    return;
                }
                if (String(statusId) === String(bulkContext.closedStatusId)) {
                    bulkWorkflowOk.set(statusId, "already-closed");
                    return;
                }
                const p = probeCloseTransition(representativeIssueId, bulkContext.closedStatusId)
                    .then(ok => {
                        bulkWorkflowOk.set(statusId, !!ok);
                        return !!ok;
                    })
                    .catch(() => {
                        // On probe failure be optimistic — Redmine will still
                        // silently skip anything it refuses to update.
                        bulkWorkflowOk.set(statusId, true);
                        return true;
                    });
                bulkWorkflowOk.set(statusId, p);
            }

            bulkVerSel.addEventListener("change", refreshBulkNote);
            bulkNote.addEventListener("input", updateBulkCount);

            bulkSelectBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (bulkSelecting) exitBulkSelect(); else enterBulkSelect();
            });

            bulkCancelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                exitBulkSelect();
            });

            async function openBulkModal() {
                if (!bulkModal) return;
                const ids = Array.from(bulkSelected);
                if (!ids.length) return;
                if (!bulkContext || !bulkContext.closedStatusId) {
                    toast("Still loading bulk-edit form — try again in a moment");
                    ensureBulkContext();
                    return;
                }
                const opt = bulkVerSel.options[bulkVerSel.selectedIndex];
                const versionLabel = (opt && opt.value) ? opt.text : "(none)";

                // Mirror panel theme + accent classes onto the modal so it
                // picks up the same tokens (mirrors the accent-popover trick).
                bulkModal.className = "qa-modal-overlay";
                if (panel.classList.contains("qa-dark")) bulkModal.classList.add("qa-dark");
                Array.from(panel.classList).forEach(c => {
                    if (c.indexOf("qa-accent-") === 0) bulkModal.classList.add(c);
                });

                // Reveal the modal in a "checking workflow…" state while we
                // wait for any outstanding probes so the user always sees the
                // dialog immediately, not a delay-then-appear.
                bulkModalTitle.textContent = "Close " + ids.length + " issue" + (ids.length === 1 ? "" : "s") + " in " + bulkProjectLabel() + "?";
                bulkModalOkLbl.textContent = "Checking\u2026";
                if (bulkModalOkBtn) bulkModalOkBtn.disabled = true;
                bulkModalVer.textContent = versionLabel;
                bulkModalNote.textContent = bulkNote.value;
                bulkModalList.innerHTML = "";
                // Reset progress UI — a previous close cycle may have left
                // it in a mid-flight state if the user reopens the modal.
                if (bulkModalProgress) {
                    bulkModalProgress.hidden = true;
                    bulkModalProgress.classList.remove("qa-modal-progress-done");
                }
                if (bulkModalProgressFill) bulkModalProgressFill.style.width = "0%";
                if (bulkModalProgressText) bulkModalProgressText.textContent = "Closing…";
                bulkOperationDone = false;
                bulkClosedIds.clear();
                if (bulkModalSummary) {
                    bulkModalSummary.hidden = false;
                    bulkModalSummary.className = "qa-modal-summary qa-modal-summary-checking";
                    bulkModalSummary.textContent = "Checking Redmine's workflow rules\u2026";
                }
                bulkModal.hidden = false;
                requestAnimationFrame(() => bulkModal.classList.add("qa-modal-open"));

                // Kick off any missing probes now, then await everything.
                ids.forEach(id => {
                    const ctx = bulkCardCtx.get(id);
                    if (ctx && ctx.statusId) primeWorkflowProbe(ctx.statusId, id);
                });
                const pending = ids.map(id => {
                    const ctx = bulkCardCtx.get(id);
                    const v = ctx ? bulkWorkflowOk.get(ctx.statusId) : true;
                    return (v && typeof v.then === "function") ? v : Promise.resolve(v);
                });
                try { await Promise.all(pending); } catch (_) { /* handled per-probe */ }

                // Categorise every selected id and build the final POST list.
                const willClose = [];
                const alreadyClosed = [];
                const blocked = [];
                ids.forEach(id => {
                    const ctx = bulkCardCtx.get(id);
                    const v = ctx ? bulkWorkflowOk.get(ctx.statusId) : true;
                    if (v === "already-closed") alreadyClosed.push(id);
                    else if (v === false)       blocked.push(id);
                    else                        willClose.push(id);
                });
                bulkWillCloseIds = willClose;

                // Render the list with per-row badges. Ordering: will-close
                // first (the action), then already-closed, then blocked.
                bulkModalList.innerHTML = "";
                const ordered = willClose.concat(alreadyClosed).concat(blocked);
                ordered.forEach(id => {
                    const ctx = bulkCardCtx.get(id);
                    const li = document.createElement("li");
                    li.dataset.issueId = String(id);
                    const a = document.createElement("a");
                    a.href = REDMINE + "/issues/" + id;
                    a.target = "_blank";
                    a.rel = "noopener";
                    a.textContent = "#" + id;
                    const sub = document.createElement("span");
                    sub.className = "qa-modal-list-subject";
                    sub.textContent = " " + (ctx ? ctx.subject : "");
                    li.appendChild(a);
                    li.appendChild(sub);
                    if (alreadyClosed.indexOf(id) !== -1) {
                        li.classList.add("qa-modal-list-skip");
                        const badge = document.createElement("span");
                        badge.className = "qa-modal-badge qa-modal-badge-noop";
                        badge.textContent = "already closed";
                        li.appendChild(badge);
                    } else if (blocked.indexOf(id) !== -1) {
                        li.classList.add("qa-modal-list-skip");
                        const badge = document.createElement("span");
                        badge.className = "qa-modal-badge qa-modal-badge-warn";
                        badge.textContent = "workflow blocks";
                        badge.title = "Redmine's workflow doesn't allow a direct transition to Closed from this status. Change the status manually first, or move the card through the intermediate columns.";
                        li.appendChild(badge);
                    }
                    bulkModalList.appendChild(li);
                });

                // Summary line + button state.
                const parts = [];
                parts.push(willClose.length + " will close");
                if (alreadyClosed.length) parts.push(alreadyClosed.length + " already closed");
                if (blocked.length) parts.push(blocked.length + " blocked by workflow");
                if (bulkModalSummary) {
                    bulkModalSummary.hidden = false;
                    bulkModalSummary.className = "qa-modal-summary" + (blocked.length ? " qa-modal-summary-warn" : "");
                    bulkModalSummary.textContent = parts.join(" \u00b7 ");
                }

                if (willClose.length) {
                    bulkModalOkLbl.textContent = "Close " + willClose.length + " issue" + (willClose.length === 1 ? "" : "s");
                    if (bulkModalOkBtn) bulkModalOkBtn.disabled = false;
                } else {
                    // Nothing can be closed — leave the button disabled and
                    // relabel so the user knows why the modal is useless.
                    bulkModalOkLbl.textContent = "Nothing to close";
                    if (bulkModalOkBtn) bulkModalOkBtn.disabled = true;
                }
            }

            function closeBulkModal() {
                if (!bulkModal) return;
                // Update the visible board first so that even if the
                // reload below hits a browser prompt the user can't
                // suppress, dismissing that prompt still leaves the board
                // in a correct state (closed cards already gone, select
                // mode already exited).
                if (bulkOperationDone) {
                    bulkClosedIds.forEach(id => {
                        const ctx = bulkCardCtx.get(id);
                        const card = ctx && ctx.card;
                        if (card && card.parentNode) {
                            card.parentNode.removeChild(card);
                        }
                    });
                    exitBulkSelect();
                }
                bulkModal.classList.remove("qa-modal-open");
                setTimeout(() => {
                    bulkModal.hidden = true;
                    if (!bulkOperationDone) return;
                    // Reload the Agile board so column counters, sprint
                    // totals, and any server-side derived widgets refresh
                    // — the DOM removal above only fixes the cards. The
                    // qaSafeReload() helper detaches every beforeunload
                    // listener our document-start guard collected before
                    // firing location.reload(), so the browser doesn't
                    // pop a "Leave site?" prompt.
                    qaSafeReload();
                }, 180);
            }

            bulkSubmitBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openBulkModal();
            });

            if (bulkModal) {
                // Click on the overlay backdrop (not the modal card) closes.
                bulkModal.addEventListener("click", (e) => {
                    if (e.target === bulkModal) closeBulkModal();
                });
                bulkModal.querySelectorAll('[data-action="modal-cancel"]').forEach(b =>
                    b.addEventListener("click", (e) => { e.stopPropagation(); closeBulkModal(); }));
                if (bulkModalOkBtn) {
                    bulkModalOkBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        // Once the operation has completed, the button turns
                        // into a "Close window" trigger — dismiss (which
                        // reloads via closeBulkModal) instead of running the
                        // close loop again.
                        if (bulkOperationDone) {
                            closeBulkModal();
                            return;
                        }
                        // Send only cards the pre-flight cleared — Redmine
                        // would silently skip the rest anyway, and this way
                        // the toast + reload numbers match what the user
                        // confirmed in the modal.
                        const ids = bulkWillCloseIds.slice();
                        if (!ids.length || !bulkContext) return;
                        // Snapshot the confirm inputs — we clear the note
                        // textarea after the loop to defuse Redmine's
                        // warnLeavingUnsaved guard, but every per-issue PUT
                        // still needs the original values.
                        const versionId = bulkVerSel.value;
                        const notes     = bulkNote.value;
                        const statusId  = bulkContext.closedStatusId;
                        const csrf      = bulkContext.csrf;
                        // Lock both action buttons for the duration — users
                        // shouldn't be able to cancel mid-flight (some
                        // issues would already be closed, leaving a
                        // half-done state).
                        bulkModalOkBtn.disabled = true;
                        bulkModal.querySelectorAll('[data-action="modal-cancel"]').forEach(b => { b.disabled = true; });
                        // Reveal the progress UI and prime it at 0 %.
                        if (bulkModalProgress) {
                            bulkModalProgress.hidden = false;
                            bulkModalProgress.classList.remove("qa-modal-progress-done");
                        }
                        if (bulkModalProgressFill) bulkModalProgressFill.style.width = "0%";
                        if (bulkModalProgressText) {
                            bulkModalProgressText.textContent = "0 of " + ids.length + " closed…";
                        }
                        if (bulkModalOkLbl) bulkModalOkLbl.textContent = "Closing…";

                        let done = 0;
                        let failed = 0;
                        for (const id of ids) {
                            try {
                                await postSingleIssueUpdate({
                                    id,
                                    statusId,
                                    versionId,
                                    notes,
                                    csrf
                                });
                                bulkClosedIds.add(id);
                                // Mark the row as closed with a green badge.
                                const li = bulkModalList.querySelector('li[data-issue-id="' + id + '"]');
                                if (li) {
                                    li.classList.add("qa-modal-list-done");
                                    const badge = document.createElement("span");
                                    badge.className = "qa-modal-badge qa-modal-badge-done";
                                    badge.textContent = "closed";
                                    li.appendChild(badge);
                                }
                            } catch (err) {
                                failed += 1;
                                const msg = err && err.message ? err.message : "Update failed";
                                const li = bulkModalList.querySelector('li[data-issue-id="' + id + '"]');
                                if (li) {
                                    li.classList.add("qa-modal-list-failed");
                                    const badge = document.createElement("span");
                                    badge.className = "qa-modal-badge qa-modal-badge-fail";
                                    badge.textContent = "failed";
                                    badge.title = msg;
                                    li.appendChild(badge);
                                    // Inline error message so the reason is
                                    // visible without hovering the badge.
                                    const errNote = document.createElement("div");
                                    errNote.className = "qa-modal-list-error";
                                    errNote.textContent = msg;
                                    li.appendChild(errNote);
                                }
                            }
                            done += 1;
                            const pct = Math.round((done / ids.length) * 100);
                            if (bulkModalProgressFill) bulkModalProgressFill.style.width = pct + "%";
                            if (bulkModalProgressText) {
                                bulkModalProgressText.textContent = done + " of " + ids.length + " closed…";
                            }
                        }

                        const okCount = done - failed;
                        if (bulkModalProgressText) {
                            bulkModalProgressText.textContent = failed
                                ? okCount + " of " + ids.length + " closed · " + failed + " failed"
                                : okCount + " of " + ids.length + " closed";
                        }
                        if (bulkModalProgress) bulkModalProgress.classList.add("qa-modal-progress-done");
                        toast(
                            failed
                                ? "Closed " + okCount + " of " + ids.length + " (" + failed + " failed)"
                                : "Closed " + okCount + " issue" + (okCount === 1 ? "" : "s")
                        );
                        // Repurpose the confirm button as a "Close window"
                        // trigger and re-enable the cancel controls — the
                        // user reviews the per-row statuses, then dismisses
                        // (which removes the closed cards from the board
                        // without reloading).
                        bulkOperationDone = true;
                        if (bulkModalOkLbl) bulkModalOkLbl.textContent = "Close window";
                        bulkModalOkBtn.disabled = false;
                        bulkModal.querySelectorAll('[data-action="modal-cancel"]').forEach(b => { b.disabled = false; });
                    });
                }
            }

            // ---- Show Reopened Issues (Agile board) ----
            // View-only companion to bulk-close: one button that fires an
            // HTML query for every issue in the sprint that ever held the
            // "Development: Reopen" status. Wired in the same guarded
            // block so it only runs on Redmine origins.
            const reopenedWrap      = panel.querySelector("#qa-reopened-wrap");
            const reopenedBtn       = panel.querySelector("#qa-show-reopened");
            const reopenedBtnLabel  = panel.querySelector("#qa-show-reopened-label");
            const reopenedWarn      = panel.querySelector("#qa-reopened-warn");
            const reopenedModal     = panel.querySelector("#qa-reopened-modal");
            const reopenedModalList = reopenedModal && reopenedModal.querySelector("#qa-reopened-modal-list");
            const reopenedModalSum  = reopenedModal && reopenedModal.querySelector("#qa-reopened-modal-summary");
            const reopenedModalCount = reopenedModal && reopenedModal.querySelector("#qa-reopened-modal-count");

            // Same overflow / backdrop-filter trick as the bulk modal —
            // detach from panel so it can cover the whole viewport.
            if (reopenedModal) document.body.appendChild(reopenedModal);

            // Per-board short-lived cache so re-clicking the button while
            // sitting on the same sprint doesn't hammer the /issues
            // endpoint. Cleared on navigation (hashchange / popstate)
            // because moving between boards changes the scope.
            const reopenedCache = new Map();
            function reopenedCacheKey(scope) {
                return (scope && scope.projectSlug || "") + "|" + (scope && scope.versionId || "");
            }
            window.addEventListener("popstate",   () => reopenedCache.clear());
            window.addEventListener("hashchange", () => reopenedCache.clear());

            // Toggle the "Partially synced" warning strip below the
            // button based on the latest scan result. Called after
            // every scan outcome (fresh scan, resume, cache-hit
            // complete) so the strip always reflects reality.
            function updateReopenedWarn(result) {
                if (!reopenedWarn) return;
                reopenedWarn.hidden = !(result && result.timedOut);
            }

            function closeReopenedModal() {
                if (!reopenedModal) return;
                // Mirror bulk-close teardown: strip the open class first
                // so the fade-out transition plays, then hide after the
                // 180ms opacity transition finishes.
                reopenedModal.classList.remove("qa-modal-open");
                setTimeout(() => { reopenedModal.hidden = true; }, 180);
            }

            // Latest rows currently shown in the modal. Captured on
            // every 'openReopenedModal' call so the "Copy list" button
            // has something to serialize even after re-scans.
            let reopenedCurrentRows = [];

            // Build the HTML + plain-text payloads for the Copy button.
            // HTML preserves the '#id' hyperlink when pasted into rich
            // targets (Word, Outlook, Redmine wiki editors); the plain
            // fallback lists the URL in parentheses so Notepad-style
            // targets still get something usable.
            function buildReopenedClipboardPayload(rows) {
                const htmlLines = [];
                const textLines = [];
                rows.forEach(r => {
                    const url = REDMINE + "/issues/" + r.id;
                    const subj = (r.subject || "(no subject)")
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
                    htmlLines.push('<a href="' + url + '">#' + r.id + '</a> - ' + subj);
                    textLines.push("#" + r.id + " - " + (r.subject || "(no subject)") + " (" + url + ")");
                });
                return {
                    html: htmlLines.join("<br>"),
                    text: textLines.join("\n")
                };
            }

            async function copyReopenedListToClipboard() {
                const rows = reopenedCurrentRows;
                if (!rows.length) { toast("Nothing to copy"); return; }
                const payload = buildReopenedClipboardPayload(rows);
                try {
                    // Rich HTML + plain text via ClipboardItem so both
                    // rich and plain paste targets pick their preferred
                    // format. Falls back to plain-text writeText() if
                    // ClipboardItem isn't supported (older browsers).
                    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
                        const item = new ClipboardItem({
                            "text/html":  new Blob([payload.html], { type: "text/html" }),
                            "text/plain": new Blob([payload.text], { type: "text/plain" })
                        });
                        await navigator.clipboard.write([item]);
                    } else if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(payload.text);
                    } else {
                        throw new Error("Clipboard API unavailable");
                    }
                    console.info("[QA Assistant] Copied", rows.length, "reopened issues to clipboard");
                    toast("Copied " + rows.length + " issue" + (rows.length === 1 ? "" : "s"));
                } catch (err) {
                    console.error("[QA Assistant] Copy failed:", err);
                    toast("Copy failed: " + (err && err.message ? err.message : "unknown error"));
                }
            }

            function openReopenedModal(rows, result) {
                if (!reopenedModal || !reopenedModalList) return;
                console.info("[QA Assistant] openReopenedModal rows =", rows.length);
                reopenedCurrentRows = rows;
                // Mirror panel theme + accent classes onto the detached
                // modal so it picks up the same tokens (identical to the
                // bulk-close modal — CSS custom props on the panel don't
                // cascade to <body>-mounted overlays).
                reopenedModal.className = "qa-modal-overlay";
                if (panel.classList.contains("qa-dark")) reopenedModal.classList.add("qa-dark");
                Array.from(panel.classList).forEach(c => {
                    if (c.indexOf("qa-accent-") === 0) reopenedModal.classList.add(c);
                });
                reopenedModalList.innerHTML = "";
                // Total-reopened counter pill in the title. Uses
                // rows.length because that's exactly what the modal
                // is about to display (Phase A + Phase B combined).
                if (reopenedModalCount) {
                    reopenedModalCount.textContent = String(rows.length);
                    reopenedModalCount.hidden = rows.length === 0;
                }
                rows.forEach(r => {
                    const li = document.createElement("li");
                    li.setAttribute("data-issue-id", r.id);
                    const a  = document.createElement("a");
                    a.href   = "/issues/" + r.id;
                    a.target = "_blank";
                    a.rel    = "noopener";
                    a.textContent = "#" + r.id;
                    const sub = document.createElement("span");
                    sub.className = "qa-modal-list-subject";
                    sub.textContent = r.subject || "(no subject)";
                    const badge = document.createElement("span");
                    badge.className = "qa-modal-badge qa-modal-badge-noop";
                    badge.textContent = r.status || "";
                    li.appendChild(a);
                    li.appendChild(document.createTextNode(" "));
                    li.appendChild(sub);
                    if (r.status) {
                        li.appendChild(document.createTextNode(" "));
                        li.appendChild(badge);
                    }
                    reopenedModalList.appendChild(li);
                });
                if (reopenedModalSum) {
                    // Flag truncation: either the journal scan hit its
                    // wall-clock cap (timedOut) or Redmine's pagination
                    // totals disagree with what we scanned. On timeout
                    // we tell the user to click again — the next click
                    // resumes from the cached checkpoint.
                    const scanned = (result && result.scannedCount) || rows.length;
                    const sprintTotal = (result && result.sprintTotalCount) || scanned;
                    if (result && result.timedOut) {
                        reopenedModalSum.hidden = false;
                        reopenedModalSum.textContent = "Partial result: scanned " + scanned + " of " + sprintTotal + " sprint issues so far. Close and click the button again to resume where this pass left off.";
                    } else if (sprintTotal > scanned) {
                        reopenedModalSum.hidden = false;
                        reopenedModalSum.textContent = "Scanned first " + scanned + " of " + sprintTotal + " sprint issues.";
                    } else {
                        reopenedModalSum.hidden = true;
                        reopenedModalSum.textContent = "";
                    }
                }
                // Reveal + fade in. `hidden=false` first (so the browser
                // lays it out) then rAF-add `qa-modal-open` on the next
                // frame so the opacity transition actually animates
                // from 0→1 instead of snapping.
                reopenedModal.hidden = false;
                requestAnimationFrame(() => reopenedModal.classList.add("qa-modal-open"));
            }

            if (reopenedModal) {
                // Backdrop click + explicit close buttons both dismiss.
                reopenedModal.addEventListener("click", (e) => {
                    if (e.target === reopenedModal) closeReopenedModal();
                });
                reopenedModal.querySelectorAll('[data-action="reopened-close"]').forEach(b =>
                    b.addEventListener("click", (e) => { e.stopPropagation(); closeReopenedModal(); }));
                const copyBtn = reopenedModal.querySelector('[data-action="reopened-copy"]');
                if (copyBtn) copyBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    copyReopenedListToClipboard();
                });
            }

            if (reopenedBtn) {
                console.info("[QA Assistant] Reopened button wired");
                reopenedBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    console.info("[QA Assistant] Reopened button clicked");
                    const scope = getCurrentBoardScope();
                    console.info("[QA Assistant] Board scope:", scope);
                    if (!scope) {
                        toast("Open an Agile board first.");
                        return;
                    }
                    const cacheKey = reopenedCacheKey(scope);
                    const cached   = reopenedCache.get(cacheKey);
                    // A cached result short-circuits ONLY when the scan
                    // completed cleanly. Partial (timed-out) results
                    // are used as a resume anchor via `prevPartial` on
                    // the next call — we fall through to the fetch.
                    if (cached && !cached.timedOut) {
                        console.info("[QA Assistant] Cache hit (complete) for", cacheKey, "rows =", cached.rows.length);
                        updateReopenedWarn(cached);
                        if (cached.rows.length) openReopenedModal(cached.rows, cached);
                        else toast("No reopened issues on current board");
                        return;
                    }
                    if (cached && cached.timedOut) {
                        console.info("[QA Assistant] Cache hit (partial) — resuming scan from",
                            (cached.scannedIds || []).length, "/", (cached.allCandidates || []).length);
                    }
                    // Loading UI — disable the button, add the spinning-
                    // icon `qa-loading` class, and swap the label until
                    // we have a result to show. All restored in `finally`.
                    const originalLabel = reopenedBtnLabel ? reopenedBtnLabel.textContent : "";
                    reopenedBtn.disabled = true;
                    reopenedBtn.classList.add("qa-loading");
                    if (reopenedBtnLabel) reopenedBtnLabel.textContent = cached && cached.timedOut ? "Resuming…" : "Loading…";
                    try {
                        // Direct filter for currently-at-status-8 (Phase A)
                        // + journal scan for historical hits (Phase B).
                        // No pre-flight bulk_edit lookup — Redmine's
                        // workflow-gated dropdown made that unreliable.
                        // When `cached` exists and is a timed-out
                        // partial, pass it as `prevPartial` so the
                        // scan picks up from the last checkpoint.
                        const result = await fetchReopenedIssues({
                            projectSlug: scope.projectSlug,
                            versionId: scope.versionId,
                            statusRegex: REOPEN_STATUS_REGEX,
                            statusId: REOPEN_STATUS_ID,
                            prevPartial: (cached && cached.timedOut) ? cached : null,
                            onProgress: (done, total) => {
                                if (!reopenedBtnLabel) return;
                                if (total > 0) {
                                    reopenedBtnLabel.textContent = "Scanning " + done + " of " + total + "…";
                                } else {
                                    reopenedBtnLabel.textContent = "Loading…";
                                }
                            }
                        });
                        reopenedCache.set(cacheKey, result);
                        updateReopenedWarn(result);
                        if (!result.rows.length) {
                            toast("No reopened issues on current board");
                        } else {
                            openReopenedModal(result.rows, result);
                        }
                    } catch (err) {
                        console.error("[QA Assistant] Reopened issues failed:", err);
                        toast("Couldn't load reopened issues: " + (err && err.message ? err.message : "unknown error"));
                    } finally {
                        reopenedBtn.disabled = false;
                        reopenedBtn.classList.remove("qa-loading");
                        if (reopenedBtnLabel) reopenedBtnLabel.textContent = originalLabel || "Get Reopened Issues";
                    }
                });
            } else {
                console.warn("[QA Assistant] Reopened button not found (#qa-show-reopened)");
            }

            // ---- Sprint audit (Agile board) ----
            const auditWrap       = panel.querySelector("#qa-audit-wrap");
            const auditBtn        = panel.querySelector("#qa-show-audit");
            const auditBtnLbl     = panel.querySelector("#qa-show-audit-label");
            const auditBtnIcon    = auditBtn && auditBtn.querySelector(".qa-btn-icon");
            const auditModal      = panel.querySelector("#qa-audit-modal");
            const auditReport     = auditModal && auditModal.querySelector("#qa-audit-report");
            const auditLoading    = auditModal && auditModal.querySelector("#qa-audit-loading");
            const auditLoadTxt    = auditModal && auditModal.querySelector("#qa-audit-loading-text");
            const auditCopy       = auditModal && auditModal.querySelector("#qa-audit-copy");
            const auditCopyPlain  = auditModal && auditModal.querySelector("#qa-audit-copy-plain");
            const auditRefreshBtn = auditModal && auditModal.querySelector("#qa-audit-refresh");
            const auditToggle     = auditModal && auditModal.querySelector("#qa-audit-show-assignees");
            const auditToggleWrap = auditModal && auditModal.querySelector("#qa-audit-toggle-wrap");

            // Detach so it can cover the whole viewport (same trick as bulk / reopened).
            if (auditModal) document.body.appendChild(auditModal);

            let auditLastResult  = null;
            let auditLastVersion = "";
            let auditRunning     = false;

            // Per-board cache so re-clicking on the same sprint returns instantly
            // when the previous scan finished cleanly. Partial results aren't
            // cached — the next click restarts the scan.
            const auditCache = new Map();
            const auditCacheKey = (s) => (s && s.projectSlug || "") + "|" + (s && s.versionId || "");
            window.addEventListener("popstate",   () => auditCache.clear());
            window.addEventListener("hashchange", () => auditCache.clear());

            function closeAuditModal() {
                if (!auditModal) return;
                auditModal.classList.remove("qa-modal-open");
                setTimeout(() => { auditModal.hidden = true; }, 180);
            }

            // Prepare and reveal the audit modal. Called only once the scan
            // has finished (clean or partial) — the "no modal until we have
            // data" pattern mirrors the Reopened-issues flow.
            function openAuditModal() {
                if (!auditModal) return;
                auditModal.className = "qa-modal-overlay";
                if (panel.classList.contains("qa-dark")) auditModal.classList.add("qa-dark");
                Array.from(panel.classList).forEach(c => {
                    if (c.indexOf("qa-accent-") === 0) auditModal.classList.add(c);
                });
                if (auditReport)     { auditReport.hidden = true; auditReport.innerHTML = ""; }
                if (auditLoading)    auditLoading.hidden = true;
                if (auditCopy)       { auditCopy.hidden = true; auditCopy.disabled = true; }
                if (auditCopyPlain)  { auditCopyPlain.hidden = true; auditCopyPlain.disabled = true; }
                if (auditToggleWrap) auditToggleWrap.hidden = true;
                if (auditToggle)     auditToggle.checked = false;
                auditModal.hidden = false;
                requestAnimationFrame(() => auditModal.classList.add("qa-modal-open"));
            }

            function renderAuditReport() {
                if (!auditReport || !auditLastResult) return;
                const a = auditLastResult;
                const showA = !!(auditToggle && auditToggle.checked);
                const esc = (s) => String(s || "")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
                // Truncates long id lists to `cap` and appends a "see all N"
                // button; full markup is stashed in `seeMoreStore` and swapped
                // in by the delegated click handler below.
                const seeMoreStore = {};
                let seeMoreCounter = 0;
                const linkify = (arr) => arr.map(r =>
                    '<a href="/issues/' + r.id + '" target="_blank" rel="noopener">#' + r.id + '</a>'
                ).join(', ');
                const idLinks = (rows, cap) => {
                    if (rows.length <= cap) return linkify(rows);
                    const gid = "g" + (seeMoreCounter++);
                    seeMoreStore[gid] = linkify(rows);
                    return linkify(rows.slice(0, cap)) +
                        ', <button type="button" class="qa-audit-see-more" data-group="' + gid + '">see all ' + rows.length + '</button>';
                };

                let html = '';
                if (a.partial) {
                    html += '<div class="qa-audit-partial-banner" role="alert">';
                    html += '<strong>⚠ Partial results.</strong> The journal scan hit its 4-minute cap before every ticket was checked, so <em>Reopens</em> and <em>Churn</em> counts below may undercount. ';
                    html += 'Next steps: click <strong>Audit this sprint</strong> again to resume from where it stopped, or narrow the board (e.g. by tracker or assignee) before re-auditing.';
                    html += '</div>';
                }
                const nB = a.verdict.blockers.length;
                const nW = a.verdict.warnings.length;
                const shippable = nB === 0;
                html += '<section class="qa-audit-section qa-audit-verdict">';
                html += '<h3>Verdict</h3>';
                html += '<p class="qa-audit-verdict-line qa-audit-verdict-' + (shippable ? 'yes' : 'no') + '">';
                html += 'Ready to ship: <strong>' + (shippable ? 'YES' : 'NO') + '</strong> — ';
                html += nB + ' blocker' + (nB === 1 ? '' : 's') + ', ';
                html += nW + ' warning' + (nW === 1 ? '' : 's') + '.';
                html += '</p>';
                if (nB || nW) {
                    html += '<ul class="qa-audit-verdict-list">';
                    a.verdict.blockers.forEach(b => {
                        html += '<li class="qa-audit-blocker">❌ ' + esc(b.label);
                        if (b.rows.length) html += ' <span class="qa-audit-ids">' + idLinks(b.rows, 8) + '</span>';
                        html += '</li>';
                    });
                    a.verdict.warnings.forEach(w => {
                        html += '<li class="qa-audit-warning">⚠ ' + esc(w.label);
                        if (w.rows.length) html += ' <span class="qa-audit-ids">' + idLinks(w.rows, 8) + '</span>';
                        html += '</li>';
                    });
                    html += '</ul>';
                }
                html += '</section>';

                html += '<section class="qa-audit-section"><h3>Overview</h3>';
                html += '<p>Total: <strong>' + a.overview.total + '</strong> · ';
                html += 'Closed: <strong>' + a.overview.closed + '</strong> (' + a.overview.closedPct + '%) · ';
                html += 'Open: <strong>' + a.overview.open + '</strong></p>';
                html += '</section>';

                if (a.byTracker.length) {
                    html += '<section class="qa-audit-section"><h3>Volume by tracker</h3>';
                    html += '<table class="qa-audit-table"><thead><tr><th>Tracker</th><th>Total</th><th>Closed</th><th>Open</th></tr></thead><tbody>';
                    a.byTracker.forEach(b => {
                        html += '<tr><td>' + esc(b.name) + '</td><td>' + b.total + '</td><td>' + b.closed + '</td><td>' + b.open + '</td></tr>';
                    });
                    html += '</tbody></table></section>';
                }

                if (a.untriaged.length) {
                    html += '<section class="qa-audit-section"><h3>Untriaged: ' + a.untriaged.length + ' ticket' + (a.untriaged.length === 1 ? '' : 's') + '</h3>';
                    html += '<ul class="qa-audit-list">';
                    a.untriaged.forEach(u => {
                        html += '<li><a href="/issues/' + u.id + '" target="_blank" rel="noopener">#' + u.id + '</a> · ' + esc(u.subject || '(no subject)') + '</li>';
                    });
                    html += '</ul></section>';
                }

                if (a.feedback.count) {
                    html += '<section class="qa-audit-section"><h3>Churn (Feedback bounces): ' + a.feedback.count + ' ticket' + (a.feedback.count === 1 ? '' : 's') + ' · ' + a.feedback.pct + '%';
                    if (a.feedback.timedOut) html += ' <span class="qa-audit-partial">(partial)</span>';
                    html += '</h3><ul class="qa-audit-list">';
                    a.feedback.rows.forEach(r => {
                        html += '<li><a href="/issues/' + r.id + '" target="_blank" rel="noopener">#' + r.id + '</a> · ' + esc(r.subject || '(no subject)') + '</li>';
                    });
                    html += '</ul></section>';
                }

                if (a.reopens.count) {
                    html += '<section class="qa-audit-section"><h3>Reopens: ' + a.reopens.count + ' ticket' + (a.reopens.count === 1 ? '' : 's') + ' · ' + a.reopens.pct + '% (' + a.reopens.count + ' / ' + a.reopens.closedTotal + ' closed)';
                    if (a.reopens.timedOut) html += ' <span class="qa-audit-partial">(partial)</span>';
                    html += '</h3><ul class="qa-audit-list">';
                    a.reopens.rows.forEach(r => {
                        html += '<li><a href="/issues/' + r.id + '" target="_blank" rel="noopener">#' + r.id + '</a> · ' + esc(r.subject || '(no subject)') + '</li>';
                    });
                    html += '</ul></section>';
                }

                if (showA && a.assignees.reportedBy.length) {
                    html += '<section class="qa-audit-section"><h3>Reported By <span class="qa-audit-subtle">(Bugs + Suggestions per QA member)</span></h3>';
                    html += '<table class="qa-audit-table"><thead><tr><th>QA Member</th><th>Bugs</th><th>Suggestions</th><th>Total</th></tr></thead><tbody>';
                    a.assignees.reportedBy.forEach(b => {
                        html += '<tr><td>' + esc(b.name) + '</td><td>' + b.bugs + '</td><td>' + b.suggestions + '</td><td><strong>' + b.total + '</strong></td></tr>';
                    });
                    html += '</tbody></table></section>';
                }
                if (showA && a.assignees.reopensAgainst.length) {
                    html += '<section class="qa-audit-section"><h3>Reopens against</h3>';
                    html += '<p class="qa-audit-tally">' + a.assignees.reopensAgainst.map(x => esc(x.name) + ' <strong>' + x.count + '</strong>').join(' · ') + '</p>';
                    html += '</section>';
                }

                auditReport.innerHTML = html;
                auditReport._seeMoreStore = seeMoreStore;
                if (!auditReport._seeMoreWired) {
                    auditReport.addEventListener("click", (ev) => {
                        const btn = ev.target && ev.target.closest && ev.target.closest(".qa-audit-see-more");
                        if (!btn) return;
                        ev.preventDefault();
                        const gid  = btn.getAttribute("data-group");
                        const full = auditReport._seeMoreStore && auditReport._seeMoreStore[gid];
                        if (!full) return;
                        const idsSpan = btn.closest(".qa-audit-ids");
                        if (idsSpan) idsSpan.innerHTML = full;
                    });
                    auditReport._seeMoreWired = true;
                }
                auditReport.hidden = false;
                if (auditLoading) auditLoading.hidden = true;
                if (auditCopy) { auditCopy.hidden = false; auditCopy.disabled = false; }
                if (auditCopyPlain) { auditCopyPlain.hidden = false; auditCopyPlain.disabled = false; }
                if (auditToggleWrap) auditToggleWrap.hidden = false;
            }

            if (auditModal) {
                auditModal.addEventListener("click", (e) => {
                    if (e.target === auditModal) closeAuditModal();
                });
                auditModal.querySelectorAll('[data-action="audit-close"]').forEach(b =>
                    b.addEventListener("click", (e) => { e.stopPropagation(); closeAuditModal(); }));
                if (auditToggle) auditToggle.addEventListener("change", () => renderAuditReport());
                if (auditCopy) auditCopy.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!auditLastResult) return;
                    try {
                        const md = renderSprintAuditMarkdown(auditLastResult, auditLastVersion, !!(auditToggle && auditToggle.checked));
                        await navigator.clipboard.writeText(md);
                        toast("Report copied to clipboard");
                    } catch (err) {
                        console.error("[QA Assistant] Audit copy failed:", err);
                        toast("Copy failed: " + (err && err.message ? err.message : "unknown"));
                    }
                });
                if (auditCopyPlain) auditCopyPlain.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!auditLastResult) return;
                    try {
                        const txt = renderSprintAuditPlain(auditLastResult, auditLastVersion, !!(auditToggle && auditToggle.checked));
                        await navigator.clipboard.writeText(txt);
                        toast("Plain-text report copied to clipboard");
                    } catch (err) {
                        console.error("[QA Assistant] Audit plain copy failed:", err);
                        toast("Copy failed: " + (err && err.message ? err.message : "unknown"));
                    }
                });
            }

            if (auditRefreshBtn) auditRefreshBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (auditRunning) return;
                const scope = getCurrentBoardScope();
                if (!scope) { toast("Open an Agile board first."); return; }
                auditCache.delete(auditCacheKey(scope));
                // Close the modal so the header button's progress label is visible; the audit handler re-opens it with fresh data.
                closeAuditModal();
                auditBtn.click();
            });

            if (auditBtn) {
                console.info("[QA Assistant] Sprint audit button wired");
                auditBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (auditRunning) return;
                    const scope = getCurrentBoardScope();
                    if (!scope) { toast("Open an Agile board first."); return; }

                    // Version label — pulled from the board page's h2 header.
                    let versionLabel = "";
                    const boardHdr = document.querySelector("#content h2");
                    if (boardHdr) versionLabel = boardHdr.textContent.trim().replace(/\s+/g, " ");

                    // Instant return on clean cache hit — open the report right away.
                    const cacheKey = auditCacheKey(scope);
                    const cached   = auditCache.get(cacheKey);
                    if (cached && !cached.partial) {
                        console.info("[QA Assistant] Audit cache hit for", cacheKey);
                        auditLastResult  = cached;
                        auditLastVersion = versionLabel;
                        openAuditModal();
                        renderAuditReport();
                        return;
                    }

                    // Otherwise: run (or resume) the scan WITHOUT opening the
                    // modal. Progress lives on the button label, same pattern
                    // as the Reopened-issues button. Modal opens only after
                    // runSprintAudit resolves with clean or partial data.
                    auditRunning = true;
                    const isResume = !!(cached && cached.partial && cached.resumeState);
                    if (isResume) console.info("[QA Assistant] Resuming audit from partial cache");
                    const originalLabel = auditBtnLbl ? auditBtnLbl.textContent : "";
                    auditBtn.disabled = true;
                    auditBtn.classList.add("qa-loading");
                    if (auditBtnIcon) auditBtnIcon.innerHTML = svgIcon("rotate-ccw");
                    if (auditBtnLbl) auditBtnLbl.textContent = isResume ? "Resuming…" : "Auditing…";

                    try {
                        const result = await runSprintAudit({
                            projectSlug: scope.projectSlug,
                            versionId:   scope.versionId,
                            prevPartial: isResume ? cached : null,
                            onProgress: (phase, done, total) => {
                                if (!auditBtnLbl) return;
                                auditBtnLbl.textContent = total > 0
                                    ? (phase + " (" + done + "/" + total + ")")
                                    : phase;
                            }
                        });
                        auditCache.set(cacheKey, result);
                        auditLastResult  = result;
                        auditLastVersion = versionLabel;
                        openAuditModal();
                        renderAuditReport();
                    } catch (err) {
                        console.error("[QA Assistant] Sprint audit failed:", err);
                        toast("Audit failed: " + (err && err.message ? err.message : "unknown"));
                    } finally {
                        auditRunning = false;
                        auditBtn.disabled = false;
                        auditBtn.classList.remove("qa-loading");
                        if (auditBtnIcon) auditBtnIcon.innerHTML = svgIcon("check-square");
                        if (auditBtnLbl) auditBtnLbl.textContent = originalLabel || "Audit this sprint";
                    }
                });
            }

            // Only reveal on Agile board pages — everywhere else the section
            // makes no sense (no cards to select).
            if (isAgileBoardPage()) {
                bulkWrap.hidden = false;
                if (reopenedWrap) reopenedWrap.hidden = false;
                if (auditWrap)    auditWrap.hidden = false;
            }
        }

        // Agile Boards render inline now — no collapse toggle. Board links
        // still refresh their href on mousedown so they open the last-viewed
        // board (or the current sprint) for that project.

        // Description Source is always open on Redmine (no collapse toggle).
        // The section header is a plain .qa-section-label to match the other
        // step headers, and the wrap has no `hidden` attribute so it renders
        // immediately with the mode switch + active pane visible.

        // Collapse toggle
        document.getElementById("qa-collapse").addEventListener("click", (e) => {
            e.stopPropagation();
            togglePanel(panel);
        });

        // Dock button (only visible while collapsed) -> dock to edge
        document.getElementById("qa-dock").addEventListener("click", (e) => {
            e.stopPropagation();
            setDocked(panel, true);
        });

        // Theme toggle (light / dark)
        document.getElementById("qa-theme").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleTheme(panel);
        });
        applyTheme(panel, getTheme());

        // Accent colour picker. The popover is moved out of #qa-panel into
        // document.body because the panel has both overflow:hidden and
        // backdrop-filter, which together clip even position:fixed
        // descendants (backdrop-filter promotes the panel to a containing
        // block for fixed positioning). Detaching lets the popover render
        // above everything at fixed viewport coordinates — crucial when the
        // panel is collapsed to a 44px-tall pill and the popover has to
        // appear below it.
        const accentBtn = document.getElementById("qa-accent-btn");
        const accentPopover = document.getElementById("qa-accent-popover");
        document.body.appendChild(accentPopover);

        function openAccent() {
            // Anchor popover's top-right corner to the button's bottom-right.
            const rect = accentBtn.getBoundingClientRect();
            accentPopover.style.top = (rect.bottom + 6) + "px";
            accentPopover.style.right = (window.innerWidth - rect.right) + "px";
            accentPopover.classList.add("qa-accent-open");
            accentBtn.setAttribute("aria-expanded", "true");
        }
        function closeAccent() {
            accentPopover.classList.remove("qa-accent-open");
            accentBtn.setAttribute("aria-expanded", "false");
        }
        const isAccentOpen = () => accentPopover.classList.contains("qa-accent-open");

        accentBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            isAccentOpen() ? closeAccent() : openAccent();
        });
        accentPopover.addEventListener("click", (e) => {
            const sw = e.target.closest(".qa-swatch");
            if (!sw) return;
            e.stopPropagation();
            setAccent(panel, sw.dataset.accent);
            closeAccent();
        });
        // mousedown (not click) closes on outside interaction — this also
        // handles a header drag: the popover would otherwise stay at stale
        // coordinates while the panel moves out from under it.
        document.addEventListener("mousedown", (e) => {
            if (!isAccentOpen()) return;
            if (accentPopover.contains(e.target) || accentBtn.contains(e.target)) return;
            closeAccent();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && isAccentOpen()) {
                closeAccent();
                accentBtn.focus();
            }
        });
        applyAccent(panel, getAccent());

        restorePanelState(panel);
        wireQuoteBubble(panel);
        makeDraggable(panel, document.getElementById("qa-header"));
        makeDockDraggable(panel, document.getElementById("qa-dock-face"));
        addResizeHandles(panel);
    }

    //////////////////////////////////////////////////////
    // Rocket-icon thought bubble
    //////////////////////////////////////////////////////

    // Motivational quotes shown when the user hovers the rocket icon in
    // the header. Purely decorative — a random one is picked on every
    // mouseenter so repeated hovers cycle through the set.
    const QA_QUOTES = [
        "You can do it. Maybe.",
        "Win or learn. Mostly learn.",
        "Be unstoppable. After coffee.",
        "You're not lazy. You're energy efficient.",
        "Peak performance starts tomorrow.",
        "You found one bug. There are definitely more.",
        "It passed. Suspicious.",
        "Test first. Panic later.",
        "If it isn't broken, test again.",
        "One more regression won't hurt. Probably.",
        "Every 'fixed' bug has a sequel.",
        "Today's bug is tomorrow's feature request.",
        "Every test tells a story.",
        "'Cannot reproduce.' Challenge accepted.",
        "Break it. Professionally.",
        "The bug isn't gone. It's on vacation.",
        "Edge cases are where the fun begins.",
        "Think like a user. Then think worse.",
        "Developer tested it. QA confirmed reality.",
        "Reopened. With love.",
        "Another fix. Another adventure.",
        "Validate everything.",
        "Severity: Depends who's asking.",
        "Expected: Happiness. Actual: Exception."

    ];

    function wireQuoteBubble(panel) {
        const icon   = panel.querySelector("#qa-title-icon");
        const bubble = panel.querySelector("#qa-quote-bubble");
        if (!icon || !bubble) return;
        // Reparent to <body> so the bubble escapes the panel's overflow
        // clipping (collapsed / docked states) and stays visible *outside*
        // the panel chrome. Same trick the accent popover uses.
        if (bubble.parentElement !== document.body) document.body.appendChild(bubble);

        let hideTimer = null;

        // Compute a fixed-position slot for the bubble relative to the
        // rocket icon. Tries the four sides in order (below, right, left,
        // above) and picks the first one with enough room — so a
        // collapsed panel docked to the right edge still gets a bubble on
        // its *left*, and one docked to the bottom flips *above* rather
        // than being clipped by the viewport.
        function positionBubble() {
            const r      = icon.getBoundingClientRect();
            const bw     = bubble.offsetWidth;
            const bh     = bubble.offsetHeight;
            const vw     = window.innerWidth;
            const vh     = window.innerHeight;
            const gap    = 12;   // distance between icon and bubble
            const margin = 8;    // minimum breathing room from viewport edge

            const spaceBelow = vh - r.bottom;
            const spaceRight = vw - r.right;
            const spaceLeft  = r.left;
            const spaceAbove = r.top;

            let top, left;
            if (spaceBelow >= bh + gap + margin) {
                top  = r.bottom + gap;
                left = Math.min(vw - bw - margin, Math.max(margin, r.left - 4));
            } else if (spaceRight >= bw + gap + margin) {
                left = r.right + gap;
                top  = Math.min(vh - bh - margin, Math.max(margin, r.top + r.height / 2 - bh / 2));
            } else if (spaceLeft >= bw + gap + margin) {
                left = r.left - bw - gap;
                top  = Math.min(vh - bh - margin, Math.max(margin, r.top + r.height / 2 - bh / 2));
            } else if (spaceAbove >= bh + gap + margin) {
                top  = r.top - bh - gap;
                left = Math.min(vw - bw - margin, Math.max(margin, r.left - 4));
            } else {
                // Truly cramped viewport — just clamp inside the visible
                // area so the bubble stays readable even if it overlaps
                // the icon a bit.
                top  = Math.max(margin, Math.min(vh - bh - margin, r.bottom + gap));
                left = Math.max(margin, Math.min(vw - bw - margin, r.left - 4));
            }

            // Derive the tail side from the FINAL bubble rect vs the icon
            // rect — not from the branch we took. Clamping can shove the
            // bubble sideways (e.g. panel docked right: we plan "below"
            // but the horizontal clamp lands the bubble to the *left* of
            // the icon), and the tail needs to point back at the rocket
            // regardless.
            const overlapsHoriz = left < r.right  && left + bw > r.left;
            const overlapsVert  = top  < r.bottom && top  + bh > r.top;
            let side;
            if (overlapsHoriz && !overlapsVert) {
                side = top >= r.bottom ? "below" : "above";
            } else if (overlapsVert && !overlapsHoriz) {
                side = left >= r.right ? "right" : "left";
            } else if (!overlapsHoriz && !overlapsVert) {
                // Diagonal — pick the axis with the larger separation.
                const dx = (r.left + r.width  / 2) - (left + bw / 2);
                const dy = (r.top  + r.height / 2) - (top  + bh / 2);
                if (Math.abs(dx) > Math.abs(dy)) side = dx > 0 ? "left"  : "right";
                else                             side = dy > 0 ? "above" : "below";
            } else {
                side = "below";
            }

            bubble.dataset.side = side;
            // Slide the two tail circles along the bubble's exposed edge
            // so they always sit under (or beside) the rocket, even when
            // the bubble was horizontally clamped by the viewport. CSS
            // reads --qa-tail-offset to place the circles.
            const iconCenterX = r.left + r.width  / 2;
            const iconCenterY = r.top  + r.height / 2;
            let tailOffset;
            if (side === "below" || side === "above") {
                tailOffset = Math.max(12, Math.min(bw - 12, iconCenterX - left));
            } else {
                tailOffset = Math.max(12, Math.min(bh - 12, iconCenterY - top));
            }
            bubble.style.setProperty("--qa-tail-offset", tailOffset + "px");
            bubble.style.top    = top  + "px";
            bubble.style.left   = left + "px";
        }

        const show = () => {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            // Mirror the panel's theme + accent classes onto the bubble so
            // it picks up the same tokens even though it's parented to
            // <body> and can't inherit from #qa-panel.
            bubble.className = "qa-quote-bubble";
            if (panel.classList.contains("qa-dark")) bubble.classList.add("qa-dark");
            Array.from(panel.classList).forEach(c => {
                if (c.indexOf("qa-accent-") === 0) bubble.classList.add(c);
            });
            bubble.textContent = QA_QUOTES[Math.floor(Math.random() * QA_QUOTES.length)];
            bubble.hidden = false;
            // Measure after content is set + hidden is cleared, then place
            // before we run the open transition so the bubble grows from
            // its final anchor rather than sliding across the screen.
            positionBubble();
            requestAnimationFrame(() => bubble.classList.add("qa-quote-bubble-open"));
        };
        const hide = () => {
            bubble.classList.remove("qa-quote-bubble-open");
            hideTimer = setTimeout(() => { bubble.hidden = true; hideTimer = null; }, 180);
        };
        icon.addEventListener("mouseenter", show);
        icon.addEventListener("mouseleave", hide);
        // Keep the bubble open if the user drifts onto the bubble itself
        // (feels less finicky, and lets long quotes stay readable).
        bubble.addEventListener("mouseenter", () => {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        });
        bubble.addEventListener("mouseleave", hide);
        // Reposition while visible — the panel might be dragged or the
        // window resized between hovers, and a scroll must not leave the
        // bubble stranded away from the rocket.
        window.addEventListener("scroll", () => { if (!bubble.hidden) positionBubble(); }, true);
        window.addEventListener("resize", () => { if (!bubble.hidden) positionBubble(); });
    }

    //////////////////////////////////////////////////////
    // Collapse
    //////////////////////////////////////////////////////

    function togglePanel(panel, force) {
        const collapsed = force !== undefined ? force : !panel.classList.contains("qa-collapsed");
        panel.classList.toggle("qa-collapsed", collapsed);
        const btn = document.getElementById("qa-collapse");
        if (btn) btn.innerHTML = svgIcon(collapsed ? "plus" : "minus");
        localStorage.setItem(STORAGE.collapsed, collapsed ? "1" : "0");

        if (collapsed) {
            // A collapsed bar sitting against the left/right edge becomes vertical.
            snapCollapsedEdge(panel);
        } else {
            // Expanding restores the horizontal card; keep it fully on-screen.
            panel.classList.remove("qa-collapsed-vert", "qa-collapsed-left");
            clampPanel(panel);
        }
    }

    // Keep a panel fully within the visible viewport and persist its position.
    function clampPanel(panel) {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const rect = panel.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.left, vw - panel.offsetWidth));
        const y = Math.max(0, Math.min(rect.top, vh - panel.offsetHeight));
        panel.style.left  = x + "px";
        panel.style.top   = y + "px";
        panel.style.right = "auto";
        localStorage.setItem(STORAGE.panelPos, JSON.stringify({ left: x + "px", top: y + "px" }));
    }

    // While collapsed, snap to the left/right edge and rotate to a vertical bar
    // when close to it; otherwise keep the horizontal bar at its current spot.
    function snapCollapsedEdge(panel) {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const EDGE = 16; // px proximity that counts as "at the side edge"

        const rect = panel.getBoundingClientRect();
        let x = rect.left;
        let y = rect.top;
        let maxX = vw - panel.offsetWidth;

        const nearLeft  = x <= EDGE;
        const nearRight = x >= maxX - EDGE;
        const vertical  = nearLeft || nearRight;

        panel.classList.toggle("qa-collapsed-vert", vertical);
        panel.classList.toggle("qa-collapsed-left", vertical && nearLeft);

        // Re-measure after the orientation change (forces a reflow).
        maxX = vw - panel.offsetWidth;
        const maxY = vh - panel.offsetHeight;
        if (nearLeft)       x = 0;
        else if (nearRight) x = maxX;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        panel.style.left  = x + "px";
        panel.style.top   = y + "px";
        panel.style.right = "auto";
        localStorage.setItem(STORAGE.panelPos, JSON.stringify({ left: x + "px", top: y + "px", vertical }));
    }

    //////////////////////////////////////////////////////
    // Dock to edge
    //////////////////////////////////////////////////////

    // Snap a docked pill to the nearest screen edge given its current x/y.
    // On left/right (vertical) edges the pill rotates to a vertical shape so
    // it hugs the edge; on top/bottom (horizontal) edges it stays horizontal.
    function snapDock(panel, x, y) {
        // Decide the nearest edge using the current dimensions. Use the
        // documentElement client size so the pill never slips under the
        // vertical scrollbar (innerWidth includes it, clientWidth does not).
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        let w = panel.offsetWidth || 60;
        let h = panel.offsetHeight || 44;
        let maxX = vw - w;
        let maxY = vh - h;
        const cx = Math.max(0, Math.min(x, maxX));
        const cy = Math.max(0, Math.min(y, maxY));

        // Distance to each edge; snap to the closest.
        const distLeft   = cx;
        const distRight  = maxX - cx;
        const distTop    = cy;
        const distBottom = maxY - cy;
        const min = Math.min(distLeft, distRight, distTop, distBottom);

        // Left/right edges -> vertical pill (44x60); top/bottom -> horizontal.
        const vertical = (min === distLeft || min === distRight);
        panel.classList.toggle("qa-dock-vert", vertical);

        // Re-clamp against the post-rotation dimensions.
        w = vertical ? 44 : 60;
        h = vertical ? 60 : 44;
        maxX = vw - w;
        maxY = vh - h;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        if (min === distLeft)        x = 0;
        else if (min === distRight)  x = maxX;
        else if (min === distTop)    y = 0;
        else                         y = maxY;

        panel.style.left  = x + "px";
        panel.style.top   = y + "px";
        panel.style.right = "auto";
        localStorage.setItem(STORAGE.dockPos, JSON.stringify({ left: x + "px", top: y + "px", vertical }));
    }

    function setDocked(panel, docked) {
        panel.classList.toggle("qa-docked", docked);
        localStorage.setItem(STORAGE.docked, docked ? "1" : "0");

        if (docked) {
            // Restore last dock position, or snap from current position.
            let placed = false;
            try {
                const pos = JSON.parse(localStorage.getItem(STORAGE.dockPos) || "null");
                if (pos && pos.left && pos.top) {
                    panel.classList.toggle("qa-dock-vert", !!pos.vertical);
                    panel.style.left  = pos.left;
                    panel.style.top   = pos.top;
                    panel.style.right = "auto";
                    placed = true;
                }
            } catch (e) { /* ignore */ }
            if (!placed) {
                const rect = panel.getBoundingClientRect();
                snapDock(panel, rect.left, rect.top);
            }
        } else {
            // Restore panel position and expand it.
            restorePanelPosition(panel);
            togglePanel(panel, false);
        }
    }

    //////////////////////////////////////////////////////
    // Dragging
    //////////////////////////////////////////////////////

    function makeDraggable(panel, handle) {
        let dragging = false, offsetX = 0, offsetY = 0;

        handle.addEventListener("mousedown", (e) => {
            if (e.target.closest(".qa-hbtn")) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel.classList.add("qa-dragging");
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!dragging) return;
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;
            const maxX = document.documentElement.clientWidth - panel.offsetWidth;
            const maxY = document.documentElement.clientHeight - panel.offsetHeight;
            x = Math.max(0, Math.min(x, maxX));
            y = Math.max(0, Math.min(y, maxY));
            panel.style.left = x + "px";
            panel.style.top = y + "px";
            panel.style.right = "auto";
        });

        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove("qa-dragging");
            if (panel.classList.contains("qa-collapsed")) {
                // Re-evaluate side-edge orientation for the collapsed bar.
                snapCollapsedEdge(panel);
            } else {
                localStorage.setItem(STORAGE.panelPos, JSON.stringify({
                    left: panel.style.left,
                    top: panel.style.top
                }));
            }
        });
    }

    // Drag the docked square; snap to nearest edge on release. A click without
    // meaningful movement restores the panel to its expanded state.
    function makeDockDraggable(panel, face) {
        let dragging = false, moved = false, offsetX = 0, offsetY = 0, startX = 0, startY = 0;

        face.addEventListener("mousedown", (e) => {
            dragging = true;
            moved = false;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            startX = e.clientX;
            startY = e.clientY;
            panel.classList.add("qa-dragging");
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener("mousemove", (e) => {
            if (!dragging) return;
            if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) moved = true;
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            x = Math.max(0, Math.min(x, maxX));
            y = Math.max(0, Math.min(y, maxY));
            panel.style.left  = x + "px";
            panel.style.top   = y + "px";
            panel.style.right = "auto";
        });

        document.addEventListener("mouseup", (e) => {
            if (!dragging) return;
            dragging = false;
            panel.classList.remove("qa-dragging");
            if (moved) {
                snapDock(panel, e.clientX - offsetX, e.clientY - offsetY);
            } else {
                // Treated as a click -> restore the panel.
                setDocked(panel, false);
            }
        });
    }

    function restorePanelPosition(panel) {
        try {
            const pos = JSON.parse(localStorage.getItem(STORAGE.panelPos) || "null");
            if (pos && pos.left && pos.top) {
                panel.style.left  = pos.left;
                panel.style.top   = pos.top;
                panel.style.right = "auto";
                return;
            }
        } catch (e) { /* ignore */ }
        // Fall back to the default anchored position.
        panel.style.left  = "auto";
        panel.style.right = "20px";
        panel.style.top   = "180px";
    }

    // Persist the user-chosen panel size (set by dragging the resize corner).
    // Only meaningful while expanded; collapsed/docked sizes are fixed by CSS.
    function savePanelSize(panel) {
        if (panel.classList.contains("qa-collapsed") || panel.classList.contains("qa-docked")) return;
        localStorage.setItem(STORAGE.panelSize, JSON.stringify({
            width:  panel.offsetWidth + "px",
            height: panel.offsetHeight + "px"
        }));
    }

    // Reapply a previously saved panel size to the expanded card.
    function restorePanelSize(panel) {
        try {
            const size = JSON.parse(localStorage.getItem(STORAGE.panelSize) || "null");
            if (size && size.width && size.height) {
                panel.style.width  = size.width;
                panel.style.height = size.height;
            }
        } catch (e) { /* ignore */ }
    }

    function restorePanelState(panel) {
        restorePanelPosition(panel);
        restorePanelSize(panel);

        if (localStorage.getItem(STORAGE.collapsed) === "1") {
            togglePanel(panel, true);
        }
        if (localStorage.getItem(STORAGE.docked) === "1") {
            setDocked(panel, true);
        }
    }

    // Add drag handles to every edge and corner so the expanded panel can be
    // resized from any side. Each handle adjusts width/height (and left/top for
    // the west/north sides) within the min/max bounds.
    function addResizeHandles(panel) {
        const dirs = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
        dirs.forEach((dir) => {
            const h = document.createElement("div");
            h.className = "qa-rz qa-rz-" + dir;
            panel.appendChild(h);
            makeResizable(panel, h, dir);
        });
    }

    function makeResizable(panel, handle, dir) {
        const MIN_W = 260, MIN_H = 180;

        handle.addEventListener("mousedown", (e) => {
            // Don't resize while collapsed or docked.
            if (panel.classList.contains("qa-collapsed") || panel.classList.contains("qa-docked")) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX, startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            const startW = rect.width,  startH = rect.height;
            const startLeft = rect.left, startTop = rect.top;
            const rightEdge = rect.left + rect.width;
            const bottomEdge = rect.top + rect.height;
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            const maxW = Math.round(vw * 0.96);
            const maxH = Math.round(vh * 0.96);
            const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

            // Lock to left/top positioning so west/north edges can move the panel.
            panel.style.left  = startLeft + "px";
            panel.style.top   = startTop + "px";
            panel.style.right = "auto";
            panel.classList.add("qa-resizing");

            function onMove(ev) {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                let w = startW, h = startH, left = startLeft, top = startTop;

                if (dir.indexOf("e") !== -1) {
                    w = clamp(startW + dx, MIN_W, Math.min(maxW, vw - startLeft));
                }
                if (dir.indexOf("w") !== -1) {
                    w = clamp(startW - dx, MIN_W, Math.min(maxW, rightEdge));
                    left = rightEdge - w;
                }
                if (dir.indexOf("s") !== -1) {
                    h = clamp(startH + dy, MIN_H, Math.min(maxH, vh - startTop));
                }
                if (dir.indexOf("n") !== -1) {
                    h = clamp(startH - dy, MIN_H, Math.min(maxH, bottomEdge));
                    top = bottomEdge - h;
                }

                panel.style.width  = w + "px";
                panel.style.height = h + "px";
                panel.style.left   = left + "px";
                panel.style.top    = top + "px";
            }

            function onUp() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                panel.classList.remove("qa-resizing");
                savePanelSize(panel);
                localStorage.setItem(STORAGE.panelPos, JSON.stringify({
                    left: panel.style.left,
                    top:  panel.style.top
                }));
            }

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    //////////////////////////////////////////////////////
    // Keyboard Shortcuts (OS-independent via e.code)
    //   Alt+1..4       -> switch project
    //   Alt+Shift+1..4 -> open that project's agile board
    //   Alt+F    -> fill template
    //   Alt+C    -> copy description
    //   Alt+X    -> clear form
    //   Alt+Q    -> collapse/expand panel
    // Uses physical key codes (KeyF, Digit1, ...) so the macOS Option key,
    // which rewrites e.key into special characters, still works.
    //////////////////////////////////////////////////////

    function initShortcuts() {
        document.addEventListener("keydown", (e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey) return;

            const code = e.code; // physical key, layout/OS independent

            // Digit -> switch project; with Shift -> open that project's board.
            const digitMatch = code.match(/^(?:Digit|Numpad)([1-9])$/);
            if (digitMatch) {
                const idx = parseInt(digitMatch[1], 10);
                if (idx >= 1 && idx <= PROJECT_ORDER.length) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        gotoBoard(PROJECT_ORDER[idx - 1]);
                    } else {
                        gotoProject(PROJECT_ORDER[idx - 1]);
                    }
                }
                return;
            }

            switch (code) {
                case "KeyF":
                    e.preventDefault();
                    fillIssue(sessionStorage.getItem(STORAGE.project));
                    toast("Template filled");
                    break;
                case "KeyC":
                    e.preventDefault();
                    copyDescription();
                    break;
                case "KeyX":
                    e.preventDefault();
                    clearForm();
                    break;
                case "KeyQ": {
                    e.preventDefault();
                    const panel = document.getElementById("qa-panel");
                    if (panel) togglePanel(panel);
                    break;
                }
            }
        });
    }

    //////////////////////////////////////////////////////
    // Style
    //////////////////////////////////////////////////////

    const style = document.createElement("style");
    style.textContent = `
#qa-panel{
    /* -------- Typography -------- */
    --qa-font: "Inter", "SF Pro Text", "SF Pro", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
    --qa-font-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "Liberation Mono", monospace;

    /* -------- Design tokens --------
       Colours / shadows / gradient live here as CSS custom properties so dark
       mode can override tokens (#qa-panel.qa-dark) instead of duplicating
       every rule. Changing the brand blue = edit one line. */
    --qa-brand:            #1976d2;
    --qa-brand-hover:      #1565c0;
    --qa-brand-strong:     #0d47a1;
    --qa-brand-tint:       #eef4fb;
    --qa-brand-active-bg:  #e7f0fb;
    --qa-brand-focus-ring: rgba(25,118,210,.15);

    --qa-accent:           #7b3fe4;
    --qa-accent-hover:     #6a2fd0;
    --qa-accent-bg:        #f0eefe;
    --qa-accent-text:      #3a2a6b;
    --qa-accent-focus-ring:rgba(123,63,228,.15);

    --qa-danger:           #e53935;
    --qa-danger-bg:        #fde8e8;
    --qa-danger-text:      #b12020;
    --qa-ok:               #2e7d32;

    --qa-text:             #1f2933;
    --qa-text-soft:        #5b6070;
    --qa-muted:            #8a94a6;
    --qa-on-brand:         #ffffff;

    --qa-surface:          rgba(255,255,255,.94);
    --qa-surface-2:        #f7f9fb;
    --qa-surface-3:        #fbfcfd;
    --qa-surface-inset:    #eef1f4;
    /* Very subtle darker tint used to "lift" grouped blocks (Description
       Source wrap, AI review) off the panel body. Kept translucent so it
       stacks nicely on the frosted-glass surface. */
    --qa-surface-elevated: rgba(0,0,0,.025);

    --qa-border:           #e4e7eb;
    --qa-border-strong:    #dfe3e8;
    --qa-divider:          #eceff3;

    --qa-shadow:           0 10px 30px rgba(0,0,0,.18);
    --qa-shadow-lg:        0 14px 40px rgba(0,0,0,.30);
    --qa-shadow-btn:       0 1px 2px rgba(0,0,0,.06);
    --qa-shadow-btn-hover: 0 2px 6px rgba(0,0,0,.06);

    /* Header gradient. Left stop is a fixed slate; right stop is derived
       from --qa-brand via color-mix so switching accent themes auto-tints
       the header without any per-theme override. */
    --qa-header-bg:        linear-gradient(135deg, rgba(44,62,80,.88), color-mix(in srgb, var(--qa-brand) 88%, transparent));

    --qa-kbd-bg:           rgba(0,0,0,.08);
    --qa-kbd-bg-inverse:   rgba(255,255,255,.25);

    --qa-scroll-thumb:       #c9d1d9;
    --qa-scroll-thumb-hover: #9aa5b1;

    /* Radius scale — use these instead of raw pixel values so every rounded
       element hits one of three consistent stops. sm = chips/kbd, md = cards
       and buttons, lg = the outer panel. */
    --qa-r-sm: 6px;
    --qa-r-md: 8px;
    --qa-r-lg: 12px;

    position:fixed;
    right:20px;
    top:180px;
    width:260px;
    background:var(--qa-surface);
    border:1px solid var(--qa-border-strong);
    border-radius:var(--qa-r-lg);
    overflow:hidden;
    box-shadow:var(--qa-shadow);
    /* Frosted-glass panel: the whole card is slightly translucent and the
       backdrop is blurred + saturated so the Redmine content behind shows
       through as a soft mica-like tint. Body content stays highly legible
       because the surface token is 94% opaque. */
    backdrop-filter:blur(24px) saturate(160%);
    -webkit-backdrop-filter:blur(24px) saturate(160%);
    z-index:2147483647;
    font-family:var(--qa-font);
    font-size:13px;
    color:var(--qa-text);
    user-select:none;
    -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
    text-rendering:optimizeLegibility;
    font-feature-settings:"cv11","ss01","ss03","kern";
    font-variant-numeric:tabular-nums;
    letter-spacing:-0.005em;
    /* User-resizable when expanded via the .qa-rz handles on every edge and
       corner. The current size is the minimum; it can grow up to nearly the
       full viewport. */
    display:flex;
    flex-direction:column;
    min-width:300px;
    min-height:180px;
    max-width:96vw;
    max-height:96vh;
    /* Small fade + rise when the panel first mounts so it doesn't just pop
       into place. See @keyframes qa-panel-in below. */
    animation:qa-panel-in .18s ease-out both;
}

/* Launcher mode (dev.cloudapper.com / any non-Redmine host). Without the
   Actions + Description Source sections the panel is shorter overall, and
   the tight 180px minimum used to cut off the body before the version
   footer at the bottom was visible. Raise the expanded-only minimum so the
   whole launcher — trackers, projects, boards, version tag — fits without
   scrolling on first paint. Overridden to 0 by the .qa-collapsed / .qa-docked
   rules further down, so this only applies while expanded. */
#qa-panel.qa-launcher{
    min-height:440px;
}

/* Redmine expanded panel: body scrolls so no minimum height is imposed.
   Users can resize freely via the corner/edge handles.
   Capped by max-height:96vh on the base rule so it doesn't overflow small
   viewports. Overridden to 0 by .qa-collapsed / .qa-docked below. */

/* Panel entry animation. Runs once on first mount. Skipped for users who
   prefer reduced motion so it doesn't feel like an unnecessary distraction. */
@keyframes qa-panel-in{
    from{ opacity:0; transform:translateY(6px); }
    to  { opacity:1; transform:translateY(0); }
}
@media (prefers-reduced-motion: reduce){
    #qa-panel{ animation:none; }
}
/* Force the modern font on every descendant \u2014 including form controls, which
   don't inherit font-family by default \u2014 and defeat any Redmine host styles. */
#qa-panel,
#qa-panel *:not(.qa-template-input):not(pre):not(code):not(kbd){
    font-family:var(--qa-font) !important;
}
#qa-panel .qa-template-input,
#qa-panel pre,
#qa-panel code{
    font-family:var(--qa-font-mono) !important;
}
#qa-panel kbd{
    font-family:var(--qa-font-mono) !important;
}
/* Defeat Redmine's own 'a { color: blue }' rule leaking into the panel.
   The project cards (.qa-project-card) and board buttons (.qa-board-btn)
   are <a> tags; their own 'color: var(--qa-text)' has specificity (0,1,0)
   which loses to the host page's link colour. Prefixing with #qa-panel
   bumps specificity to (1,0,1) and normalises every anchor's label to the
   theme's text colour. Icons inside (.qa-*-emoji) still read --qa-brand
   so they follow the accent. */
#qa-panel a{
    color:var(--qa-text);
}
#qa-panel.qa-dragging{
    box-shadow:var(--qa-shadow-lg);
    opacity:.97;
}
#qa-panel.qa-resizing{
    box-shadow:var(--qa-shadow-lg);
}

/* Resize handles on every edge and corner of the expanded panel. */
.qa-rz{ position:absolute; z-index:5; }
.qa-rz-n{ top:0; left:0; right:0; height:6px; cursor:ns-resize; }
.qa-rz-s{ bottom:0; left:0; right:0; height:6px; cursor:ns-resize; }
.qa-rz-e{ top:0; bottom:0; right:0; width:6px; cursor:ew-resize; }
.qa-rz-w{ top:0; bottom:0; left:0; width:6px; cursor:ew-resize; }
.qa-rz-ne{ top:0; right:0; width:14px; height:14px; cursor:nesw-resize; z-index:6; }
.qa-rz-nw{ top:0; left:0; width:14px; height:14px; cursor:nwse-resize; z-index:6; }
.qa-rz-se{ bottom:0; right:0; width:14px; height:14px; cursor:nwse-resize; z-index:6; }
.qa-rz-sw{ bottom:0; left:0; width:14px; height:14px; cursor:nesw-resize; z-index:6; }
/* Handles only apply to the expanded card. */
#qa-panel.qa-collapsed .qa-rz,
#qa-panel.qa-docked .qa-rz{ display:none; }

.qa-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    background:var(--qa-header-bg);
    color:var(--qa-on-brand);
    padding:10px 12px;
    cursor:move;
    /* Subtle top highlight sells the "glass" — a 1px specular line at the
       very top of the header, like Big Sur / Windows 11 title bars. */
    box-shadow:inset 0 1px 0 rgba(255,255,255,.14);
}
.qa-title{
    display:inline-flex;
    align-items:center;
    gap:6px;
    font-weight:600;
    letter-spacing:.2px;
}
.qa-header-btns{
    /* Toolbar-style capsule: individual buttons are transparent and share a
       common translucent shell, giving the same grouped look as Chrome's
       toolbar controls or Arc's window chrome. */
    display:flex;
    gap:0;
    align-items:center;
    padding:2px;
    background:rgba(255,255,255,.14);
    border-radius:var(--qa-r-md);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);
}
.qa-hbtn{
    width:24px;
    height:24px;
    border:none;
    border-radius:var(--qa-r-sm);
    background:transparent;
    color:var(--qa-on-brand);
    font-size:13px;
    line-height:1;
    cursor:pointer;
    transition:background .15s ease,transform .1s ease,box-shadow .15s ease;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:0;
    position:relative;
}
.qa-hbtn:hover{ background:rgba(255,255,255,.22); }
.qa-hbtn:active{ transform:scale(.92); }
/* Hairline dividers between capsule buttons — rendered as a tiny
   pseudo-element on every button after the first. Uses the flow direction
   of .qa-header-btns so it flips to horizontal in vertical (docked) mode. */
.qa-hbtn + .qa-hbtn::before{
    content:"";
    position:absolute;
    left:-1px;
    top:20%;
    bottom:20%;
    width:1px;
    background:rgba(255,255,255,.16);
    pointer-events:none;
}
#qa-panel.qa-collapsed-vert .qa-hbtn + .qa-hbtn::before{
    left:20%;
    right:20%;
    top:-1px;
    bottom:auto;
    width:auto;
    height:1px;
}
.qa-hbtn svg{
    width:14px;
    height:14px;
    stroke:currentColor;
    fill:none;
    stroke-width:2;
    stroke-linecap:round;
    stroke-linejoin:round;
}
.qa-collapse{ font-size:16px; }

/* ---------- Accent colour picker ----------
   Popover is appended to document.body (not inside #qa-panel) so it can
   escape the panel's overflow:hidden. It uses position:fixed with top /
   right set inline by JS from the palette button's bounding rect. This
   works whether the panel is expanded (popover renders inside the body
   area anyway) or collapsed to a 44 px pill (popover renders below the
   panel over the page content). Each .qa-swatch is a filled circle with
   a hard-coded background so users see all four colours at once,
   independent of the currently active accent.

   TOKEN SCOPE: because the popover is *not* inside #qa-panel, it can't
   inherit the panel's CSS custom properties. We redefine the tokens it
   needs (surface, border, brand, radius, shadow) directly on
   .qa-accent-popover. JS mirrors the panel's 'qa-dark' and
   'qa-accent-*' classes onto the popover so its own override blocks
   below kick in — dark mode and accent switches both cascade correctly. */
.qa-accent-popover{
    --qa-surface:       rgba(255,255,255,.94);
    --qa-border-strong: #dfe3e8;
    --qa-shadow:        0 10px 30px rgba(0,0,0,.18);
    --qa-r-md:          8px;
    --qa-brand:         #1976d2;

    position:fixed;
    display:none;
    align-items:center;
    gap:8px;
    padding:8px 10px;
    background:var(--qa-surface);
    border:1px solid var(--qa-border-strong);
    border-radius:var(--qa-r-md);
    box-shadow:var(--qa-shadow);
    z-index:2147483647;
    backdrop-filter:blur(24px) saturate(160%);
    -webkit-backdrop-filter:blur(24px) saturate(160%);
    animation:qa-accent-pop-in .14s ease-out both;
}
.qa-accent-popover.qa-accent-open{ display:flex; }

/* Dark-mode surface + border for the popover (mirrors the tokens in
   #qa-panel.qa-dark). */
.qa-accent-popover.qa-dark{
    --qa-surface:       rgba(31,41,51,.92);
    --qa-border-strong: #3a4553;
}

/* Accent overrides for the popover — only --qa-brand needs syncing here,
   because that's the token the swatch :focus-visible ring reads. All the
   swatch fill colours are hard-coded (.qa-swatch-blue etc.) so they don't
   depend on the active accent. */
.qa-accent-popover.qa-accent-lavender{ --qa-brand:#7b3fe4; }
.qa-accent-popover.qa-accent-orange  { --qa-brand:#e67e22; }
.qa-accent-popover.qa-accent-red     { --qa-brand:#e57373; }
.qa-accent-popover.qa-dark.qa-accent-lavender{ --qa-brand:#b79cff; }
.qa-accent-popover.qa-dark.qa-accent-orange  { --qa-brand:#ffb066; }
.qa-accent-popover.qa-dark.qa-accent-red     { --qa-brand:#ff9d9d; }
@keyframes qa-accent-pop-in{
    from{ opacity:0; transform:translateY(-4px); }
    to  { opacity:1; transform:translateY(0); }
}
@media (prefers-reduced-motion: reduce){
    .qa-accent-popover{ animation:none; }
}
.qa-swatch{
    width:20px;
    height:20px;
    border-radius:50%;
    border:1px solid rgba(0,0,0,.12);
    padding:0;
    cursor:pointer;
    transition:transform .12s ease, box-shadow .12s ease;
    position:relative;
}
.qa-swatch:hover{ transform:scale(1.1); }
.qa-swatch:focus-visible{
    outline:none;
    box-shadow:0 0 0 2px var(--qa-surface), 0 0 0 4px var(--qa-brand);
}
.qa-swatch-active{
    box-shadow:0 0 0 2px var(--qa-surface), 0 0 0 4px currentColor;
}
/* Swatch colours are fixed literals — they don't read tokens — so a user
   can always see all four options as themselves, not filtered through the
   active theme. 'color' is set to match the fill so the active-ring uses
   currentColor. */
.qa-swatch-blue    { background:#1976d2; color:#1976d2; }
.qa-swatch-lavender{ background:#7b3fe4; color:#7b3fe4; }
.qa-swatch-orange  { background:#e67e22; color:#e67e22; }
.qa-swatch-red     { background:#e57373; color:#e57373; }

/* Dock button is available in both expanded and collapsed states so the two
   headers keep matching buttons and positions. */

/* Docked (edge-pinned) pill. */
.qa-dock-face{ display:none; }
/* Collapsed / docked states are fixed-size: cancel the resize affordance and
   the expanded-panel min/max limits so their exact dimensions apply. */
#qa-panel.qa-collapsed,
#qa-panel.qa-docked{
    resize:none;
    min-width:0 !important;
    min-height:0 !important;
    max-width:none !important;
    max-height:none !important;
}
#qa-panel.qa-docked{
    width:60px !important;
    height:44px !important;
    border:0;
    border-radius:10px;
    overflow:hidden;
    cursor:grab;
}
#qa-panel.qa-docked .qa-header,
#qa-panel.qa-docked .qa-body{ display:none; }
#qa-panel.qa-docked .qa-dock-face{
    display:flex;
    align-items:center;
    justify-content:center;
    width:100%;
    height:100%;
    background:var(--qa-header-bg);
    color:var(--qa-on-brand);
    font-weight:700;
    font-size:14px;
    letter-spacing:.5px;
    cursor:grab;
    opacity:.72;
    transition:opacity .15s ease,transform .12s ease;
    position:relative;
}
#qa-panel.qa-docked .qa-dock-face:hover{
    opacity:1;
    transform:scale(1.06);
}
#qa-panel.qa-docked .qa-dock-face::after{
    content:"⤢";
    position:absolute;
    right:3px;
    bottom:1px;
    font-size:10px;
    opacity:0;
    transition:opacity .15s ease;
}
#qa-panel.qa-docked .qa-dock-face:hover::after{ opacity:.85; }
#qa-panel.qa-docked.qa-dragging .qa-dock-face{ cursor:grabbing; }

/* On left/right edges the pill rotates to a vertical shape. */
#qa-panel.qa-docked.qa-dock-vert{
    width:44px !important;
    height:60px !important;
}
#qa-panel.qa-docked.qa-dock-vert .qa-dock-face{
    width:100%;
    height:100%;
}

.qa-body{
    padding:10px;
    flex:1 1 auto;
    min-height:0;
    overflow-y:auto;
    overflow-x:hidden;
    transition:padding .25s ease,opacity .2s ease;
    /* Custom thin scrollbar so the overflow doesn't render as a chunky
       native Windows/GTK gutter that clashes with the rounded panel. The
       track stays transparent; the thumb is a soft grey rounded pill. */
    scrollbar-width:thin;
    scrollbar-color:var(--qa-scroll-thumb) transparent;
    scrollbar-gutter:stable;
}
.qa-body::-webkit-scrollbar{ width:8px; height:8px; }
.qa-body::-webkit-scrollbar-track{ background:transparent; }
.qa-body::-webkit-scrollbar-thumb{
    background:var(--qa-scroll-thumb);
    border-radius:8px;
    border:2px solid transparent;
    background-clip:padding-box;
}
.qa-body::-webkit-scrollbar-thumb:hover{ background:var(--qa-scroll-thumb-hover); }
#qa-panel.qa-collapsed .qa-body{
    max-height:0;
    padding-top:0;
    padding-bottom:0;
    opacity:0;
    overflow:hidden;
}

/* Collapsed horizontal bar mirrors the expanded panel: same width, and the header
   keeps its default space-between layout so the title/buttons stay put. */
#qa-panel.qa-collapsed:not(.qa-collapsed-vert):not(.qa-docked){
    width:300px !important;
    height:44px !important;
}
#qa-panel.qa-collapsed .qa-header{
    height:100%;
    box-sizing:border-box;
}
/* Keep the title on a single line in both collapsed orientations. */
#qa-panel.qa-collapsed .qa-title{
    white-space:nowrap;
}

/* Collapsed bar rotated to a vertical strip when pinned to a side edge. */
#qa-panel.qa-collapsed.qa-collapsed-vert:not(.qa-docked){
    width:40px !important;
    height:370px !important;
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-header{
    flex-direction:column;
    gap:8px;
    padding:10px 6px;
    justify-content:center;
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-title{
    writing-mode:vertical-rl;
    text-orientation:upright;
    letter-spacing:.3px;
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-header-btns{
    flex-direction:column;
}

.qa-section-label{
    /* Top-level section header ("Report an Issue", "Agile Boards",
       "Step 3 · Description source", etc.). Bumped from 10 → 11 px,
       muted → text colour, and wider letter-spacing so it reads clearly
       as a *section break* instead of a light caption. Extra top margin
       gives each section visible breathing room. */
    position:relative;
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.9px;
    color:var(--qa-text);
    margin:12px 2px 8px;
    padding-left:12px;
    font-weight:700;
}
/* The very first section under the panel body doesn't need the extra top
   margin — the panel padding already provides the gap. */
.qa-body > .qa-section-label:first-child{ margin-top:2px; }

/* Small brand-coloured accent bar to the left of every section header.
   Applied to both plain labels and collapsible toggles so all section
   titles share the same visual anchor. Bumped to 4 × 14 px with a subtle
   brand gradient so it reads as a proper section marker instead of a
   thin decorative line. */
.qa-section-label::before,
.qa-section-toggle::before{
    content:"";
    position:absolute;
    left:0;
    top:50%;
    width:4px;
    height:14px;
    background:linear-gradient(180deg, var(--qa-brand), var(--qa-brand-strong, var(--qa-brand)));
    border-radius:2px;
    transform:translateY(-50%);
}

/* ---------- Report: tracker picker ---------- */
.qa-report-substep{
    display:flex;
    align-items:center;
    gap:6px;
    flex-wrap:nowrap;
    min-width:0;
    font-size:10px;
    text-transform:uppercase;
    letter-spacing:.5px;
    color:var(--qa-muted);
    font-weight:700;
    margin:8px 2px 6px;
}
.qa-report-substep[hidden]{ display:none; }
.qa-project-step{ justify-content:space-between; }
.qa-project-step > span:first-child{
    flex:1 1 auto;
    min-width:0;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
}
.qa-report-for{
    /* inline-flex + align-items:center so the .qa-tracker-emoji chip (a
       16×16 inline-flex box) centres against the label text instead of
       hanging off its baseline. gap:6px replaces the raw text space that
       used to sit between the icon and the tracker name. */
    display:inline-flex;
    align-items:center;
    gap:6px;
    flex:0 0 auto;
    max-width:60%;
    min-width:0;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    text-transform:none;
    letter-spacing:normal;
    color:var(--qa-brand);
    font-weight:600;
}
/* Ellipsis needs to apply to the text-holding child, not the flex parent,
   because a flex child ignores the parent's text-overflow. */
.qa-report-for-name{
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
}
.qa-tracker-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:6px;
    margin:2px 0 4px;
}
.qa-tracker-card{
    display:flex;
    align-items:center;
    gap:8px;
    padding:9px 9px 9px 12px;
    border:1px solid var(--qa-border);
    border-radius:var(--qa-r-md);
    background:var(--qa-surface-2);
    color:var(--qa-text);
    cursor:pointer;
    font-family:inherit;
    font-size:14px;
    line-height:1;
    text-align:left;
    transition:background .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease;
}
.qa-tracker-card:hover{ border-color:var(--qa-brand); }
/* Fixed 1px border + inset 3px accent stripe on the active card. Zero layout
   jitter (padding-left already reserves 12px for the stripe) instead of the
   previous 1→ 2px border swap + padding compensation. */
.qa-tracker-card.active{
    border-color:var(--qa-brand);
    background:var(--qa-brand-active-bg);
    color:var(--qa-brand-strong);
    font-weight:600;
    box-shadow:inset 3px 0 0 var(--qa-brand);
}
.qa-tracker-emoji{
    /* Explicit 16×16 box so the flex row centres two equally-sized children
       (icon wrapper + text label) instead of centring a text line-box
       against an SVG bounding box. Prevents the subtle vertical offset
       where the text baseline sits slightly below the icon's optical
       centre. */
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:16px;
    height:16px;
    line-height:1;
    flex-shrink:0;
    color:var(--qa-brand);
}
.qa-tracker-emoji svg{ width:16px; height:16px; display:block; }

.qa-project-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:6px;
    margin:2px 0 4px;
}
.qa-project-grid[hidden]{ display:none; }
.qa-project-card{
    /* Mirrors .qa-tracker-card metrics so the two grids look like siblings:
       same padding, font-size, line-height, gap and icon box. */
    display:flex;
    align-items:center;
    gap:8px;
    padding:9px 9px 9px 12px;
    border:1px solid var(--qa-border);
    border-radius:var(--qa-r-md);
    background:var(--qa-surface-2);
    color:var(--qa-text);
    cursor:pointer;
    font-family:inherit;
    font-size:14px;
    line-height:1;
    text-align:left;
    text-decoration:none;
    transition:background .15s ease,border-color .15s ease,color .15s ease;
}
.qa-project-card,
.qa-project-card:hover,
.qa-project-card:focus,
.qa-project-card:active,
.qa-project-card:visited{ text-decoration:none; }
.qa-project-card:hover{ border-color:var(--qa-brand); background:var(--qa-brand-tint); }
.qa-project-emoji,
.qa-board-emoji{
    /* Explicit 16×16 box mirrors .qa-tracker-emoji so the flex row centres
       two equally-sized children (icon wrapper + text label). */
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:16px;
    height:16px;
    line-height:1;
    flex-shrink:0;
    color:var(--qa-brand);
}
/* Project cards use the full 16px icon to match tracker cards. The compact
   Redmine board row keeps a smaller 14px icon since it also drops the
   " Board" suffix and ⇧N chip to fit four buttons in one line. */
.qa-project-emoji svg{ width:16px; height:16px; display:block; }
.qa-board-emoji{ width:14px; height:14px; }
.qa-board-emoji svg{ width:14px; height:14px; display:block; }

/* Board button label wrapper (used in both stacked launcher layout and the
   Redmine row layout). Keeps the icon + name + suffix on one line with a
   consistent gap; row-mode adds ellipsis + tighter spacing further down. */
.qa-board-label{
    display:inline-flex;
    align-items:center;
    gap:6px;
}

/* Icon wrappers used by inline buttons (mode toggle, template action row,
   AI panel buttons, error bubbles). Sizes the SVG and lets it inherit the
   button's text colour so hover / focus states just work. line-height:1 on
   the wrapper keeps the icon vertically centred against its sibling text
   node regardless of the parent's line-height. */
.qa-mode-icon,
.qa-btn-icon,
.qa-title-icon{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    flex-shrink:0;
    line-height:1;
    vertical-align:middle;
}
.qa-mode-icon svg,
.qa-btn-icon svg{
    width:14px;
    height:14px;
    display:block;
}
.qa-title-icon{
    /* White rocket so it reads clearly on the brand-tinted header (blue at
       #1976d2 in light theme). Using --qa-on-brand keeps it in sync with
       the header text colour if the brand palette ever changes. */
    color:var(--qa-on-brand);
    margin-right:2px;
}
.qa-title-icon svg{
    width:16px;
    height:16px;
    display:block;
}
/* Rocket becomes interactive as the hover target for the thought bubble. */
.qa-title-icon{
    cursor:help;
    transition:transform .18s ease;
}
.qa-title-icon:hover{ transform:translateY(-2px) rotate(-8deg); }

/* Comic-style thought bubble that pops out under the rocket with a random
   motivational quote. Rendered on <body> with position:fixed so it stays
   visible outside the panel chrome even when collapsed or docked. Two
   stacked ::before / ::after circles form the tail so it reads as a
   "thought" rather than a speech balloon. */
.qa-quote-bubble{
    /* Fallback tokens for when the bubble sits on <body> and can't inherit
       from #qa-panel. Overridden by .qa-dark below. */
    --qa-surface:       #ffffff;
    --qa-text:          #1f2937;
    --qa-border:        #dfe3e8;

    position:fixed;
    top:0;
    left:0;
    max-width:240px;
    padding:8px 12px;
    background:var(--qa-surface);
    color:var(--qa-text);
    border:1px solid var(--qa-border);
    border-radius:16px;
    font-size:12px;
    font-weight:500;
    line-height:1.35;
    font-style:italic;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    /* Match #qa-panel's z-index so the expanded panel body doesn't cover
       the bubble — sibling on <body>, appended after the panel, so equal
       z-index resolves in the bubble's favour via document order. */
    z-index:2147483647;
    pointer-events:auto;
    opacity:0;
    transform:translateY(-4px) scale(.95);
    transform-origin:top left;
    transition:opacity .18s ease, transform .18s ease;
}
.qa-quote-bubble[hidden]{ display:none; }
.qa-quote-bubble-open{
    opacity:1;
    transform:translateY(0) scale(1);
}
/* Dark-mode surface + border (mirrors the tokens in #qa-panel.qa-dark).
   Class is applied at show time in wireQuoteBubble(). */
.qa-quote-bubble.qa-dark{
    --qa-surface:       #2a2f36;
    --qa-text:          #e8eaed;
    --qa-border:        #3a3f47;
    box-shadow:0 8px 24px rgba(0,0,0,.45);
}
/* Tail: two little circles that trail from the exposed edge of the bubble
   back toward the rocket icon. Their offset along that edge is driven by
   --qa-tail-offset (set from JS to the icon's projected centre), so the
   tail follows the icon even when the bubble was clamped to the viewport. */
.qa-quote-bubble::before,
.qa-quote-bubble::after{
    content:"";
    position:absolute;
    background:var(--qa-surface);
    border:1px solid var(--qa-border);
    border-radius:50%;
}
.qa-quote-bubble::before{ width:8px; height:8px; }
.qa-quote-bubble::after{  width:5px; height:5px; }

/* Default + explicit "below": tail on the top edge, circles offset in x. */
.qa-quote-bubble::before,
.qa-quote-bubble[data-side="below"]::before{
    top:-6px; bottom:auto; right:auto;
    left:calc(var(--qa-tail-offset, 12px) - 4px);
}
.qa-quote-bubble::after,
.qa-quote-bubble[data-side="below"]::after{
    top:-13px; bottom:auto; right:auto;
    left:calc(var(--qa-tail-offset, 12px) - 2.5px);
}
/* Above: tail on the bottom edge. */
.qa-quote-bubble[data-side="above"]::before{
    top:auto; right:auto;
    bottom:-6px;
    left:calc(var(--qa-tail-offset, 12px) - 4px);
}
.qa-quote-bubble[data-side="above"]::after{
    top:auto; right:auto;
    bottom:-13px;
    left:calc(var(--qa-tail-offset, 12px) - 2.5px);
}
/* Right (bubble sits to the right of the icon): tail on the left edge. */
.qa-quote-bubble[data-side="right"]::before{
    left:-6px; right:auto; bottom:auto;
    top:calc(var(--qa-tail-offset, 12px) - 4px);
}
.qa-quote-bubble[data-side="right"]::after{
    left:-13px; right:auto; bottom:auto;
    top:calc(var(--qa-tail-offset, 12px) - 2.5px);
}
/* Left (bubble sits to the left of the icon): tail on the right edge. */
.qa-quote-bubble[data-side="left"]::before{
    left:auto; bottom:auto;
    right:-6px;
    top:calc(var(--qa-tail-offset, 12px) - 4px);
}
.qa-quote-bubble[data-side="left"]::after{
    left:auto; bottom:auto;
    right:-13px;
    top:calc(var(--qa-tail-offset, 12px) - 2.5px);
}
/* Vertical (rotated) collapsed strip uses writing-mode:vertical-rl on
   .qa-title — counteract the rotation on the icon so it stays upright
   instead of being hidden entirely. */
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-title-icon{
    writing-mode:horizontal-tb;
}

.qa-section-toggle{
    position:relative;
    display:flex;
    align-items:center;
    justify-content:space-between;
    width:100%;
    background:transparent;
    border:none;
    cursor:pointer;
    padding:4px 2px 4px 10px;
    margin:2px 0 4px;
    font-size:10px;
    text-transform:uppercase;
    letter-spacing:.6px;
    color:var(--qa-muted);
    font-weight:700;
    font-family:inherit;
}
.qa-section-toggle:hover{ color:var(--qa-brand); }
.qa-caret{
    font-size:11px;
    line-height:1;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    transition:transform .18s cubic-bezier(.4,0,.2,1),color .15s ease;
}
.qa-caret svg{
    width:12px;
    height:12px;
    stroke:currentColor;
    fill:none;
    stroke-width:2.2;
    stroke-linecap:round;
    stroke-linejoin:round;
}
/* Rotate the chevron when the section is open. Works whether the caret
   contains text (▸) or an SVG chevron-right. Colour tweens to brand so the
   whole toggle looks a touch more "active" while expanded. */
.qa-caret.qa-caret-open{
    transform:rotate(90deg);
    color:var(--qa-brand);
}
.qa-section-toggle:hover .qa-caret{ color:var(--qa-brand); }

/* Elevated "grouped panel" surface for the Description Source wrap so the
   template + AI subsections read as a single tool card instead of a loose
   stack of controls right after the toggle. Subtle 1px border + tiny inset
   shadow lift it off the frosted body. */
.qa-tmpl-wrap:not([hidden]){
    background:var(--qa-surface-elevated);
    border:1px solid var(--qa-border);
    border-radius:10px;
    padding:10px;
    margin:0 0 6px;
    box-shadow:var(--qa-shadow-btn);
}
.qa-tmpl-wrap[hidden]{ display:none; }

/* ---------- Agile Boards row (Redmine only) ----------
   On Redmine, the four board buttons are laid out in a single row that
   shrinks its buttons instead of wrapping. On the launcher (dev.cloudapper.com)
   the .qa-launcher class stays on #qa-panel and this rule is skipped, so board
   buttons render in the default vertical stack there. */
.qa-boards-row{
    margin:0 0 6px;
}
#qa-panel:not(.qa-launcher) .qa-boards-row{
    display:flex;
    flex-wrap:nowrap;
    gap:6px;
    container-type:inline-size;
}
#qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-btn{
    width:auto;
    flex:1 1 0;
    min-width:0;
    margin-bottom:0;
    padding:8px 6px;
    justify-content:center;
    gap:5px;
    font-size:12px;
    text-align:center;
    white-space:nowrap;
}
#qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-label{
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    display:inline-flex;
    align-items:center;
    gap:4px;
}
/* Trailing " Board" word is redundant when the section is titled
   "Agile Boards" — drop it in the row layout. Launcher keeps it. */
#qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-suffix{
    display:none;
}
/* The ⇧N shortcut chip is redundant in the compact row — hide it on
   Redmine. Launcher (stacked layout) still shows it. Alt+Shift+1..4
   shortcuts continue to work either way. */
#qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-btn kbd{
    display:none;
}
/* When the row itself becomes very narrow, drop the project name entirely
   and leave the icon + ⇧N chip (or icon alone — the kbd chip is already
   hidden on Redmine). Truncating the name to a couple of characters gave
   ugly clipped text like "We…", so we hide it cleanly instead. The
   button's title="…" keeps the intent discoverable on hover. */
@container (max-width: 320px){
    #qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-name,
    #qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-suffix{
        display:none;
    }
    #qa-panel:not(.qa-launcher) .qa-boards-row .qa-board-label{
        gap:0;
    }
}

.qa-btn{
    position:relative;
    display:flex;
    align-items:center;
    justify-content:space-between;
    width:100%;
    box-sizing:border-box;
    padding:9px 10px 9px 13px;
    margin-bottom:6px;
    border:1px solid var(--qa-border);
    border-radius:var(--qa-r-md);
    background:var(--qa-surface-2);
    color:var(--qa-text);
    cursor:pointer;
    font-size:13px;
    text-align:left;
    text-decoration:none;
    overflow:hidden;
    transition:background .15s ease,border-color .15s ease,box-shadow .15s ease,transform .08s ease;
}
/* Growing brand-coloured accent bar on the left — 0 px by default, animates to
   3 px on hover. Feels like a modern Linear/GitHub row indicator instead of
   the old "slam the whole button to solid brand" hover. */
.qa-btn::before{
    content:"";
    position:absolute;
    left:0;
    top:0;
    bottom:0;
    width:0;
    background:var(--qa-brand);
    transition:width .18s cubic-bezier(.4,0,.2,1);
    pointer-events:none;
}
.qa-btn:hover{
    background:var(--qa-brand-tint);
    border-color:color-mix(in srgb, var(--qa-brand) 30%, var(--qa-border));
    color:var(--qa-text);
    box-shadow:var(--qa-shadow-btn-hover);
}
.qa-btn:hover::before{ width:3px; }
.qa-btn[hidden]{ display:none; }
/* Beat the Redmine theme's a:hover underline (higher specificity). */
#qa-panel .qa-btn:hover,
#qa-panel .qa-btn:focus,
#qa-panel .qa-btn:active{
    text-decoration:none;
}
.qa-btn:active{
    transform:scale(.985);
    box-shadow:none;
}
/* Soft focus rings on every interactive control. Uses a box-shadow ring
   (which follows the element's border-radius) plus a matching outline for
   Windows High Contrast Mode, instead of the old hard 2px outline that
   left a squared-off halo around rounded corners. */
.qa-btn:focus-visible,
.qa-hbtn:focus-visible,
.qa-section-toggle:focus-visible,
.qa-mode-btn:focus-visible,
.qa-tracker-card:focus-visible{
    outline:2px solid transparent;
    outline-offset:2px;
    box-shadow:0 0 0 3px color-mix(in srgb, var(--qa-brand) 30%, transparent);
}
.qa-btn kbd{
    font-family:inherit;
    font-size:10px;
    background:var(--qa-kbd-bg);
    color:inherit;
    border-radius:4px;
    padding:1px 6px;
    margin-left:8px;
    opacity:.75;
}

/* Danger buttons (Clear Form) reuse the soft-hover pattern: red accent bar
   on the left + a warm danger tint background instead of slamming solid red. */
.qa-danger::before{ background:var(--qa-danger); }
.qa-danger:hover{
    background:var(--qa-danger-bg);
    border-color:color-mix(in srgb, var(--qa-danger) 35%, var(--qa-border));
    color:var(--qa-danger-text);
}

.qa-divider{
    height:1px;
    background:var(--qa-divider);
    margin:8px 0;
}

.qa-template-input{
    width:100%;
    box-sizing:border-box;
    min-height:120px;
    resize:vertical;
    padding:8px 9px;
    margin-bottom:6px;
    border:1px solid var(--qa-border);
    border-radius:8px;
    background:var(--qa-surface-3);
    color:var(--qa-text);
    font-family:var(--qa-font-mono);
    font-size:12px;
    line-height:1.45;
    user-select:text;
    white-space:pre-wrap;
    overflow-wrap:anywhere;
    word-break:break-word;
    overflow-x:hidden;
    overflow-y:auto;
    transition:border-color .15s ease,box-shadow .15s ease;
}
.qa-template-input:focus{
    outline:none;
    border-color:var(--qa-brand);
    box-shadow:0 0 0 3px var(--qa-brand-focus-ring);
}

.qa-template-actions{
    display:flex;
    flex-wrap:nowrap;
    gap:6px;
    /* Container query context: the label inside each button is hidden when the
       row itself gets narrow, so the buttons stay side-by-side and shrink to
       icon-only instead of wrapping onto a second line. */
    container-type:inline-size;
}
.qa-tmpl-btn{
    justify-content:center;
    margin-bottom:0;
    font-size:12px;
    /* Equal share, allowed to shrink below content width so 5 buttons stay
       on one row. white-space:nowrap keeps the emoji + label glued together. */
    flex:1 1 0;
    min-width:0;
    white-space:nowrap;
    padding-left:8px;
    padding-right:8px;
    gap:6px;
}
.qa-tmpl-btn .qa-btn-label{
    overflow:hidden;
    text-overflow:ellipsis;
}
/* When the actions row is too narrow to fit 5 labelled buttons, drop the
   text and leave the icons alone. The <button title="…"> gives users the
   full name on hover — Alt+F / Alt+C / Alt+X shortcuts still work too. */
@container (max-width: 340px){
    .qa-tmpl-btn .qa-btn-label{ display:none; }
    .qa-tmpl-btn{ padding-left:6px; padding-right:6px; }
}

/* ---------- AI mode: segmented toggle with sliding indicator ---------- */
.qa-mode-switch{
    position:relative;
    display:flex;
    gap:3px;
    padding:3px;
    margin:2px 0 10px;
    background:var(--qa-surface-inset);
    border-radius:8px;
    user-select:none;
}
/* The sliding pill sits behind the two buttons. Its horizontal position is
   driven by [data-active] on the container so the movement is pure CSS — the
   JS handler just flips the attribute. Width = half the container minus the
   3px padding on both sides + the 3px gap between the buttons.
   AI sits on the LEFT (default), Template on the RIGHT. */
.qa-mode-switch::before{
    content:"";
    position:absolute;
    top:3px;
    bottom:3px;
    left:3px;
    width:calc((100% - 9px) / 2);
    background:var(--qa-surface);
    border:1px solid var(--qa-border);
    border-radius:6px;
    box-shadow:var(--qa-shadow-btn);
    transform:translateX(0);
    transition:transform .22s cubic-bezier(.4,0,.2,1), border-color .15s ease;
    z-index:0;
    pointer-events:none;
}
.qa-mode-switch[data-active="ai"]::before{
    border-color:color-mix(in srgb, var(--qa-accent) 35%, var(--qa-border));
}
.qa-mode-switch[data-active="template"]::before{
    transform:translateX(calc(100% + 3px));
}
.qa-mode-btn{
    position:relative;
    z-index:1;
    flex:1;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    padding:7px 0;
    border:1px solid transparent;
    border-radius:6px;
    background:transparent;
    color:var(--qa-text-soft);
    font-family:inherit;
    font-size:12px;
    font-weight:600;
    cursor:pointer;
    transition:color .15s ease;
}
.qa-mode-btn:hover{ color:var(--qa-text); }
.qa-mode-btn.active{ color:var(--qa-text); }
.qa-mode-btn[data-mode="ai"].active{ color:var(--qa-accent); }

.qa-ai-field{
    width:100%;
    box-sizing:border-box;
    padding:8px 9px;
    margin-bottom:6px;
    border:1px solid var(--qa-border);
    border-radius:8px;
    background:var(--qa-surface-3);
    color:var(--qa-text);
    font-family:var(--qa-font);
    font-size:12px;
    line-height:1.45;
    user-select:text;
    white-space:pre-wrap;
    overflow-wrap:anywhere;
    word-break:break-word;
    transition:border-color .15s ease,box-shadow .15s ease;
}
.qa-ai-field:focus{
    outline:none;
    border-color:var(--qa-accent);
    box-shadow:0 0 0 3px var(--qa-accent-focus-ring);
}
.qa-ai-compose{ resize:vertical; min-height:52px; }

.qa-ai-key{ display:flex; gap:6px; align-items:stretch; }
.qa-ai-key .qa-ai-field{ flex:1; margin-bottom:6px; }
.qa-ai-key .qa-tmpl-btn{
    flex:0 0 auto;
    width:auto;
    white-space:nowrap;
    margin-bottom:6px;
    padding:6px 10px;
    align-self:center;
}
.qa-ai-key-edit{ display:flex; gap:6px; align-items:center; flex:1; }
.qa-ai-key-edit[hidden]{ display:none; }

/* Mask the API key without using type="password" — that prevents browsers and
   password managers (Chrome, 1Password, LastPass, …) from attaching autofill
   to unrelated text inputs on the same page. Falls back to plain text on
   engines that don't support -webkit-text-security. */
.qa-secret{
    -webkit-text-security:disc;
    letter-spacing:0.05em;
}
.qa-icon-btn{
    flex:0 0 auto;
    width:auto;
    padding:6px 8px;
    line-height:1;
}
.qa-icon-btn svg{
    width:14px;
    height:14px;
    display:block;
}
.qa-ai-key-saved{
    display:flex;
    gap:6px;
    align-items:center;
    flex:1;
    margin-bottom:6px;
}
.qa-ai-key-saved[hidden]{ display:none; }
.qa-ai-key-status{
    flex:1;
    font-size:12px;
    font-weight:600;
    color:var(--qa-ok);
}
.qa-ai-key-saved .qa-tmpl-btn{
    /* Compact, chip-like Change button: doesn't stretch to fill the row
       (overrides .qa-tmpl-btn's flex:1) and gets a subtle raised shadow +
       hover lift so it reads as a clickable button next to the plain
       "API key saved" status text. */
    flex:0 0 auto;
    width:auto;
    padding:5px 10px;
    font-size:11px;
    font-weight:600;
    white-space:nowrap;
    margin-bottom:0;
    background:var(--qa-surface);
    border:1px solid var(--qa-border);
    box-shadow:0 1px 0 rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.6);
}
.qa-ai-key-saved .qa-tmpl-btn:hover{
    background:var(--qa-brand-tint);
    border-color:var(--qa-brand);
    color:var(--qa-brand-strong);
    box-shadow:0 2px 4px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.6);
}
.qa-ai-key-saved .qa-tmpl-btn:active{
    transform:translateY(1px);
    box-shadow:inset 0 1px 2px rgba(0,0,0,.08);
}

.qa-ai-model-row{
    display:flex;
    align-items:center;
    gap:8px;
    margin-bottom:8px;
    font-size:12px;
    font-weight:600;
    color:var(--qa-text);
}
.qa-ai-model-row > span{ flex:0 0 auto; }
.qa-ai-model-row select.qa-ai-field{
    flex:1;
    margin-bottom:0;
    height:32px;
    line-height:normal;
    padding:4px 9px;
    cursor:pointer;
}

/* ---------- Close this issue ---------- */
/* Appears at the bottom of the panel body when the current URL is
   /issues/<id>. The section shares tokens with the rest of the panel so
   accent + dark-mode changes flow through automatically \u2014 no bespoke
   colours here beyond the disabled-state background. */
.qa-close-issue-wrap[hidden]{ display:none; }
.qa-close-issue-wrap .qa-ai-model-row{
    margin-top:2px;
    margin-bottom:6px;
}
.qa-close-note-input{
    display:block;
    width:100%;
    box-sizing:border-box;
    min-height:52px;
    resize:vertical;
    background:var(--qa-surface-alt, color-mix(in srgb, var(--qa-text) 6%, transparent));
    border:1px solid var(--qa-border);
    border-radius:var(--qa-r-md);
    padding:8px 10px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Code", monospace;
    font-size:12px;
    line-height:1.45;
    color:var(--qa-text);
    white-space:pre-wrap;
    word-break:break-word;
    margin:0 0 8px;
    transition:border-color .15s ease, box-shadow .15s ease;
}
.qa-close-note-input:focus{
    outline:none;
    border-color:var(--qa-brand);
    box-shadow:0 0 0 3px var(--qa-brand-focus-ring);
}
.qa-close-note-input:disabled{
    color:var(--qa-muted);
    cursor:not-allowed;
    opacity:.75;
}
.qa-close-note-input::placeholder{
    color:var(--qa-muted);
    font-style:italic;
    font-family:inherit;
}

/* ---------- Bulk close (Agile board) ----------
   Renders below the single-issue close section on any Redmine page but only
   becomes visible on /projects/<x>/agile/board pages. Reuses the panel's
   accent + surface tokens so it themes for free; the only bespoke visuals
   are the count chip, the card checkbox overlays, and the confirmation
   modal (which needs its own tokens because it's detached to <body>). */
.qa-bulk-close-wrap[hidden]{ display:none; }
.qa-bulk-close-wrap .qa-ai-model-row{ margin-top:2px; margin-bottom:6px; }
.qa-bulk-fields[hidden]{ display:none; }
/* Show Reopened Issues section mirrors the bulk-close chrome. */
.qa-reopened-wrap[hidden]{ display:none; }
/* Row wrapper for the reopened button. Deliberately NOT reusing
   '.qa-template-actions' because that one has a container query
   that hides '.qa-btn-label' in narrow panels (< 340px) — which
   would collapse this button to icon-only. This row keeps the
   label visible at all panel widths. */
.qa-reopened-row{
    display:flex;
    align-items:center;
    gap:8px;
}
.qa-reopened-row .qa-tmpl-btn{
    flex:1 1 auto;
}
/* Loader state — while '#qa-show-reopened.qa-loading' is applied by the
   click handler, spin the button's icon so users get an unambiguous
   "yes, work is happening" signal during the multi-second sprint scan.
   'rotate-ccw' is the perfect icon for this: the arrow already implies
   motion, so the animation reads as intentional rather than glitchy.
   Slightly dim the label + reduce opacity to reinforce the disabled
   feel without hiding the "Scanning X of Y…" progress text the JS
   updates every batch. */
@keyframes qa-btn-spin{
    from{ transform:rotate(0deg); }
    to{ transform:rotate(-360deg); }
}
.qa-btn.qa-loading{
    cursor:progress;
}
.qa-btn.qa-loading .qa-btn-icon{
    animation:qa-btn-spin 0.9s linear infinite;
    transform-origin:50% 50%;
}
.qa-btn.qa-loading .qa-btn-label{
    opacity:0.85;
}

.qa-bulk-toggle-row{
    display:flex;
    align-items:center;
    gap:8px;
    margin-bottom:8px;
}
.qa-bulk-select-btn{ flex:1 1 auto; }
.qa-bulk-select-btn.qa-active{
    background:var(--qa-brand-tint);
    border-color:var(--qa-brand);
    color:var(--qa-brand-strong);
}
.qa-bulk-count{
    flex:0 0 auto;
    padding:4px 10px;
    border-radius:999px;
    background:var(--qa-brand-tint);
    color:var(--qa-brand-strong);
    font-size:11px;
    font-weight:600;
    letter-spacing:.2px;
    white-space:nowrap;
}
.qa-bulk-count[hidden]{ display:none; }

/* Card selection overlay: while body.qa-selecting is on, every agile-board
   card gets a small checkbox in its top-right corner. */
body.qa-selecting .issue-card,
body.qa-selecting .agile-issue{
    position:relative;
}
.qa-card-checkbox{
    position:absolute;
    top:6px;
    right:6px;
    width:16px;
    height:16px;
    margin:0;
    cursor:pointer;
    z-index:20;
    accent-color:#4a9eff;
    box-shadow:0 1px 4px rgba(0,0,0,.25);
    background:#fff;
    border-radius:3px;
}
.qa-card-selected{
    outline:2px solid #4a9eff !important;
    outline-offset:-2px;
    box-shadow:0 0 0 3px rgba(74,158,255,.25) !important;
}

/* ---------- Confirmation modal ----------
   Lives directly under <body> (moved out of #qa-panel at wiring time). */
.qa-modal-overlay{
    position:fixed;
    inset:0;
    background:rgba(15,20,30,.55);
    backdrop-filter:blur(3px);
    -webkit-backdrop-filter:blur(3px);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:32px 16px;
    z-index:2147483646;
    opacity:0;
    transition:opacity .18s ease;
    --qa-brand:            #1f6feb;
    --qa-brand-hover:      #175bb5;
    --qa-brand-strong:     #0d1f3d;
    --qa-brand-tint:       #e3ecfb;
    --qa-brand-active-bg:  #d8e6fb;
    --qa-brand-focus-ring: rgba(31,111,235,.22);
    --qa-text:             #23272f;
    --qa-muted:            #6b7280;
    --qa-border:           #d7dae0;
    --qa-surface:          #ffffff;
    --qa-surface-alt:      #f4f6fa;
    --qa-r-md:             10px;
    --qa-on-brand:         #ffffff;
    color:var(--qa-text);
    font-family:"Inter", "SF Pro Text", "SF Pro", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
}
.qa-modal-overlay[hidden]{ display:none; }
.qa-modal-overlay.qa-modal-open{ opacity:1; }

.qa-modal-overlay.qa-dark{
    --qa-brand:            #4a9eff;
    --qa-brand-hover:      #3a8ae8;
    --qa-brand-strong:     #cfe4ff;
    --qa-brand-tint:       #33445a;
    --qa-brand-active-bg:  #1e3a5f;
    --qa-brand-focus-ring: rgba(74,158,255,.22);
    --qa-text:             #e4e7eb;
    --qa-muted:            #9aa5b1;
    --qa-border:           #40495a;
    --qa-surface:          #1a2130;
    --qa-surface-alt:      #232b3b;
}
.qa-modal-overlay.qa-accent-lavender{ --qa-brand:#7b3fe4; --qa-brand-hover:#6935cf; }
.qa-modal-overlay.qa-accent-orange  { --qa-brand:#e67e22; --qa-brand-hover:#c76914; }
.qa-modal-overlay.qa-accent-red     { --qa-brand:#e57373; --qa-brand-hover:#cc5a5a; }
.qa-modal-overlay.qa-dark.qa-accent-lavender{ --qa-brand:#b79cff; --qa-brand-hover:#9d80f2; }
.qa-modal-overlay.qa-dark.qa-accent-orange  { --qa-brand:#ffb066; --qa-brand-hover:#e59243; }
.qa-modal-overlay.qa-dark.qa-accent-red     { --qa-brand:#ff9d9d; --qa-brand-hover:#e57373; }

.qa-modal{
    background:var(--qa-surface);
    border-radius:14px;
    border:1px solid var(--qa-border);
    box-shadow:0 20px 60px rgba(0,0,0,.35);
    width:min(440px, 100%);
    max-height:calc(100vh - 64px);
    display:flex;
    flex-direction:column;
    overflow:hidden;
    transform:translateY(10px) scale(.98);
    transition:transform .18s ease;
}
.qa-modal-overlay.qa-modal-open .qa-modal{
    transform:translateY(0) scale(1);
}
.qa-modal-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:14px 16px;
    border-bottom:1px solid var(--qa-border);
}
.qa-modal-title{
    font-size:14px;
    font-weight:600;
    color:var(--qa-text);
}
.qa-modal-close{
    background:transparent;
    border:none;
    color:var(--qa-muted);
    width:28px;
    height:28px;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    border-radius:6px;
    cursor:pointer;
    transition:background .15s ease, color .15s ease;
}
.qa-modal-close:hover{ background:var(--qa-surface-alt); color:var(--qa-text); }
.qa-modal-close svg{ width:16px; height:16px; }
.qa-modal-body{
    padding:14px 16px;
    overflow-y:auto;
    display:flex;
    flex-direction:column;
    gap:10px;
}
.qa-modal-lede{
    margin:0;
    font-size:12px;
    line-height:1.5;
    color:var(--qa-text);
}
.qa-modal-list{
    list-style:none;
    margin:0;
    padding:8px 10px;
    background:var(--qa-surface-alt);
    border-radius:var(--qa-r-md);
    max-height:180px;
    overflow-y:auto;
    display:flex;
    flex-direction:column;
    gap:4px;
    font-size:12px;
}
.qa-modal-list li{
    display:flex;
    gap:6px;
    align-items:baseline;
    line-height:1.4;
}
.qa-modal-list a{
    color:var(--qa-brand);
    text-decoration:none;
    font-weight:600;
    white-space:nowrap;
    flex:0 0 auto;
}
.qa-modal-list a:hover{ text-decoration:underline; }
.qa-modal-list-subject{
    color:var(--qa-text);
    overflow:hidden;
    text-overflow:ellipsis;
    display:-webkit-box;
    -webkit-line-clamp:2;
    line-clamp:2;
    -webkit-box-orient:vertical;
    word-break:break-word;
    flex:1 1 auto;
}
.qa-modal-list-skip{ opacity:.6; }
.qa-modal-list-skip .qa-modal-list-subject{ text-decoration:line-through; }
.qa-modal-badge{
    margin-left:auto;
    padding:1px 7px;
    border-radius:999px;
    font-size:10px;
    font-weight:600;
    letter-spacing:.2px;
    white-space:nowrap;
    flex:0 0 auto;
    align-self:center;
}
.qa-modal-badge-noop{
    background:var(--qa-surface);
    color:var(--qa-muted);
    border:1px solid var(--qa-border);
}
.qa-modal-badge-warn{
    background:#fff3cd;
    color:#8a5a00;
    border:1px solid #f0d47a;
}
.qa-modal-overlay.qa-dark .qa-modal-badge-warn{
    background:#4a3a1a;
    color:#ffcc80;
    border-color:#6a4f1a;
}
.qa-modal-summary{
    font-size:11px;
    color:var(--qa-muted);
    padding:6px 8px;
    border-radius:var(--qa-r-md);
    background:var(--qa-surface-alt);
    border:1px solid var(--qa-border);
    line-height:1.4;
}
.qa-modal-summary[hidden]{ display:none; }
.qa-modal-summary-checking{ font-style:italic; }
.qa-modal-summary-warn{
    background:#fff8e1;
    color:#7a5300;
    border-color:#f0d47a;
}
.qa-modal-overlay.qa-dark .qa-modal-summary-warn{
    background:#3a2f18;
    color:#ffcc80;
    border-color:#6a4f1a;
}
.qa-modal-meta{
    display:flex;
    flex-direction:column;
    gap:4px;
    font-size:12px;
    color:var(--qa-text);
}
.qa-modal-meta-row{ line-height:1.5; }
.qa-modal-note-label{ margin-top:2px; }
.qa-modal-note{
    background:var(--qa-surface-alt);
    border:1px solid var(--qa-border);
    border-radius:var(--qa-r-md);
    padding:8px 10px;
    margin:0;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Code", monospace;
    font-size:11.5px;
    line-height:1.5;
    color:var(--qa-text);
    max-height:120px;
    overflow-y:auto;
    white-space:pre-wrap;
    word-break:break-word;
}
.qa-modal-actions{
    display:flex;
    justify-content:flex-end;
    gap:8px;
    padding:12px 16px;
    border-top:1px solid var(--qa-border);
    background:var(--qa-surface-alt);
}
.qa-modal-actions .qa-btn{
    min-width:auto;
    padding:6px 14px;
}
.qa-modal-progress{
    display:flex;
    flex-direction:column;
    gap:6px;
    padding:8px 10px;
    border-radius:var(--qa-r-md);
    background:var(--qa-surface-alt);
    border:1px solid var(--qa-border);
}
.qa-modal-progress[hidden]{ display:none; }
.qa-modal-progress-header{
    display:flex;
    align-items:center;
    gap:8px;
    font-size:12px;
    color:var(--qa-text);
}
.qa-modal-progress-text{ font-variant-numeric:tabular-nums; }
.qa-modal-progress-track{
    position:relative;
    height:6px;
    border-radius:999px;
    background:var(--qa-border);
    overflow:hidden;
}
.qa-modal-progress-fill{
    height:100%;
    width:0%;
    background:var(--qa-accent, #3b82f6);
    border-radius:999px;
    transition:width 180ms ease-out;
}
.qa-spinner{
    display:inline-block;
    width:12px;
    height:12px;
    border-radius:50%;
    border:2px solid var(--qa-border);
    border-top-color:var(--qa-accent, #3b82f6);
    animation:qa-spin 700ms linear infinite;
}
@keyframes qa-spin{
    to { transform:rotate(360deg); }
}
.qa-modal-badge-done{
    background:#e6f4ea;
    color:#1e7a3a;
    border:1px solid #b6e0c2;
}
.qa-modal-overlay.qa-dark .qa-modal-badge-done{
    background:#1f3a29;
    color:#8bd6a5;
    border-color:#2f5a3d;
}
.qa-modal-badge-fail{
    background:#fde8e8;
    color:#a41c1c;
    border:1px solid #f4b4b4;
}
.qa-modal-overlay.qa-dark .qa-modal-badge-fail{
    background:#3a1e1e;
    color:#ffb4b4;
    border-color:#6a2f2f;
}
.qa-modal-list-done{ opacity:0.85; }
.qa-modal-list-failed{ background:rgba(220, 38, 38, 0.05); }
.qa-modal-overlay.qa-dark .qa-modal-list-failed{ background:rgba(220, 38, 38, 0.12); }
.qa-modal-list-error{
    display:block;
    margin-top:3px;
    padding-left:2px;
    font-size:11px;
    line-height:1.4;
    color:#a41c1c;
    font-style:italic;
    word-break:break-word;
}
.qa-modal-overlay.qa-dark .qa-modal-list-error{ color:#ff8a80; }
.qa-modal-progress-done .qa-spinner{ display:none; }

/* Reopened-issues modal — the list can grow long (whole sprint's
   worth of issues that ever hit Reopen), so we give the modal a
   taller footprint than the bulk-close confirmation. The list
   itself gets a much larger scroll region so ~15 rows are visible
   before the user has to scroll. */
#qa-reopened-modal .qa-modal{
    min-height:min(720px, calc(100vh - 64px));
    width:min(520px, 100%);
}
#qa-reopened-modal .qa-modal-body{
    flex:1 1 auto;
}
#qa-reopened-modal .qa-modal-list-reopened{
    max-height:none;
    flex:1 1 auto;
    min-height:360px;
}
/* Full subjects — the shared '.qa-modal-list-subject' rule clamps
   to 2 lines with an ellipsis (good for the bulk-close preview
   where users just need to scan ids). In the reopened-issues
   modal the whole point is inspection, so we let the subject
   wrap freely and swap the row alignment to top so long titles
   don't drag the badge off centre. */
#qa-reopened-modal .qa-modal-list li{
    align-items:flex-start;
}
#qa-reopened-modal .qa-modal-list-subject{
    display:block;
    -webkit-line-clamp:unset;
    line-clamp:unset;
    -webkit-box-orient:unset;
    overflow:visible;
    text-overflow:clip;
    white-space:normal;
}
/* "Partially synced" warning strip — shown between the button
   and the next section whenever the last scan for the current
   sprint hit the wall-clock cap. Amber tint so it reads as an
   action-required nudge without alarming users. */
.qa-reopened-warn{
    margin-top:8px;
    padding:6px 10px;
    border-radius:var(--qa-r-md);
    background:#fff3cd;
    color:#8a5a00;
    border:1px solid #f0d47a;
    font-size:11px;
    line-height:1.4;
}
.qa-panel.qa-dark .qa-reopened-warn{
    background:#4a3a1a;
    color:#ffcc80;
    border-color:#6b5220;
}
.qa-reopened-warn[hidden]{ display:none; }
/* Total-reopened counter pill shown next to the modal title. */
.qa-modal-count-badge{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-width:22px;
    height:20px;
    padding:0 8px;
    margin-left:8px;
    border-radius:999px;
    background:var(--qa-brand-tint);
    color:var(--qa-brand-strong);
    font-size:11px;
    font-weight:700;
    letter-spacing:.2px;
    font-variant-numeric:tabular-nums;
    vertical-align:middle;
}
.qa-modal-count-badge[hidden]{ display:none; }

@media (prefers-reduced-motion:reduce){
    .qa-modal-overlay, .qa-modal{ transition:none; }
    .qa-modal-progress-fill{ transition:none; }
    .qa-spinner{ animation:none; }
}

.qa-ai-chat{
    display:flex;
    flex-direction:column;
    gap:6px;
    max-height:220px;
    overflow-y:auto;
    margin-bottom:8px;
    scrollbar-width:thin;
    scrollbar-color:var(--qa-scroll-thumb) transparent;
}
.qa-ai-chat::-webkit-scrollbar{ width:8px; }
.qa-ai-chat::-webkit-scrollbar-track{ background:transparent; }
.qa-ai-chat::-webkit-scrollbar-thumb{
    background:var(--qa-scroll-thumb);
    border-radius:8px;
    border:2px solid transparent;
    background-clip:padding-box;
}
.qa-ai-chat::-webkit-scrollbar-thumb:hover{ background:var(--qa-scroll-thumb-hover); }
.qa-ai-chat:empty{ display:none; }
.qa-bubble{
    max-width:90%;
    padding:7px 10px;
    border-radius:10px;
    font-size:12px;
    line-height:1.4;
    white-space:pre-wrap;
    word-break:break-word;
}
.qa-bubble-user{
    align-self:flex-end;
    background:var(--qa-brand);
    color:var(--qa-on-brand);
    border-bottom-right-radius:3px;
}
.qa-bubble-ai{
    align-self:flex-start;
    background:var(--qa-accent-bg);
    color:var(--qa-accent-text);
    border-bottom-left-radius:3px;
}
.qa-bubble-error{
    background:var(--qa-danger-bg);
    color:var(--qa-danger-text);
}

/* Typing indicator — three dots that pulse in sequence, replacing the static
   "Thinking…" text while awaiting an AI response. Bubble keeps its normal
   .qa-bubble-ai styling; the class is removed once real content arrives. */
.qa-bubble.qa-typing{
    padding:10px 14px;
    line-height:1;
}
.qa-dot{
    display:inline-block;
    width:6px;
    height:6px;
    margin:0 2px;
    border-radius:50%;
    background:currentColor;
    opacity:.35;
    vertical-align:middle;
    animation:qa-dot-pulse 1.2s infinite ease-in-out;
}
.qa-dot:first-child{ margin-left:0; }
.qa-dot:last-child{ margin-right:0; }
.qa-dot:nth-child(2){ animation-delay:.18s; }
.qa-dot:nth-child(3){ animation-delay:.36s; }
@keyframes qa-dot-pulse{
    0%, 60%, 100%{ opacity:.35; transform:scale(1); }
    30%          { opacity:1;   transform:scale(1.15); }
}

.qa-ai-review{
    margin-top:8px;
    padding:10px;
    background:var(--qa-surface-elevated);
    border:1px solid var(--qa-border);
    border-radius:10px;
    box-shadow:var(--qa-shadow-btn);
}
/* Fresh-draft reveal animation. The review card is easy to miss when it
   appears below the fold after Structure runs — pulse a soft brand-tinted
   halo (that fades out) plus a tiny slide-in to draw the eye. Runs each
   time a new draft comes back; combined with a scrollIntoView() in JS so
   the card is guaranteed to be on-screen. */
@keyframes qa-ai-review-in{
    0%{
        opacity:0;
        transform:translateY(-8px);
        box-shadow:0 0 0 3px color-mix(in srgb, var(--qa-brand) 55%, transparent), var(--qa-shadow-btn);
    }
    60%{
        opacity:1;
        transform:translateY(0);
        box-shadow:0 0 0 3px color-mix(in srgb, var(--qa-brand) 35%, transparent), var(--qa-shadow-btn);
    }
    100%{
        opacity:1;
        transform:translateY(0);
        box-shadow:var(--qa-shadow-btn);
    }
}
.qa-ai-review.qa-ai-review-reveal{
    animation:qa-ai-review-in .6s cubic-bezier(.2,.8,.2,1);
}
@media (prefers-reduced-motion: reduce){
    .qa-ai-review.qa-ai-review-reveal{ animation:none; }
}
.qa-ai-fill{
    background:var(--qa-accent);
    border-color:var(--qa-accent);
    color:var(--qa-on-brand);
    padding-left:10px; /* no accent bar here (button is already filled) */
}
/* The .qa-btn::before accent bar would be invisible over the filled accent
   background anyway; hide it so it doesn't compete with the solid fill. */
.qa-ai-fill::before{ display:none; }
.qa-ai-fill:hover{
    background:var(--qa-accent-hover);
    border-color:var(--qa-accent-hover);
    color:var(--qa-on-brand);
    box-shadow:var(--qa-shadow-btn-hover);
}

.qa-version{
    text-align:center;
    color:var(--qa-muted);
    font-size:10px;
    letter-spacing:.4px;
    margin-top:10px;
}

#qa-toast{
    position:fixed;
    bottom:24px;
    left:50%;
    transform:translateX(-50%) translateY(20px);
    background:#1f2933;
    color:#fff;
    padding:10px 18px;
    border-radius:8px;
    font-family:"Inter", "SF Pro Text", "SF Pro", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size:13px;
    box-shadow:0 6px 20px rgba(0,0,0,.25);
    opacity:0;
    pointer-events:none;
    transition:opacity .2s ease,transform .2s ease;
    z-index:2147483647;
}
#qa-toast.qa-toast-show{
    opacity:1;
    transform:translateX(-50%) translateY(0);
}

/* ---------- Dark mode: token overrides ----------
   Almost every rule above reads its colour from a CSS variable, so dark mode
   only has to override the tokens on #qa-panel.qa-dark. A handful of things
   (the sliding indicator, chat bubbles) inherit automatically. */
#qa-panel.qa-dark{
    --qa-brand:            #4a9eff;
    --qa-brand-hover:      #3a8ae8;
    --qa-brand-strong:     #cfe4ff;
    --qa-brand-tint:       #33445a;
    --qa-brand-active-bg:  #1e3a5f;
    --qa-brand-focus-ring: rgba(74,158,255,.22);

    --qa-accent:           #b79cff;
    --qa-accent-hover:     #9d80f2;
    --qa-accent-bg:        #2f2a4a;
    --qa-accent-text:      #d9d2f5;
    --qa-accent-focus-ring:rgba(123,63,228,.25);

    --qa-danger-bg:        #4a2020;
    --qa-danger-text:      #ff9d9d;
    --qa-ok:               #81c784;

    --qa-text:             #e4e7eb;
    --qa-text-soft:        #9aa5b1;
    --qa-muted:            #9aa5b1;

    --qa-surface:          rgba(31,41,51,.92);
    --qa-surface-2:        #2c3846;
    --qa-surface-3:        #263340;
    --qa-surface-inset:    #252f3a;
    --qa-surface-elevated: rgba(255,255,255,.04);

    --qa-border:           #3a4553;
    --qa-border-strong:    #3a4553;
    --qa-divider:          #3a4553;

    --qa-kbd-bg:           rgba(255,255,255,.12);
    --qa-scroll-thumb:       #3a4553;
    --qa-scroll-thumb-hover: #52616f;
}

/* ---------- Accent colours: light-mode overrides ----------
   Each accent class overrides the --qa-brand-* token cluster. The default
   (blue) uses the base tokens defined at the top of the file, so no
   .qa-accent-blue block is needed. All hover/focus/selection states across
   the panel read var(--qa-brand) so they adapt automatically. The header
   gradient uses color-mix() on --qa-brand, so it also re-tints itself. */
#qa-panel.qa-accent-lavender{
    --qa-brand:            #7b3fe4;
    --qa-brand-hover:      #6a2fd0;
    --qa-brand-strong:     #4a1fa8;
    --qa-brand-tint:       #f4f0ff;
    --qa-brand-active-bg:  #ebe4ff;
    --qa-brand-focus-ring: rgba(123,63,228,.15);
}
#qa-panel.qa-accent-orange{
    --qa-brand:            #e67e22;
    --qa-brand-hover:      #d35400;
    --qa-brand-strong:     #a04000;
    --qa-brand-tint:       #fdf3e7;
    --qa-brand-active-bg:  #fbe6cf;
    --qa-brand-focus-ring: rgba(230,126,34,.18);
}
#qa-panel.qa-accent-red{
    --qa-brand:            #e57373;
    --qa-brand-hover:      #d64545;
    --qa-brand-strong:     #a02b2b;
    --qa-brand-tint:       #fceded;
    --qa-brand-active-bg:  #fadada;
    --qa-brand-focus-ring: rgba(229,115,115,.18);
}

/* ---------- Accent colours: dark-mode overrides ----------
   Combined with .qa-dark so both classes must match. Brighter/pastel
   variants for legibility on dark surfaces. */
#qa-panel.qa-dark.qa-accent-lavender{
    --qa-brand:            #b79cff;
    --qa-brand-hover:      #9d80f2;
    --qa-brand-strong:     #d9d2f5;
    --qa-brand-tint:       #33244a;
    --qa-brand-active-bg:  #2f2a4a;
    --qa-brand-focus-ring: rgba(183,156,255,.22);
}
#qa-panel.qa-dark.qa-accent-orange{
    --qa-brand:            #ffb066;
    --qa-brand-hover:      #f39944;
    --qa-brand-strong:     #ffd9b3;
    --qa-brand-tint:       #4a3826;
    --qa-brand-active-bg:  #5a4028;
    --qa-brand-focus-ring: rgba(255,176,102,.22);
}
#qa-panel.qa-dark.qa-accent-red{
    --qa-brand:            #ff9d9d;
    --qa-brand-hover:      #ef7f7f;
    --qa-brand-strong:     #ffcccc;
    --qa-brand-tint:       #4a2828;
    --qa-brand-active-bg:  #5a2f2f;
    --qa-brand-focus-ring: rgba(255,157,157,.22);
}

/* ---------- Bulk checklist add ----------
   Lives inside Redmine's own <p id="checklist_form"> on the new-issue and
   issue-edit pages. Kept visually neutral so it blends with Redmine's
   theme rather than importing #qa-panel's design tokens. */
.qa-checklist-bulk{
    display:flex;
    gap:8px;
    align-items:stretch;
    margin:8px 0 0;
    padding:8px 10px;
    background:#f6f8fa;
    border:1px dashed #c9d1d9;
    border-radius:6px;
    box-sizing:border-box;
    max-width:100%;
}
.qa-checklist-bulk-input{
    flex:1 1 auto;
    min-width:0;
    min-height:48px;
    resize:vertical;
    padding:6px 8px;
    border:1px solid #d0d7de;
    border-radius:4px;
    font-family:inherit;
    font-size:12px;
    line-height:1.4;
    box-sizing:border-box;
}
.qa-checklist-bulk-btn{
    align-self:stretch;
    padding:6px 14px;
    border:1px solid #1976d2;
    border-radius:4px;
    background:#1976d2;
    color:#fff;
    font-size:12px;
    font-weight:600;
    cursor:pointer;
    white-space:nowrap;
}
.qa-checklist-bulk-btn:hover{ background:#1565c0; border-color:#1565c0; }
.qa-checklist-bulk-btn:active{ transform:translateY(1px); }

/* ---------- Analyze Ticket ---------- */
/* Panel section: single primary button, styled like the other action rows. */
.qa-analyze-wrap[hidden]{ display:none; }
.qa-analyze-row{ display:flex; }
.qa-analyze-row .qa-btn{ flex:1; }

/* The analysis report is a full Markdown document, so the modal gets
   a wider footprint than the confirmation dialogs and a scrollable
   body that comfortably fits ~30 lines before the user scrolls. */
#qa-analyze-modal .qa-modal{
    width:min(720px, 100%);
    min-height:min(560px, calc(100vh - 64px));
}
#qa-analyze-modal .qa-modal-body{
    flex:1 1 auto;
    padding:16px 20px;
    gap:0;
    font-size:13px;
    line-height:1.55;
    color:var(--qa-text);
}
.qa-analyze-loading{
    display:flex;
    align-items:center;
    gap:10px;
    padding:24px 0;
    font-size:13px;
    color:var(--qa-muted);
}
.qa-analyze-loading[hidden]{ display:none; }
.qa-analyze-report[hidden]{ display:none; }
.qa-analyze-report h3{
    font-size:13px;
    font-weight:700;
    color:var(--qa-brand-strong);
    margin:18px 0 6px;
    padding-bottom:4px;
    border-bottom:1px solid var(--qa-border);
}
.qa-analyze-report h3:first-child{ margin-top:0; }
.qa-analyze-report h4{
    font-size:12.5px;
    font-weight:600;
    margin:14px 0 4px;
    color:var(--qa-text);
}
.qa-analyze-report p{ margin:6px 0; }
.qa-analyze-report ul,
.qa-analyze-report ol{
    margin:6px 0 6px 20px;
    padding:0;
}
.qa-analyze-report li{ margin:3px 0; }
.qa-analyze-report code{
    background:var(--qa-surface-alt);
    padding:1px 5px;
    border-radius:4px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Code", monospace;
    font-size:12px;
}
.qa-analyze-report pre{
    background:var(--qa-surface-alt);
    padding:10px 12px;
    border-radius:8px;
    overflow-x:auto;
    font-size:12px;
    margin:8px 0;
}
.qa-analyze-report pre code{
    background:transparent;
    padding:0;
    border-radius:0;
}
.qa-analyze-report a{
    color:var(--qa-brand);
    text-decoration:none;
}
.qa-analyze-report a:hover{ text-decoration:underline; }
.qa-analyze-report strong{ color:var(--qa-text); }

/* ---------- Similar closed tickets ---------- */
/* Panel section (issue detail pages only). Cache is warm on most
   revisits so the transient states (status / empty) are rare. */
.qa-similar-wrap[hidden]{ display:none; }
.qa-similar-status{
    display:flex;
    align-items:center;
    gap:8px;
    padding:6px 2px;
    font-size:12px;
    color:var(--qa-text-soft);
}
.qa-similar-status[hidden]{ display:none; }
.qa-similar-empty{
    padding:6px 2px;
    font-size:12px;
    color:var(--qa-muted);
}
.qa-similar-empty[hidden]{ display:none; }
.qa-similar-list{
    list-style:none;
    margin:6px 0 0 0;
    padding:0;
    display:flex;
    flex-direction:column;
    gap:6px;
    max-height:320px;
    overflow-y:auto;
    overscroll-behavior:contain;
}
.qa-similar-list[hidden]{ display:none; }
.qa-similar-item a{
    display:flex;
    flex-direction:column;
    gap:2px;
    padding:8px 10px;
    background:var(--qa-surface-2);
    border:1px solid var(--qa-border);
    border-radius:8px;
    text-decoration:none;
    color:var(--qa-text);
    transition:background 120ms, border-color 120ms;
}
.qa-similar-item a:hover{
    background:var(--qa-brand-tint);
    border-color:var(--qa-brand);
}
.qa-similar-row-top{
    display:flex;
    align-items:center;
    gap:6px;
    font-size:11px;
}
.qa-similar-id{
    font-weight:600;
    color:var(--qa-brand);
}
.qa-similar-badge{
    padding:1px 6px;
    border-radius:10px;
    background:var(--qa-surface-inset);
    color:var(--qa-text-soft);
    font-size:10px;
    font-weight:600;
    letter-spacing:.02em;
    text-transform:uppercase;
}
.qa-similar-score{
    margin-left:auto;
    font-variant-numeric:tabular-nums;
    font-size:11px;
    font-weight:600;
    color:var(--qa-text-soft);
}
.qa-similar-subject{
    font-size:13px;
    line-height:1.35;
    color:var(--qa-text);
    display:-webkit-box;
    -webkit-line-clamp:2;
    line-clamp:2;
    -webkit-box-orient:vertical;
    overflow:hidden;
}
.qa-similar-meta{
    font-size:11px;
    color:var(--qa-muted);
}
.qa-similar-actions{
    display:flex;
    gap:6px;
    margin-top:8px;
}
.qa-similar-actions .qa-btn{ flex:1; }
.qa-similar-actions #qa-similar-more[hidden],
.qa-similar-actions #qa-similar-show-all[hidden]{ display:none; }
/* Below-threshold candidates revealed via "Show all" — visually de-emphasised. */
.qa-similar-item-low a{ opacity:0.62; }
.qa-similar-item-low a:hover{ opacity:1; }

/* Copy button injected beside the Redmine issue header <h2>Bug #NNNN</h2>. */
/* Lives outside #qa-panel scope — pure static styling, no CSS variables. */
.qa-issue-copy-btn{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    vertical-align:middle;
    margin-left:10px;
    padding:4px 6px;
    background:transparent;
    border:1px solid rgba(0,0,0,0.18);
    border-radius:6px;
    color:#555;
    cursor:pointer;
    line-height:1;
    transition:background 120ms ease,border-color 120ms ease,color 120ms ease;
}
.qa-issue-copy-btn svg{ width:15px; height:15px; stroke:currentColor; }
.qa-issue-copy-btn:hover{ background:rgba(0,0,0,0.05); border-color:rgba(0,0,0,0.3); color:#111; }
.qa-issue-copy-btn:active{ background:rgba(0,0,0,0.09); }
.qa-issue-copy-btn:focus-visible{ outline:2px solid #4f8cff; outline-offset:2px; }

/* Author name appended to each row of Redmine's native "Related issues"
   table — fetched separately since that table has no author column. */
.qa-relation-author{
    color:#767676;
    font-size:12px;
    font-style:italic;
    margin-left:4px;
}
.qa-relation-author strong{
    font-weight:700;
    color:#444;
}

/* ---------- Attachment lightbox (issue detail pages) ----------
   Lives outside #qa-panel scope — pure static styling. Intercepts clicks
   on image/video attachment links so users can flip through them without
   leaving the issue detail page. */
.qa-lightbox-overlay{
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.82);
    z-index:2147483647;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:40px;
    opacity:0;
    transition:opacity .15s ease;
}
.qa-lightbox-overlay[hidden]{ display:none; }
.qa-lightbox-overlay.qa-lightbox-open-state{ opacity:1; }
.qa-lightbox-stage{
    position:relative;
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:12px;
    max-width:100%;
    max-height:100%;
}
.qa-lightbox-media{
    position:relative;
    display:grid;
    place-items:center;
    max-width:calc(100vw - 40px);
    max-height:calc(100vh - 40px);
    overflow:hidden;
    cursor:default;
}
.qa-lightbox-media.qa-lightbox-zoomed{ cursor:grab; }
.qa-lightbox-media.qa-lightbox-zoomed.qa-lightbox-dragging{ cursor:grabbing; }
.qa-lightbox-zoomable{
    display:grid;
    place-items:center;
    width:100%;
    height:100%;
    will-change:transform;
}
.qa-lightbox-zoomable img,
.qa-lightbox-zoomable video{
    grid-area:1 / 1;
    width:100%;
    height:100%;
    object-fit:contain;
    border-radius:6px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);
    display:block;
    pointer-events:none;
}
/* Instant, already-cached thumbnail shown blurred while the full-res image
   decodes off-screen, then cross-faded out — see qaLightboxShow(). */
.qa-lightbox-placeholder{
    filter:blur(6px) brightness(0.85);
    transform:scale(1.03);
}
.qa-lightbox-full{
    opacity:0;
    transition:opacity .22s ease;
}
.qa-lightbox-full.qa-lightbox-full-in{ opacity:1; }
.qa-lightbox-media.qa-lightbox-loading::after{
    content:"";
    position:absolute;
    top:50%;
    left:50%;
    width:28px;
    height:28px;
    margin:-14px 0 0 -14px;
    border-radius:50%;
    border:3px solid rgba(255,255,255,.25);
    border-top-color:#fff;
    animation:qa-lightbox-spin .7s linear infinite;
    pointer-events:none;
}
@keyframes qa-lightbox-spin{ to{ transform:rotate(360deg); } }
.qa-lightbox-close{
    position:absolute;
    top:-36px;
    right:-8px;
    width:32px;
    height:32px;
    border:0;
    border-radius:50%;
    background:rgba(255,255,255,.12);
    color:#fff;
    font-size:20px;
    line-height:1;
    cursor:pointer;
    transition:background .15s ease;
}
.qa-lightbox-close:hover{ background:rgba(255,255,255,.24); }
.qa-lightbox-nav{
    position:absolute;
    top:50%;
    transform:translateY(-50%);
    width:44px;
    height:44px;
    border:0;
    border-radius:50%;
    background:rgba(255,255,255,.12);
    color:#fff;
    font-size:26px;
    line-height:1;
    cursor:pointer;
    transition:background .15s ease;
}
.qa-lightbox-nav:hover{ background:rgba(255,255,255,.24); }
.qa-lightbox-nav[hidden]{ display:none; }
.qa-lightbox-prev{ left:-56px; }
.qa-lightbox-next{ right:-56px; }
/* Fixed to the viewport (not the stage) so it stays put regardless of how
   big the media box grows/shrinks with zoom. */
.qa-lightbox-caption{
    position:fixed;
    left:50%;
    bottom:18px;
    transform:translateX(-50%);
    display:flex;
    align-items:center;
    gap:12px;
    color:#eee;
    font-size:13px;
    max-width:min(90vw, 1100px);
    width:max-content;
    padding:8px 16px;
    background:rgba(20,20,20,.78);
    border-radius:10px;
    z-index:1;
}
.qa-lightbox-name{
    flex:1 1 auto;
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
}
.qa-lightbox-zoom-controls{
    display:flex;
    align-items:center;
    gap:6px;
    flex:0 0 auto;
}
.qa-lightbox-zoom-controls[hidden]{ display:none; }
.qa-lightbox-zoom-controls button{
    width:22px;
    height:22px;
    border:0;
    border-radius:50%;
    background:rgba(255,255,255,.14);
    color:#fff;
    font-size:15px;
    line-height:1;
    cursor:pointer;
    transition:background .15s ease;
}
.qa-lightbox-zoom-controls button:hover{ background:rgba(255,255,255,.26); }
.qa-lightbox-zoom-controls button:disabled{ opacity:.4; cursor:default; }
.qa-lightbox-zoom-level{
    min-width:36px;
    text-align:center;
    font-variant-numeric:tabular-nums;
    font-size:11px;
    color:#ccc;
}
.qa-lightbox-open{
    color:#8ab4ff;
    text-decoration:none;
    flex:0 0 auto;
}
.qa-lightbox-open:hover{ text-decoration:underline; }
@media (max-width: 900px){
    .qa-lightbox-prev{ left:4px; }
    .qa-lightbox-next{ right:4px; }
}
@media (prefers-reduced-motion: reduce){
    .qa-lightbox-overlay{ transition:none; }
    .qa-lightbox-full{ transition:none; }
    .qa-lightbox-media.qa-lightbox-loading::after{ animation:none; }
}

/* ---------- QA Daily Report widget (injected on agile board pages) ---------- */
/* Lives outside #qa-panel scope — static tokens so it renders correctly on
   Redmine's own light/dark themes without depending on our CSS variables. */
.qa-board-daily{
    position:relative;
    display:flex;
    align-items:stretch;
    gap:10px;
    margin:12px 0 16px;
    padding:10px 14px;
    background:rgba(79,140,255,0.08);
    border:1px solid rgba(79,140,255,0.25);
    border-radius:10px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    color:#1a1a1a;
    font-size:13px;
    line-height:1.5;
    overflow:hidden;
}
.qa-board-daily-content{
    flex:0 1 auto;
    min-width:0;
    display:flex;
    flex-direction:column;
}
.qa-board-daily-top{
    display:flex;
    align-items:center;
    gap:8px;
    flex-wrap:wrap;
    margin-bottom:4px;
}
.qa-board-daily-title{
    background:transparent;
    border:0;
    padding:0;
    margin:0;
    font-weight:700;
    color:#4f8cff;
    letter-spacing:.04em;
    text-transform:uppercase;
    font-size:11px;
    font-family:inherit;
    cursor:pointer;
}
.qa-board-daily-title:hover{ text-decoration:underline; }
.qa-board-daily-window,
.qa-board-daily-total{
    color:#1a1a1a;
    font-size:12px;
}
.qa-board-daily-total{ cursor:help; }
.qa-board-daily-total strong{
    color:#000;
    font-size:14px;
    margin-right:2px;
    font-variant-numeric:tabular-nums;
}
.qa-board-daily-sep{
    color:#888;
    font-size:12px;
    user-select:none;
}
.qa-board-daily-copy,
.qa-board-daily-refresh{
    background:transparent;
    border:1px solid rgba(0,0,0,0.25);
    border-radius:6px;
    padding:2px 8px;
    font-size:14px;
    line-height:1;
    color:#1a1a1a;
    cursor:pointer;
}
.qa-board-daily-copy{ padding:2px 6px; }
.qa-board-daily-actions{
    flex:0 0 auto;
    display:flex;
    align-items:center;
    gap:6px;
}
.qa-board-daily-pet-toggle{
    display:inline-flex;
    align-items:center;
    gap:4px;
    color:#555;
    font-size:11px;
    user-select:none;
    cursor:pointer;
}
.qa-board-daily-pet-toggle input{
    width:12px;
    height:12px;
    margin:0;
    cursor:pointer;
    accent-color:#4f8cff;
}
.qa-board-daily-copy:hover,
.qa-board-daily-refresh:hover{
    background:rgba(0,0,0,0.05);
    border-color:rgba(0,0,0,0.3);
    color:#111;
}
.qa-board-daily-refresh:disabled{
    opacity:0.5;
    cursor:default;
}
.qa-board-daily-chips{
    display:flex;
    flex-wrap:wrap;
    align-items:baseline;
    gap:6px;
    min-height:20px;
}
.qa-board-daily-chip{
    display:inline-flex;
    align-items:baseline;
    gap:4px;
    color:#1a1a1a;
    text-decoration:none;
}
a.qa-board-daily-chip:hover{ text-decoration:underline; }
.qa-board-daily-name{ font-weight:500; }
.qa-board-daily-count{
    font-variant-numeric:tabular-nums;
    color:#4f8cff;
    font-weight:700;
}
.qa-board-daily-chip-empty .qa-board-daily-count{
    color:#666;
    font-weight:600;
}
.qa-board-daily-crown{
    font-size:12px;
    margin-right:3px;
    filter:saturate(0.9);
}
.qa-board-daily-chip-self{
    background:rgba(79,140,255,0.15);
    border:1px solid rgba(79,140,255,0.4);
    border-radius:999px;
    padding:1px 10px;
    font:inherit;
    color:#1a1a1a;
    cursor:pointer;
}
.qa-board-daily-chip-self:hover{ background:rgba(79,140,255,0.25); }
.qa-board-daily-empty{
    color:#333;
    font-style:italic;
}
.qa-board-daily-chip-skel{
    display:inline-block;
    width:72px; height:14px;
    border-radius:7px;
    background:linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.14), rgba(0,0,0,0.06));
    background-size:200% 100%;
    animation:qa-board-daily-shimmer 1.2s linear infinite;
}
@keyframes qa-board-daily-shimmer{
    0%{ background-position:200% 0; }
    100%{ background-position:-200% 0; }
}
.qa-board-daily-cat{
    flex:1 1 auto;
    min-width:80px;
    align-self:stretch;
    position:relative;
    overflow:hidden;
    opacity:0.95;
    pointer-events:none;
}
.qa-cat-walker{
    position:absolute;
    top:50%;
    left:0;
    width:48px;
    height:36px;
    margin-top:-18px;
    will-change:transform;
}
.qa-cat-sprite{
    position:relative;
    width:100%;
    height:100%;
    will-change:transform;
}
.qa-cat-svg{
    display:block;
    width:48px;
    height:36px;
    image-rendering:pixelated;
    shape-rendering:crispEdges;
}
.qa-cat-tail-sit,
.qa-cat-paws-sit,
.qa-cat-front{ display:none; }
.qa-cat-sprite.qa-cat-sit .qa-cat-side,
.qa-cat-sprite.qa-cat-sit .qa-cat-tail-walk,
.qa-cat-sprite.qa-cat-sit .qa-cat-legs-walk{ display:none; }
.qa-cat-sprite.qa-cat-sit .qa-cat-front,
.qa-cat-sprite.qa-cat-sit .qa-cat-tail-sit,
.qa-cat-sprite.qa-cat-sit .qa-cat-paws-sit{ display:block; }

.qa-cat-sprite.qa-cat-walk .qa-cat-svg{ animation:qa-cat-bob 0.5s ease-in-out infinite; }
.qa-cat-sprite.qa-cat-walk .qa-cat-tail-walk{
    transform-origin:5px 12px;
    transform-box:fill-box;
    animation:qa-cat-tail-wag 0.6s ease-in-out infinite;
}
.qa-cat-sprite.qa-cat-walk .qa-cat-leg-a{
    transform-box:fill-box;
    animation:qa-cat-leg-a 0.4s ease-in-out infinite;
}
.qa-cat-sprite.qa-cat-walk .qa-cat-leg-b{
    transform-box:fill-box;
    animation:qa-cat-leg-b 0.4s ease-in-out infinite;
}

.qa-cat-sprite.qa-cat-idle .qa-cat-svg{ animation:qa-cat-breathe 3.5s ease-in-out infinite; }
.qa-cat-sprite.qa-cat-idle .qa-cat-tail-walk{
    transform-origin:5px 12px;
    transform-box:fill-box;
    animation:qa-cat-tail-sway 2.2s ease-in-out infinite;
}
.qa-cat-sprite.qa-cat-idle .qa-cat-eyes{ animation:qa-cat-blink 4.5s steps(1,end) infinite; }

.qa-cat-sprite.qa-cat-sit .qa-cat-svg{ animation:qa-cat-breathe 3.5s ease-in-out infinite; }
.qa-cat-sprite.qa-cat-sit .qa-cat-tail-sit{
    transform-origin:6px 18px;
    transform-box:fill-box;
    animation:qa-cat-tail-flick 2s ease-in-out infinite;
}
.qa-cat-sprite.qa-cat-sit .qa-cat-eyes{ animation:qa-cat-blink 5.5s steps(1,end) infinite; }

.qa-cat-sprite.qa-cat-jump{ animation:qa-cat-hop 0.9s cubic-bezier(0.3,0,0.5,1) both; }

@keyframes qa-cat-bob{
    0%,100%{ transform:translateY(0); }
    50%    { transform:translateY(-1px); }
}
@keyframes qa-cat-breathe{
    0%,100%{ transform:scaleY(1); }
    50%    { transform:scaleY(0.97); }
}
@keyframes qa-cat-tail-wag{
    0%,100%{ transform:rotate(-15deg); }
    50%    { transform:rotate(20deg); }
}
@keyframes qa-cat-tail-sway{
    0%,100%{ transform:rotate(-5deg); }
    50%    { transform:rotate(8deg); }
}
@keyframes qa-cat-tail-flick{
    0%,80%,100%{ transform:rotate(0deg); }
    88%        { transform:rotate(-10deg); }
    94%        { transform:rotate(6deg); }
}
@keyframes qa-cat-leg-a{
    0%,100%{ transform:translateY(0); }
    50%    { transform:translateY(-1px); }
}
@keyframes qa-cat-leg-b{
    0%,100%{ transform:translateY(-1px); }
    50%    { transform:translateY(0); }
}
@keyframes qa-cat-hop{
    0%   { transform:translateY(0); }
    35%  { transform:translateY(-14px); }
    55%  { transform:translateY(-14px); }
    100% { transform:translateY(0); }
}
@keyframes qa-cat-blink{
    0%,92%,100%{ opacity:1; }
    95%        { opacity:0.15; }
}
@media (prefers-reduced-motion: reduce){
    .qa-cat-sprite,
    .qa-cat-sprite *{ animation:none !important; }
}

/* Weekly leaderboard + Tester dashboard modals */
.qa-board-daily-modal-overlay{
    position:fixed; inset:0;
    background:rgba(0,0,0,0.45);
    z-index:2147483000;
    display:flex; align-items:center; justify-content:center;
    padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
}
.qa-board-daily-modal{
    background:#fff;
    color:#1a1a1a;
    border-radius:12px;
    box-shadow:0 20px 60px rgba(0,0,0,0.35);
    max-width:920px; width:100%; max-height:88vh;
    display:flex; flex-direction:column;
    overflow:hidden;
}
.qa-board-daily-modal-head{
    display:flex; align-items:center; gap:12px;
    padding:14px 18px;
    border-bottom:1px solid rgba(0,0,0,0.08);
}
.qa-board-daily-modal-title{
    font-size:15px; font-weight:700;
    flex:1;
}
.qa-board-daily-modal-close{
    background:transparent; border:0;
    font-size:22px; line-height:1;
    cursor:pointer; color:#666;
    padding:0 4px;
}
.qa-board-daily-modal-close:hover{ color:#111; }
.qa-board-daily-modal-body{
    padding:16px 18px;
    overflow:auto;
    font-size:13px;
}
.qa-board-daily-week-table{
    width:100%;
    border-collapse:separate;
    border-spacing:4px;
    font-variant-numeric:tabular-nums;
}
.qa-board-daily-week-table th,
.qa-board-daily-week-table td{
    padding:6px 8px;
    text-align:center;
    background:rgba(0,0,0,0.03);
    border-radius:6px;
    font-size:13px;
}
.qa-board-daily-week-table th{
    background:transparent;
    font-weight:600;
    color:#555;
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.04em;
}
.qa-board-daily-week-table td.qa-board-daily-week-today{
    outline:2px solid rgba(79,140,255,0.55);
}
.qa-board-daily-week-name{
    text-align:left !important;
    font-weight:500;
}
.qa-board-daily-week-total{
    font-weight:700;
    color:#4f8cff;
}
.qa-board-daily-week-footnote{
    margin-top:10px;
    font-size:11px;
    color:#888;
    line-height:1.5;
}
.qa-board-daily-me-summary{
    display:flex; align-items:center; gap:10px;
    margin-bottom:12px;
    font-size:13px;
    flex-wrap:wrap;
}
.qa-board-daily-me-summary strong{
    color:#4f8cff;
    font-size:16px;
    font-variant-numeric:tabular-nums;
}
.qa-board-daily-me-copy{
    margin-left:auto;
    background:#4f8cff;
    color:#fff;
    border:0;
    border-radius:6px;
    padding:6px 12px;
    font-size:12px;
    font-weight:500;
    cursor:pointer;
}
.qa-board-daily-me-copy:hover{ background:#3a76e6; }
.qa-board-daily-me-table{
    width:100%;
    border-collapse:collapse;
    font-size:13px;
}
.qa-board-daily-me-table th{
    text-align:left;
    padding:6px 8px;
    border-bottom:2px solid rgba(0,0,0,0.1);
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.04em;
    color:#555;
}
.qa-board-daily-me-table td{
    padding:8px;
    border-bottom:1px solid rgba(0,0,0,0.06);
}
.qa-board-daily-me-table a{
    color:#4f8cff;
    text-decoration:none;
    font-weight:500;
}
.qa-board-daily-me-table a:hover{ text-decoration:underline; }
.qa-board-daily-me-subject{
    max-width:420px;
    word-break:break-word;
}
.qa-board-daily-me-empty{
    text-align:center;
    color:#888;
    padding:20px !important;
    font-style:italic;
}

/* Sprint audit modal (v7.2.0). Mirrors the reopened-issues modal chrome
   and adds section-based report styling. */
#qa-audit-modal .qa-modal.qa-audit-modal{
    width:min(760px, 100%);
    max-height:calc(100vh - 64px);
}
.qa-audit-loading{
    display:flex;
    align-items:center;
    gap:10px;
    padding:32px 16px;
    color:var(--qa-text);
    font-size:13px;
    opacity:0.8;
}
.qa-audit-loading[hidden]{ display:none; }
.qa-audit-report{
    padding:0 4px;
}
.qa-audit-section{
    margin-bottom:18px;
}
.qa-audit-section h3{
    margin:0 0 8px 0;
    font-size:14px;
    font-weight:600;
    letter-spacing:0.02em;
    color:var(--qa-text);
}
.qa-audit-section p{
    margin:0 0 6px 0;
    font-size:13px;
    color:var(--qa-text);
}
.qa-audit-verdict-line{
    font-size:14px;
    padding:8px 12px;
    border-radius:6px;
}
.qa-audit-verdict-yes{
    background:rgba(34,197,94,0.10);
    color:#166534;
}
.qa-audit-verdict-no{
    background:rgba(239,68,68,0.10);
    color:#991b1b;
}
.qa-modal-overlay.qa-dark .qa-audit-verdict-yes{ color:#86efac; background:rgba(34,197,94,0.14); }
.qa-modal-overlay.qa-dark .qa-audit-verdict-no{  color:#fca5a5; background:rgba(239,68,68,0.14); }
.qa-audit-verdict-list{
    list-style:none;
    margin:8px 0 0 0;
    padding:0;
}
.qa-audit-verdict-list li{
    padding:4px 0;
    font-size:13px;
    line-height:1.5;
}
.qa-audit-blocker{ color:#991b1b; }
.qa-audit-warning{ color:#92400e; }
.qa-modal-overlay.qa-dark .qa-audit-blocker{ color:#fca5a5; }
.qa-modal-overlay.qa-dark .qa-audit-warning{ color:#fcd34d; }
.qa-audit-ids a{
    color:inherit;
    text-decoration:none;
    margin:0 2px;
    font-weight:500;
}
.qa-audit-ids a:hover{ text-decoration:underline; }
.qa-audit-see-more{
    background:transparent;
    border:0;
    padding:0 2px;
    margin:0;
    color:inherit;
    font:inherit;
    font-weight:500;
    text-decoration:underline;
    cursor:pointer;
    opacity:0.85;
}
.qa-audit-see-more:hover{ opacity:1; }
.qa-audit-table{
    width:100%;
    border-collapse:collapse;
    font-size:13px;
    margin-top:4px;
}
.qa-audit-table th,
.qa-audit-table td{
    padding:5px 8px;
    border-bottom:1px solid rgba(0,0,0,0.06);
    text-align:right;
    color:var(--qa-text);
}
.qa-audit-table th{
    font-weight:600;
    opacity:0.7;
    font-size:12px;
}
.qa-audit-table th:first-child,
.qa-audit-table td:first-child{ text-align:left; }
.qa-modal-overlay.qa-dark .qa-audit-table th,
.qa-modal-overlay.qa-dark .qa-audit-table td{ border-color:rgba(255,255,255,0.08); }
.qa-audit-list{
    list-style:none;
    margin:0;
    padding:0;
    max-height:180px;
    overflow-y:auto;
    font-size:13px;
}
.qa-audit-list li{
    padding:3px 0;
    color:var(--qa-text);
    line-height:1.5;
}
.qa-audit-list a{
    color:var(--qa-brand, #4f8cff);
    text-decoration:none;
    font-weight:500;
    margin-right:4px;
}
.qa-audit-list a:hover{ text-decoration:underline; }
.qa-audit-subtle{
    color:#64748b;
    font-size:12px;
    font-weight:400;
    margin-left:6px;
}
.qa-modal-overlay.qa-dark .qa-audit-subtle{ color:#94a3b8; }
.qa-audit-partial{
    color:#92400e;
    font-size:11px;
    font-weight:500;
    margin-left:4px;
}
.qa-modal-overlay.qa-dark .qa-audit-partial{ color:#fcd34d; }
.qa-audit-partial-banner{
    background:#fef3c7;
    border:1px solid #fcd34d;
    color:#78350f;
    border-radius:6px;
    padding:10px 12px;
    margin-bottom:14px;
    font-size:12px;
    line-height:1.5;
}
.qa-audit-partial-banner strong{ color:#78350f; }
.qa-modal-overlay.qa-dark .qa-audit-partial-banner{
    background:rgba(252, 211, 77, 0.12);
    border-color:rgba(252, 211, 77, 0.45);
    color:#fde68a;
}
.qa-modal-overlay.qa-dark .qa-audit-partial-banner strong{ color:#fef3c7; }
.qa-audit-tally{
    font-size:13px;
    color:var(--qa-text);
    line-height:1.8;
}
.qa-audit-toggle{
    display:inline-flex;
    align-items:center;
    gap:6px;
    margin-right:auto;
    font-size:12px;
    color:var(--qa-text);
    opacity:0.85;
    cursor:pointer;
    user-select:none;
}
.qa-audit-toggle input{ accent-color:var(--qa-brand, #4f8cff); }
.qa-audit-toggle[hidden]{ display:none; }
`;
    document.head.appendChild(style);

    //////////////////////////////////////////////////////
    // Auto Fill After Navigation
    //////////////////////////////////////////////////////

    function autoFillIfNeeded(tries = 0) {
        // Only auto-fill on the NEW issue form. An existing issue's edit form also
        // has #issue_description, so without this guard auto-fill would overwrite
        // real issue content when editing.
        if (!/\/issues\/new\/?$/.test(location.pathname)) return;

        const project = sessionStorage.getItem(STORAGE.project);
        if (!project) return;

        if (!document.getElementById("issue_description")) {
            if (tries >= MAX_AUTOFILL_TRIES) {
                sessionStorage.removeItem(STORAGE.project);
                return;
            }
            setTimeout(() => autoFillIfNeeded(tries + 1), 300);
            return;
        }

        fillIssue(project);
        // Project key is kept in sessionStorage so manual Fill (Alt+F) reuses the
        // assignee. Uncomment below if you prefer a clean slate after auto-fill:
        // sessionStorage.removeItem(STORAGE.project);
    }

    //////////////////////////////////////////////////////
    // Bulk Checklist Add
    //////////////////////////////////////////////////////

    // Redmine's checklists plugin only lets you save ONE item at a time (type
    // → click "+"). For long test cases this is tedious, so we inject a small
    // textarea + "Add all" button inside the Checklist section. On click we
    // split the pasted lines and drive the plugin's own save button once per
    // line, keeping the plugin's id / position bookkeeping intact.
    function mountChecklistBulkAdd() {
        if (location.origin !== REDMINE) return;
        const list = document.getElementById("checklist_form_items");
        if (!list) return;
        const par = list.closest("p#checklist_form") || list.parentElement;
        if (!par || par.dataset.qaBulk === "1") return;
        par.dataset.qaBulk = "1";

        const wrap = document.createElement("span");
        wrap.className = "qa-checklist-bulk";
        wrap.innerHTML =
            '<textarea class="qa-checklist-bulk-input" rows="2" ' +
            'placeholder="Paste multiple checklist items \u2014 one per line \u2014 then click Add all"></textarea>' +
            '<button type="button" class="qa-checklist-bulk-btn" title="Add every non-empty line as a separate checklist item">Add all</button>';
        par.appendChild(wrap);

        const input = wrap.querySelector(".qa-checklist-bulk-input");
        const btn   = wrap.querySelector(".qa-checklist-bulk-btn");
        btn.addEventListener("click", () => {
            const lines = input.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            if (!lines.length) { toast("Nothing to add"); input.focus(); return; }
            let added = 0;
            for (const line of lines) {
                if (qaAddChecklistItem(line)) added++;
            }
            input.value = "";
            input.focus();
            toast("Added " + added + " checklist item" + (added === 1 ? "" : "s"));
            console.info("[QA Assistant] Bulk added " + added + " checklist item(s).");
        });
    }

    // Fills the trailing empty checklist row with `text` and clicks Redmine's
    // own "+" save button so the plugin commits the row and appends a fresh
    // blank one for the next line.
    function qaAddChecklistItem(text) {
        const list = document.getElementById("checklist_form_items");
        if (!list) return false;
        const rows = list.querySelectorAll(".checklist-item");
        if (!rows.length) return false;
        const target = rows[rows.length - 1];
        const box = target.querySelector(".edit-box");
        if (!box) return false;
        const hidden = target.querySelector(".checklist-subject-hidden");
        box.value = text;
        if (hidden) hidden.value = text;
        // Some builds of the plugin read the subject from input/change; fire
        // both before the click so the value is definitely captured.
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        const save = target.querySelector(".save-new-by-button");
        if (save) save.click();
        return true;
    }

    // Redmine replaces the whole issue form over AJAX when the tracker <select>
    // changes, wiping any prior mount. Watch the content area and re-mount.
    function observeChecklistSection() {
        if (location.origin !== REDMINE) return;
        const root = document.getElementById("content") || document.body;
        if (!root) return;
        mountChecklistBulkAdd();
        const mo = new MutationObserver(() => mountChecklistBulkAdd());
        mo.observe(root, { childList: true, subtree: true });
    }

    //////////////////////////////////////////////////////
    // Issue-header copy button (issue detail page)
    //////////////////////////////////////////////////////

    // Injects a small copy button next to the "Bug #NNNN" h2 on issue detail
    // pages. Clipboard receives Markdown: bolded tracker+id, subject, then the
    // canonical issue URL on the next line.
    function mountIssueLinkCopyButton() {
        if (location.origin !== REDMINE) return;
        if (!isIssueDetailPage()) return;
        const h2 = document.querySelector("#content h2");
        if (!h2 || h2.dataset.qaCopy === "1") return;
        const header = (h2.textContent || "").trim().replace(/\s+/g, " ");
        const idMatch = location.pathname.match(/\/issues\/(\d+)/);
        if (!header || !idMatch) return;
        h2.dataset.qaCopy = "1";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "qa-issue-copy-btn";
        btn.title = "Copy issue title and link";
        btn.setAttribute("aria-label", "Copy issue title and link");
        btn.innerHTML = svgIcon("copy");
        h2.appendChild(document.createTextNode(" "));
        h2.appendChild(btn);

        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const subjEl = document.querySelector(".subject h3, .subject > div > h3");
            const subject = subjEl ? subjEl.textContent.trim().replace(/\s+/g, " ") : "";
            const url = REDMINE + "/issues/" + idMatch[1];
            const payload = subject
                ? "*" + header + "* : " + subject + "\n" + url
                : "*" + header + "*\n" + url;
            try {
                await navigator.clipboard.writeText(payload);
                toast("Issue copied to clipboard");
            } catch (_) {
                toast("Copy failed — clipboard blocked");
            }
        });
    }

    // Some themes rerender the h2 late; a light observer re-mounts if needed.
    function observeIssueHeader() {
        if (location.origin !== REDMINE) return;
        if (!isIssueDetailPage()) return;
        mountIssueLinkCopyButton();
        const root = document.getElementById("content") || document.body;
        if (!root) return;
        const mo = new MutationObserver(() => mountIssueLinkCopyButton());
        mo.observe(root, { childList: true, subtree: true });
    }

    // Related issues table is native Redmine markup with no author column —
    // one lightweight JSON fetch per related issue fills it in inline.
    function mountRelatedIssueAuthors() {
        if (location.origin !== REDMINE) return;
        if (!isIssueDetailPage()) return;
        const rows = document.querySelectorAll("#relations table.list.issues tr[id^='relation-']");
        rows.forEach(tr => {
            if (tr.dataset.qaAuthor === "1") return;
            const subjectCell = tr.querySelector("td.subject");
            const link = subjectCell && subjectCell.querySelector("a.issue[href*='/issues/']");
            if (!link) return;
            const m = link.getAttribute("href").match(/\/issues\/(\d+)/);
            if (!m) return;
            tr.dataset.qaAuthor = "1";
            // Plain HTML fetch, not `.json` — Redmine's REST API can answer an
            // unrecognised session with a Basic-Auth challenge, which pops a
            // native browser login dialog. An HTML request just redirects.
            fetch(REDMINE + "/issues/" + m[1], { credentials: "include", headers: { "Accept": "text/html" } })
                .then(res => res.ok ? res.text() : null)
                .then(html => {
                    if (!html || !subjectCell.isConnected) return;
                    const doc = new DOMParser().parseFromString(html, "text/html");
                    const authorLink = doc.querySelector(".author a.user");
                    const author = authorLink ? authorLink.textContent.trim() : "";
                    if (!author) return;
                    const span = document.createElement("span");
                    span.className = "qa-relation-author";
                    span.append("— ");
                    const strong = document.createElement("strong");
                    strong.textContent = author;
                    span.appendChild(strong);
                    subjectCell.appendChild(span);
                })
                .catch(() => {});
        });
    }

    // Redmine re-renders this table via AJAX on add/remove relation.
    function observeRelatedIssues() {
        if (location.origin !== REDMINE) return;
        if (!isIssueDetailPage()) return;
        mountRelatedIssueAuthors();
        const root = document.getElementById("relations") || document.getElementById("content") || document.body;
        if (!root) return;
        const mo = new MutationObserver(() => mountRelatedIssueAuthors());
        mo.observe(root, { childList: true, subtree: true });
    }

    //////////////////////////////////////////////////////
    // Attachment lightbox (issue detail pages)
    //////////////////////////////////////////////////////

    const ATTACHMENT_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
    const ATTACHMENT_VIDEO_EXT_RE = /\.(mp4|mov|webm|ogv|ogg|avi|mkv|m4v)$/i;
    const ATTACHMENT_LINK_SELECTOR = ".attachments p a.icon-attachment, .attachments .thumbnails a, #history a[href*='/attachments/']";

    function attachmentTypeFromHref(href) {
        const name = decodeURIComponent((href || "").split("/").pop() || "").split("?")[0];
        if (ATTACHMENT_IMAGE_EXT_RE.test(name)) return { type: "image", name: name };
        if (ATTACHMENT_VIDEO_EXT_RE.test(name)) return { type: "video", name: name };
        return null;
    }

    // Every previewable attachment on the page, de-duped by id (the same
    // file is usually linked twice — list + thumbnail) so Prev/Next hits
    // each one exactly once.
    function collectAttachmentItems() {
        const seen = new Set();
        const items = [];
        document.querySelectorAll(ATTACHMENT_LINK_SELECTOR).forEach(a => {
            const href = a.getAttribute("href") || "";
            const m = href.match(/\/attachments\/(?:download\/)?(\d+)\b/);
            if (!m) return;
            const id = m[1];
            if (seen.has(id)) return;
            const info = attachmentTypeFromHref(href);
            if (!info) return;
            seen.add(id);
            items.push({
                id: id, href: toRedmineAbs(href), name: info.name, type: info.type,
                // Redmine always generates this — used as an instant blurred
                // placeholder while the full-res image loads (see qaLightboxShow).
                thumbHref: info.type === "image" ? toRedmineAbs("/attachments/thumbnail/" + id) : null
            });
        });
        return items;
    }

    let qaLightboxEl = null;
    let qaLightboxItems = [];
    let qaLightboxIndex = 0;
    let qaLightboxZoom = 1;
    let qaLightboxPanX = 0;
    let qaLightboxPanY = 0;
    let qaLightboxDragging = false;
    let qaLightboxDragStartX = 0;
    let qaLightboxDragStartY = 0;
    let qaLightboxPanStartX = 0;
    let qaLightboxPanStartY = 0;
    // Natural size of the current image fitted to the default viewer box at
    // zoom 1 (i.e. what the plain <img> would render at). Drives how far the
    // box itself can grow before zoom has to fall back to scale+pan.
    let qaLightboxBaseW = 0;
    let qaLightboxBaseH = 0;
    const LIGHTBOX_ZOOM_MIN = 1;
    const LIGHTBOX_ZOOM_MAX = 5;
    const LIGHTBOX_ZOOM_STEP = 0.5;
    const LIGHTBOX_ZOOM_WHEEL_STEP = 0.2;

    // Two tiers: "comfort" is the cosy default box a plain <img> would fit
    // into at zoom 1 (unchanged from before); "hard" is the true ceiling —
    // near-fullscreen — the box is allowed to grow into as zoom increases.
    // Using the SAME value for both would make zoomAtMax collapse to ~1 for
    // any image that already needs to shrink to fit at 100% (the common
    // case for full-size screenshots), leaving no visible room to grow.
    function qaLightboxLimits() {
        return {
            comfortW: Math.min(window.innerWidth * 0.9, 1100),
            comfortH: Math.max(120, window.innerHeight - 140),
            hardW: Math.max(200, window.innerWidth - 160),
            hardH: Math.max(200, window.innerHeight - 160)
        };
    }

    // Figures out how much the viewer box itself can grow for the current
    // zoom level before it's maxed out at the available viewport space —
    // past that point the box stays maxed and the image scales+pans inside it.
    function qaLightboxGeometry() {
        const lim = qaLightboxLimits();
        if (!qaLightboxBaseW || !qaLightboxBaseH) {
            return { boxW: lim.comfortW, boxH: lim.comfortH, overflowFactor: 1, known: false };
        }
        const zoomAtMax = Math.max(LIGHTBOX_ZOOM_MIN, Math.min(lim.hardW / qaLightboxBaseW, lim.hardH / qaLightboxBaseH));
        if (qaLightboxZoom <= zoomAtMax) {
            return { boxW: qaLightboxBaseW * qaLightboxZoom, boxH: qaLightboxBaseH * qaLightboxZoom, overflowFactor: 1, known: true };
        }
        return {
            boxW: Math.min(qaLightboxBaseW * zoomAtMax, lim.hardW),
            boxH: Math.min(qaLightboxBaseH * zoomAtMax, lim.hardH),
            overflowFactor: qaLightboxZoom / zoomAtMax,
            known: true
        };
    }

    // Reads the loaded image/video's natural size and derives its zoom-1 fit
    // size against the default (comfort) box — the starting point
    // qaLightboxGeometry() grows from. Re-applies the current transform once known.
    function qaLightboxCaptureBase(el) {
        const nw = el.naturalWidth || el.videoWidth || 0;
        const nh = el.naturalHeight || el.videoHeight || 0;
        if (!nw || !nh) return;
        const lim = qaLightboxLimits();
        const fit = Math.min(1, lim.comfortW / nw, lim.comfortH / nh);
        qaLightboxBaseW = nw * fit;
        qaLightboxBaseH = nh * fit;
        qaLightboxApplyTransform();
    }

    // Reflects zoom/pan state onto the box size, transformed layer, and
    // button/label states. The box (.qa-lightbox-media) grows with zoom up
    // to the available viewport, then further zoom scales+pans the content.
    function qaLightboxApplyTransform() {
        if (!qaLightboxEl) return;
        const media = qaLightboxEl.querySelector(".qa-lightbox-media");
        const layer = qaLightboxEl.querySelector(".qa-lightbox-zoomable");
        const geo = qaLightboxGeometry();
        if (media) {
            // Always set explicit px so the CSS max-width/max-height (a pure
            // safety net) never clamps growth past the old "comfort" size.
            media.style.width  = Math.round(geo.boxW) + "px";
            media.style.height = Math.round(geo.boxH) + "px";
            media.classList.toggle("qa-lightbox-zoomed", geo.known && geo.overflowFactor > 1);
        }
        if (layer) layer.style.transform = "translate(" + qaLightboxPanX + "px, " + qaLightboxPanY + "px) scale(" + geo.overflowFactor + ")";
        const label = qaLightboxEl.querySelector(".qa-lightbox-zoom-level");
        if (label) label.textContent = Math.round(qaLightboxZoom * 100) + "%";
        const zoomOutBtn = qaLightboxEl.querySelector(".qa-lightbox-zoom-out");
        const zoomInBtn  = qaLightboxEl.querySelector(".qa-lightbox-zoom-in");
        if (zoomOutBtn) zoomOutBtn.disabled = qaLightboxZoom <= LIGHTBOX_ZOOM_MIN;
        if (zoomInBtn)  zoomInBtn.disabled  = qaLightboxZoom >= LIGHTBOX_ZOOM_MAX;
    }

    // Keeps pan within the overflowing content's bounds — a no-op while the
    // box itself is still growing (nothing overflows it yet).
    function qaLightboxClampPan() {
        const geo = qaLightboxGeometry();
        if (!geo.known || geo.overflowFactor <= 1) { qaLightboxPanX = 0; qaLightboxPanY = 0; return; }
        const maxX = Math.max(0, (geo.boxW * geo.overflowFactor - geo.boxW) / 2);
        const maxY = Math.max(0, (geo.boxH * geo.overflowFactor - geo.boxH) / 2);
        qaLightboxPanX = Math.min(maxX, Math.max(-maxX, qaLightboxPanX));
        qaLightboxPanY = Math.min(maxY, Math.max(-maxY, qaLightboxPanY));
    }

    function qaLightboxSetZoom(zoom) {
        qaLightboxZoom = Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, zoom));
        if (qaLightboxZoom === LIGHTBOX_ZOOM_MIN) { qaLightboxPanX = 0; qaLightboxPanY = 0; }
        qaLightboxClampPan();
        qaLightboxApplyTransform();
    }

    function qaLightboxResetZoom() {
        qaLightboxZoom = 1; qaLightboxPanX = 0; qaLightboxPanY = 0;
        qaLightboxApplyTransform();
    }

    function qaLightboxShow(idx) {
        if (!qaLightboxItems.length || !qaLightboxEl) return;
        qaLightboxIndex = (idx + qaLightboxItems.length) % qaLightboxItems.length;
        const item = qaLightboxItems[qaLightboxIndex];
        const media = qaLightboxEl.querySelector(".qa-lightbox-media");
        media.innerHTML = "";
        media.classList.remove("qa-lightbox-loading");
        qaLightboxBaseW = 0;
        qaLightboxBaseH = 0;

        // Everything visible for this item lives inside .qa-lightbox-zoomable,
        // which is what the zoom/pan transform is actually applied to.
        const zoomable = document.createElement("div");
        zoomable.className = "qa-lightbox-zoomable";
        media.appendChild(zoomable);
        qaLightboxResetZoom();

        if (item.type === "video") {
            const v = document.createElement("video");
            v.src = item.href; v.controls = true; v.autoplay = true;
            zoomable.appendChild(v);
        } else {
            // Paint the already-cached thumbnail immediately (blurred) while the
            // full-resolution image decodes off-screen, then cross-fade — avoids
            // watching a large image paint in visible bands on a slow connection.
            media.classList.add("qa-lightbox-loading");
            let placeholder = null;
            if (item.thumbHref) {
                placeholder = document.createElement("img");
                placeholder.className = "qa-lightbox-placeholder";
                placeholder.alt = "";
                placeholder.onload = () => qaLightboxCaptureBase(placeholder);
                placeholder.src = item.thumbHref;
                zoomable.appendChild(placeholder);
            }
            const full = new Image();
            full.className = "qa-lightbox-full";
            full.alt = item.name;
            const finish = () => {
                if (zoomable.querySelector(".qa-lightbox-full") !== full) return; // stale — user already navigated
                media.classList.remove("qa-lightbox-loading");
                if (placeholder) placeholder.remove();
                full.classList.add("qa-lightbox-full-in");
            };
            full.onload = () => {
                qaLightboxCaptureBase(full); // authoritative size — supersedes the thumbnail estimate
                if (full.decode) full.decode().then(finish).catch(finish); else finish();
            };
            full.onerror = () => { media.classList.remove("qa-lightbox-loading"); };
            full.src = item.href;
            zoomable.appendChild(full);
        }
        const multi = qaLightboxItems.length > 1;
        qaLightboxEl.querySelector(".qa-lightbox-name").textContent = item.name
            + (multi ? " (" + (qaLightboxIndex + 1) + "/" + qaLightboxItems.length + ")" : "");
        qaLightboxEl.querySelector(".qa-lightbox-open").href = item.href;
        qaLightboxEl.querySelector(".qa-lightbox-prev").hidden = !multi;
        qaLightboxEl.querySelector(".qa-lightbox-next").hidden = !multi;
        // Zoom doesn't apply to video — it has its own native controls.
        const zoomControls = qaLightboxEl.querySelector(".qa-lightbox-zoom-controls");
        if (zoomControls) zoomControls.hidden = item.type === "video";
    }

    function qaLightboxClose() {
        if (!qaLightboxEl) return;
        qaLightboxEl.classList.remove("qa-lightbox-open-state");
        qaLightboxEl.hidden = true;
        qaLightboxEl.querySelector(".qa-lightbox-media").innerHTML = "";
        qaLightboxItems = [];
        qaLightboxZoom = 1; qaLightboxPanX = 0; qaLightboxPanY = 0; qaLightboxDragging = false;
        qaLightboxBaseW = 0; qaLightboxBaseH = 0;
    }

    function qaLightboxEnsure() {
        if (qaLightboxEl) return qaLightboxEl;
        const overlay = document.createElement("div");
        overlay.className = "qa-lightbox-overlay";
        overlay.hidden = true;
        overlay.innerHTML =
            '<div class="qa-lightbox-stage">'
            +   '<button type="button" class="qa-lightbox-close" aria-label="Close">\u00d7</button>'
            +   '<button type="button" class="qa-lightbox-nav qa-lightbox-prev" aria-label="Previous">\u2039</button>'
            +   '<div class="qa-lightbox-media"></div>'
            +   '<button type="button" class="qa-lightbox-nav qa-lightbox-next" aria-label="Next">\u203a</button>'
            +   '<div class="qa-lightbox-caption">'
            +     '<span class="qa-lightbox-name"></span>'
            +     '<span class="qa-lightbox-zoom-controls">'
            +       '<button type="button" class="qa-lightbox-zoom-out" aria-label="Zoom out" title="Zoom out">\u2212</button>'
            +       '<span class="qa-lightbox-zoom-level">100%</span>'
            +       '<button type="button" class="qa-lightbox-zoom-in" aria-label="Zoom in" title="Zoom in">+</button>'
            +     '</span>'
            +     '<a class="qa-lightbox-open" target="_blank" rel="noopener">Open original</a>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(overlay);
        qaLightboxEl = overlay;
        const media = overlay.querySelector(".qa-lightbox-media");

        overlay.querySelector(".qa-lightbox-close").addEventListener("click", qaLightboxClose);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) qaLightboxClose(); });
        overlay.querySelector(".qa-lightbox-prev").addEventListener("click", () => qaLightboxShow(qaLightboxIndex - 1));
        overlay.querySelector(".qa-lightbox-next").addEventListener("click", () => qaLightboxShow(qaLightboxIndex + 1));
        overlay.querySelector(".qa-lightbox-zoom-in").addEventListener("click", () => qaLightboxSetZoom(qaLightboxZoom + LIGHTBOX_ZOOM_STEP));
        overlay.querySelector(".qa-lightbox-zoom-out").addEventListener("click", () => qaLightboxSetZoom(qaLightboxZoom - LIGHTBOX_ZOOM_STEP));
        document.addEventListener("keydown", (e) => {
            if (qaLightboxEl.hidden) return;
            if (e.key === "Escape") qaLightboxClose();
            else if (e.key === "ArrowLeft") qaLightboxShow(qaLightboxIndex - 1);
            else if (e.key === "ArrowRight") qaLightboxShow(qaLightboxIndex + 1);
            else if (e.key === "+" || e.key === "=") qaLightboxSetZoom(qaLightboxZoom + LIGHTBOX_ZOOM_STEP);
            else if (e.key === "-") qaLightboxSetZoom(qaLightboxZoom - LIGHTBOX_ZOOM_STEP);
        });

        // Mouse wheel zooms in/out around the image's own center. Videos use
        // their native controls, so wheel/drag/double-click are skipped for them.
        media.addEventListener("wheel", (e) => {
            const current = qaLightboxItems[qaLightboxIndex];
            if (!current || current.type === "video") return;
            e.preventDefault();
            qaLightboxSetZoom(qaLightboxZoom + (e.deltaY < 0 ? LIGHTBOX_ZOOM_WHEEL_STEP : -LIGHTBOX_ZOOM_WHEEL_STEP));
        }, { passive: false });

        // Drag to pan — only meaningful once the box is maxed out and the
        // content itself is overflowing it (see qaLightboxGeometry()).
        media.addEventListener("mousedown", (e) => {
            const current = qaLightboxItems[qaLightboxIndex];
            if (!current || current.type === "video") return;
            if (qaLightboxGeometry().overflowFactor <= 1) return;
            qaLightboxDragging = true;
            qaLightboxDragStartX = e.clientX;
            qaLightboxDragStartY = e.clientY;
            qaLightboxPanStartX = qaLightboxPanX;
            qaLightboxPanStartY = qaLightboxPanY;
            media.classList.add("qa-lightbox-dragging");
            e.preventDefault();
        });
        window.addEventListener("mousemove", (e) => {
            if (!qaLightboxDragging) return;
            qaLightboxPanX = qaLightboxPanStartX + (e.clientX - qaLightboxDragStartX);
            qaLightboxPanY = qaLightboxPanStartY + (e.clientY - qaLightboxDragStartY);
            qaLightboxClampPan();
            qaLightboxApplyTransform();
        });
        window.addEventListener("mouseup", () => {
            if (!qaLightboxDragging) return;
            qaLightboxDragging = false;
            media.classList.remove("qa-lightbox-dragging");
        });
        media.addEventListener("dblclick", () => qaLightboxResetZoom());
        // Window resize while zoomed re-evaluates how big the box can grow.
        window.addEventListener("resize", () => {
            if (!qaLightboxEl || qaLightboxEl.hidden) return;
            qaLightboxClampPan();
            qaLightboxApplyTransform();
        });

        return overlay;
    }

    function qaLightboxOpen(items, idx) {
        qaLightboxEnsure();
        qaLightboxItems = items;
        qaLightboxEl.hidden = false;
        requestAnimationFrame(() => qaLightboxEl.classList.add("qa-lightbox-open-state"));
        qaLightboxShow(idx);
    }

    // Delegated so it keeps working after Redmine re-renders the attachments
    // list, with no separate MutationObserver needed.
    function installAttachmentLightbox() {
        if (location.origin !== REDMINE) return;
        if (!isIssueDetailPage()) return;
        document.addEventListener("click", (e) => {
            const a = e.target.closest(ATTACHMENT_LINK_SELECTOR);
            if (!a) return;
            const href = a.getAttribute("href") || "";
            const info = attachmentTypeFromHref(href);
            if (!info) return; // not image/video — let it navigate/download as normal
            e.preventDefault();
            const items = collectAttachmentItems();
            const m = href.match(/\/attachments\/(?:download\/)?(\d+)\b/);
            const idx = Math.max(0, items.findIndex(it => it.id === (m && m[1])));
            qaLightboxOpen(items, idx);
        });
    }

    //////////////////////////////////////////////////////
    // QA Daily Report (Agile board)
    //////////////////////////////////////////////////////

    // Start of the current 10:00 window — today 10:00 if now >= 10:00, else
    // yesterday 10:00. Local browser timezone.
    function qaDailyWindowStart() {
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), QA_DAILY_START_HOUR, 0, 0, 0);
        if (now < s) s.setDate(s.getDate() - 1);
        return s;
    }

    // Next 10:00 boundary AFTER `now`. Powers the auto-refresh timer.
    function qaDailyNextWindowStart() {
        const now = new Date();
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), QA_DAILY_START_HOUR, 0, 0, 0);
        if (now >= s) s.setDate(s.getDate() + 1);
        return s;
    }

    function qaDailyWindowLabel(d) {
        const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
        const hh  = String(d.getHours()).padStart(2, "0");
        const mm  = String(d.getMinutes()).padStart(2, "0");
        return dow + " " + hh + ":" + mm;
    }

    function qaDailyYmd(d) {
        return d.getFullYear() + "-"
            + String(d.getMonth() + 1).padStart(2, "0") + "-"
            + String(d.getDate()).padStart(2, "0");
    }

    // Redmine renders "Logged in as <a>Full Name</a>" in a #loggedas div; we
    // just need the display name to match against QA_TEAM_MEMBERS.
    function qaDetectCurrentUser() {
        const a = document.querySelector("#loggedas a, div.loggedas a");
        if (!a) return null;
        return { name: a.textContent.trim().replace(/\s+/g, " ") };
    }

    function qaDailyMemberFilterUrl(authorId, windowStart) {
        const p = new URLSearchParams();
        p.append("set_filter", "1");
        p.append("f[]", "author_id");
        p.append("op[author_id]", "=");
        p.append("v[author_id][]", String(authorId));
        p.append("f[]", "created_on");
        p.append("op[created_on]", ">=");
        p.append("v[created_on][]", qaDailyYmd(windowStart));
        p.append("f[]", "status_id");
        p.append("op[status_id]", "*");
        p.append("sort", "created_on:desc");
        return "/issues?" + p.toString();
    }

    // Pull >= start-day HTML pages, walk `tr[id^='issue-']` rows.
    async function qaFetchIssueRows(startDate) {
        const rows = [];
        const dateStr = qaDailyYmd(startDate);
        const MAX_PAGES = 15;
        for (let page = 1; page <= MAX_PAGES; page++) {
            const params = new URLSearchParams();
            params.append("set_filter", "1");
            params.append("f[]", "created_on");
            params.append("op[created_on]", ">=");
            params.append("v[created_on][]", dateStr);
            params.append("f[]", "status_id");
            params.append("op[status_id]", "*");
            params.append("c[]", "author");
            params.append("c[]", "tracker");
            params.append("c[]", "status");
            params.append("c[]", "subject");
            params.append("c[]", "created_on");
            params.append("sort", "created_on:desc");
            params.append("per_page", "100");
            params.append("page", String(page));

            const res = await fetch("/issues?" + params.toString(), { credentials: "include", headers: { "Accept": "text/html" } });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const doc = new DOMParser().parseFromString(await res.text(), "text/html");
            const trs = doc.querySelectorAll("tr[id^='issue-']");
            if (!trs.length) break;
            trs.forEach(tr => {
                const idM = tr.id.match(/^issue-(\d+)$/);
                if (!idM) return;
                const authorA = tr.querySelector("td.author a");
                const authorName = authorA ? authorA.textContent.trim().replace(/\s+/g, " ") : "";
                const authorHref = authorA ? (authorA.getAttribute("href") || "") : "";
                const authorIdM  = authorHref.match(/\/users\/(\d+)/);
                const timeEl = tr.querySelector("td.created_on time");
                const createdOn = timeEl && timeEl.getAttribute("datetime")
                    ? timeEl.getAttribute("datetime")
                    : ((tr.querySelector("td.created_on") || {}).textContent || "").trim();
                const subject = ((tr.querySelector("td.subject") || {}).textContent || "").trim();
                const tracker = ((tr.querySelector("td.tracker") || {}).textContent || "").trim();
                const status  = ((tr.querySelector("td.status")  || {}).textContent || "").trim();
                rows.push({
                    id: idM[1],
                    authorName: authorName,
                    authorId: authorIdM ? authorIdM[1] : null,
                    tracker: tracker,
                    status: status,
                    subject: subject,
                    createdOn: createdOn
                });
            });
            if (trs.length < 100) break;
        }
        return rows;
    }

    async function fetchQaDailyReport(windowStart) {
        const rows = await qaFetchIssueRows(windowStart);
        const qaSet   = new Set(QA_TEAM_MEMBERS);
        const startMs = windowStart.getTime();
        const byAuthor = {};
        const trackersTotal = {};
        QA_TEAM_MEMBERS.forEach(n => byAuthor[n] = { count: 0, trackers: {}, authorId: null, issues: [] });

        let total = 0;
        rows.forEach(r => {
            if (!qaSet.has(r.authorName)) return;
            if (String(r.tracker).toLowerCase() === "test case") return;
            const t = r.createdOn ? new Date(r.createdOn).getTime() : NaN;
            if (!isFinite(t) || t < startMs) return;
            const b = byAuthor[r.authorName];
            b.count++;
            if (r.authorId && !b.authorId) b.authorId = r.authorId;
            b.trackers[r.tracker] = (b.trackers[r.tracker] || 0) + 1;
            b.issues.push({ id: r.id, subject: r.subject, tracker: r.tracker, status: r.status, createdOn: r.createdOn });
            trackersTotal[r.tracker] = (trackersTotal[r.tracker] || 0) + 1;
            total++;
        });

        return {
            total: total,
            byAuthor: byAuthor,
            trackersTotal: trackersTotal,
            windowStartISO: windowStart.toISOString(),
            fetchedAt: Date.now()
        };
    }

    // 7-day breakdown for the weekly leaderboard modal. Single fetch starting
    // 6 windows ago; client-side bucket by day.
    async function fetchQaWeeklyReport(windowStart) {
        const weekStart = new Date(windowStart.getTime());
        weekStart.setDate(weekStart.getDate() - 6);

        const rows = await qaFetchIssueRows(weekStart);
        const qaSet = new Set(QA_TEAM_MEMBERS);

        const days = [];
        for (let i = 0; i < 7; i++) {
            const s = new Date(weekStart.getTime());
            s.setDate(s.getDate() + i);
            days.push({ start: s, ymd: qaDailyYmd(s), dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.getDay()] });
        }

        const byAuthor = {};
        QA_TEAM_MEMBERS.forEach(n => byAuthor[n] = { daily: new Array(7).fill(0), total: 0 });

        rows.forEach(r => {
            if (!qaSet.has(r.authorName)) return;
            if (String(r.tracker).toLowerCase() === "test case") return;
            const t = r.createdOn ? new Date(r.createdOn).getTime() : NaN;
            if (!isFinite(t)) return;
            for (let i = 6; i >= 0; i--) {
                const dayStart = days[i].start.getTime();
                const dayEnd = i === 6 ? Infinity : days[i + 1].start.getTime();
                if (t >= dayStart && t < dayEnd) {
                    byAuthor[r.authorName].daily[i]++;
                    byAuthor[r.authorName].total++;
                    break;
                }
            }
        });

        return {
            days: days.map(d => ({ ymd: d.ymd, dow: d.dow })),
            byAuthor: byAuthor,
            windowStartISO: windowStart.toISOString(),
            fetchedAt: Date.now()
        };
    }

    function qaDailyCacheLoad() {
        try { const raw = localStorage.getItem(QA_DAILY_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
        catch (_) { return null; }
    }
    function qaDailyCacheSave(entry) {
        try { localStorage.setItem(QA_DAILY_CACHE_KEY, JSON.stringify(entry)); } catch (_) { /* quota */ }
    }
    function qaDailyWeekCacheLoad() {
        try { const raw = localStorage.getItem(QA_DAILY_WEEK_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
        catch (_) { return null; }
    }
    function qaDailyWeekCacheSave(entry) {
        try { localStorage.setItem(QA_DAILY_WEEK_CACHE_KEY, JSON.stringify(entry)); } catch (_) { /* quota */ }
    }
    function qaDailyShowPetLoad() {
        try { return localStorage.getItem(QA_DAILY_SHOW_PET_KEY) === "1"; }
        catch (_) { return false; }
    }
    function qaDailyShowPetSave(on) {
        try { localStorage.setItem(QA_DAILY_SHOW_PET_KEY, on ? "1" : "0"); } catch (_) { /* quota */ }
    }

    // Auto-refresh handle — cleared before every re-arm so timers can't stack.
    let qaDailyRefreshTimer = null;
    function qaDailyScheduleAutoRefresh() {
        if (qaDailyRefreshTimer) { clearTimeout(qaDailyRefreshTimer); qaDailyRefreshTimer = null; }
        const next = qaDailyNextWindowStart();
        const delay = next.getTime() - Date.now();
        if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
        qaDailyRefreshTimer = setTimeout(() => {
            qaDailyRefreshTimer = null;
            if (document.getElementById("qa-board-daily")) runQaDailyReport(true);
        }, delay + 5000);
    }

    // Cat state machine: cycles between walk / sit / jump / idle inside the
    // cat lane. Position + facing live on .qa-cat-walker (translateX + scaleX)
    // so CSS pose animations on the inner .qa-cat-sprite compose cleanly.
    function qaCatStop(root) {
        const cat = root.querySelector(".qa-board-daily-cat");
        if (!cat) return;
        cat.dataset.qaCatRunning = "0";
        cat.dataset.qaCatRunId = String(Date.now());
        const walker = cat.querySelector(".qa-cat-walker");
        const sprite = cat.querySelector(".qa-cat-sprite");
        if (walker) {
            walker.style.transition = "none";
            walker.style.transform = "translateX(0px) scaleX(1)";
        }
        if (sprite) sprite.className = "qa-cat-sprite qa-cat-sit";
    }

    function qaCatStart(root) {
        const cat = root.querySelector(".qa-board-daily-cat");
        if (!cat) return;
        if (cat.dataset.qaCatRunning === "1") return;
        const walker = cat.querySelector(".qa-cat-walker");
        const sprite = cat.querySelector(".qa-cat-sprite");
        if (!walker || !sprite) return;

        const runId = String(Date.now() + Math.random());
        cat.dataset.qaCatRunning = "1";
        cat.dataset.qaCatRunId = runId;
        const isActive = () => document.body.contains(cat)
            && cat.dataset.qaCatRunning === "1"
            && cat.dataset.qaCatRunId === runId;

        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) {
            sprite.className = "qa-cat-sprite qa-cat-sit";
            walker.style.transform = "translateX(0px) scaleX(1)";
            return;
        }

        let x = 0;
        let facing = 1;
        const laneWidth = () => Math.max(0, (cat.clientWidth || 0) - 48);

        const setPose = (pose) => { sprite.className = "qa-cat-sprite qa-cat-" + pose; };
        const setTransform = (transition) => {
            walker.style.transition = transition || "none";
            walker.style.transform = "translateX(" + x + "px) scaleX(" + facing + ")";
        };

        const decide = () => {
            if (!isActive()) return;
            const maxX = laneWidth();
            if (maxX <= 0) { setTimeout(decide, 1500); return; }
            if (x > maxX) x = maxX;
            if (x < 0) x = 0;

            const remaining = facing > 0 ? (maxX - x) : x;
            if (remaining < 20) {
                setPose("sit");
                setTransform();
                setTimeout(() => {
                    if (!isActive()) return;
                    facing = -facing;
                    setTransform();
                    decide();
                }, 1400 + Math.random() * 1600);
                return;
            }

            const r = Math.random();
            if (r < 0.55) {
                const dist = Math.min(remaining, 40 + Math.random() * 140);
                const speed = 22 + Math.random() * 10;
                const dur = Math.round((dist / speed) * 1000);
                setPose("walk");
                x = x + facing * dist;
                setTransform("transform " + dur + "ms linear");
                setTimeout(decide, dur + 40);
            } else if (r < 0.78) {
                setPose("sit");
                setTransform();
                setTimeout(decide, 1500 + Math.random() * 2500);
            } else if (r < 0.9) {
                setPose("jump");
                setTransform();
                setTimeout(() => {
                    if (!isActive()) return;
                    setPose("walk");
                    setTimeout(decide, 120);
                }, 900);
            } else {
                setPose("idle");
                setTransform();
                setTimeout(decide, 2000 + Math.random() * 1800);
            }
        };

        setPose("walk");
        setTransform();
        setTimeout(decide, 600);
    }

    // Idempotent — safe to call from a MutationObserver on every #content mutation.
    function mountBoardDailyReport() {
        if (location.origin !== REDMINE) return;
        if (!isAgileBoardPage()) return;
        if (document.getElementById("qa-board-daily")) return;
        const anchor = document.querySelector("#content h2");
        if (!anchor || !anchor.parentNode) return;

        const wrap = document.createElement("div");
        wrap.id = "qa-board-daily";
        wrap.className = "qa-board-daily";
        wrap.innerHTML = ''
            + '<div class="qa-board-daily-content">'
            +   '<div class="qa-board-daily-top">'
            +     '<button type="button" class="qa-board-daily-title" id="qa-board-daily-title" title="Open weekly leaderboard">QA today</button>'
            +     '<span class="qa-board-daily-sep">·</span>'
            +     '<span class="qa-board-daily-window" id="qa-board-daily-window">…</span>'
            +     '<span class="qa-board-daily-sep">·</span>'
            +     '<span class="qa-board-daily-total" id="qa-board-daily-total-pill"><strong id="qa-board-daily-total">0</strong> total</span>'
            +   '</div>'
            +   '<div class="qa-board-daily-chips" id="qa-board-daily-chips"></div>'
            + '</div>'
            + '<div class="qa-board-daily-cat" aria-hidden="true" title="just here for vibes"><div class="qa-cat-walker"><div class="qa-cat-sprite qa-cat-walk">'
            +   '<svg class="qa-cat-svg" viewBox="0 0 32 24" fill="#f4a261" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'
            +     '<g class="qa-cat-side">'
            +       '<g class="qa-cat-tail-walk">'
            +         '<rect x="1" y="10" width="2" height="2"/>'
            +         '<rect x="0" y="8" width="2" height="2"/>'
            +         '<rect x="0" y="6" width="2" height="2"/>'
            +         '<rect x="1" y="4" width="2" height="2"/>'
            +         '<rect x="1" y="7" width="1" height="1" fill="#d67a3e"/>'
            +         '<rect x="1" y="4" width="1" height="1" fill="#ffd6a5"/>'
            +       '</g>'
            +       '<rect x="18" y="3" width="2" height="3"/>'
            +       '<rect x="19" y="2" width="1" height="1"/>'
            +       '<rect x="27" y="3" width="2" height="3"/>'
            +       '<rect x="27" y="2" width="1" height="1"/>'
            +       '<rect x="18" y="4" width="1" height="2" fill="#ffb391"/>'
            +       '<rect x="28" y="4" width="1" height="2" fill="#ffb391"/>'
            +       '<rect x="17" y="5" width="13" height="9"/>'
            +       '<rect x="16" y="10" width="1" height="3"/>'
            +       '<rect x="30" y="10" width="1" height="3"/>'
            +       '<rect x="20" y="5" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="23" y="5" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="25" y="5" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="27" y="5" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="21" y="7" width="1" height="1" fill="#d67a3e"/>'
            +       '<rect x="26" y="7" width="1" height="1" fill="#d67a3e"/>'
            +       '<g class="qa-cat-eyes">'
            +         '<rect x="19" y="8" width="3" height="3" fill="#ffffff"/>'
            +         '<rect x="24" y="8" width="3" height="3" fill="#ffffff"/>'
            +         '<rect x="20" y="9" width="1" height="1" fill="#1a1a1a"/>'
            +         '<rect x="25" y="9" width="1" height="1" fill="#1a1a1a"/>'
            +       '</g>'
            +       '<rect x="23" y="11" width="2" height="1" fill="#e6879a"/>'
            +       '<rect x="23" y="12" width="1" height="1" fill="#e6879a"/>'
            +       '<rect x="22" y="13" width="1" height="1" fill="#1a1a1a"/>'
            +       '<rect x="24" y="13" width="1" height="1" fill="#1a1a1a"/>'
            +       '<rect x="13" y="11" width="3" height="1" fill="#4a4a4a" opacity="0.55"/>'
            +       '<rect x="13" y="12" width="3" height="1" fill="#4a4a4a" opacity="0.45"/>'
            +       '<rect x="30" y="11" width="2" height="1" fill="#4a4a4a" opacity="0.55"/>'
            +       '<rect x="30" y="12" width="2" height="1" fill="#4a4a4a" opacity="0.45"/>'
            +       '<rect x="3" y="13" width="17" height="8"/>'
            +       '<rect x="5" y="13" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="8" y="13" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="11" y="13" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="14" y="13" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="17" y="13" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="4" y="16" width="16" height="5" fill="#ffd6a5"/>'
            +       '<g class="qa-cat-legs-walk">'
            +         '<rect class="qa-cat-leg qa-cat-leg-a" x="4" y="20" width="2" height="3"/>'
            +         '<rect class="qa-cat-leg qa-cat-leg-b" x="8" y="20" width="2" height="3"/>'
            +         '<rect class="qa-cat-leg qa-cat-leg-b" x="14" y="20" width="2" height="3"/>'
            +         '<rect class="qa-cat-leg qa-cat-leg-a" x="18" y="20" width="2" height="3"/>'
            +         '<rect x="4" y="22" width="2" height="1" fill="#1a1a1a"/>'
            +         '<rect x="8" y="22" width="2" height="1" fill="#1a1a1a"/>'
            +         '<rect x="14" y="22" width="2" height="1" fill="#1a1a1a"/>'
            +         '<rect x="18" y="22" width="2" height="1" fill="#1a1a1a"/>'
            +       '</g>'
            +     '</g>'
            +     '<g class="qa-cat-front">'
            +       '<rect x="9" y="4" width="3" height="3"/>'
            +       '<rect x="10" y="3" width="2" height="1"/>'
            +       '<rect x="20" y="4" width="3" height="3"/>'
            +       '<rect x="20" y="3" width="2" height="1"/>'
            +       '<rect x="10" y="5" width="1" height="2" fill="#ffb391"/>'
            +       '<rect x="21" y="5" width="1" height="2" fill="#ffb391"/>'
            +       '<rect x="9" y="4" width="1" height="1" fill="#d67a3e"/>'
            +       '<rect x="22" y="4" width="1" height="1" fill="#d67a3e"/>'
            +       '<rect x="9" y="7" width="14" height="7"/>'
            +       '<rect x="8" y="10" width="1" height="3"/>'
            +       '<rect x="23" y="10" width="1" height="3"/>'
            +       '<rect x="7" y="11" width="1" height="1"/>'
            +       '<rect x="24" y="11" width="1" height="1"/>'
            +       '<rect x="11" y="7" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="14" y="7" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="17" y="7" width="1" height="2" fill="#d67a3e"/>'
            +       '<rect x="20" y="7" width="1" height="2" fill="#d67a3e"/>'
            +       '<g class="qa-cat-eyes">'
            +         '<rect x="11" y="9" width="3" height="3" fill="#ffffff"/>'
            +         '<rect x="18" y="9" width="3" height="3" fill="#ffffff"/>'
            +         '<rect x="12" y="10" width="1" height="2" fill="#1a1a1a"/>'
            +         '<rect x="19" y="10" width="1" height="2" fill="#1a1a1a"/>'
            +         '<rect x="13" y="10" width="1" height="1" fill="#ffd6a5" opacity="0.7"/>'
            +         '<rect x="20" y="10" width="1" height="1" fill="#ffd6a5" opacity="0.7"/>'
            +       '</g>'
            +       '<rect x="15" y="11" width="2" height="1" fill="#e6879a"/>'
            +       '<rect x="15" y="12" width="2" height="1" fill="#e6879a"/>'
            +       '<rect x="15" y="13" width="1" height="1" fill="#1a1a1a"/>'
            +       '<rect x="16" y="13" width="1" height="1" fill="#1a1a1a"/>'
            +       '<rect x="5" y="11" width="3" height="1" fill="#4a4a4a" opacity="0.55"/>'
            +       '<rect x="5" y="12" width="3" height="1" fill="#4a4a4a" opacity="0.45"/>'
            +       '<rect x="24" y="11" width="3" height="1" fill="#4a4a4a" opacity="0.55"/>'
            +       '<rect x="24" y="12" width="3" height="1" fill="#4a4a4a" opacity="0.45"/>'
            +       '<rect x="7" y="14" width="18" height="7"/>'
            +       '<rect x="8" y="14" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="24" y="14" width="1" height="3" fill="#d67a3e"/>'
            +       '<rect x="9" y="15" width="14" height="6" fill="#ffd6a5"/>'
            +       '<rect x="15" y="14" width="2" height="1" fill="#ffd6a5"/>'
            +       '<g class="qa-cat-tail-sit">'
            +         '<rect x="24" y="15" width="2" height="2"/>'
            +         '<rect x="25" y="17" width="2" height="2"/>'
            +         '<rect x="24" y="19" width="2" height="2"/>'
            +         '<rect x="22" y="20" width="2" height="1"/>'
            +         '<rect x="25" y="18" width="1" height="1" fill="#d67a3e"/>'
            +         '<rect x="22" y="20" width="1" height="1" fill="#ffd6a5"/>'
            +       '</g>'
            +       '<g class="qa-cat-paws-sit">'
            +         '<rect x="10" y="19" width="4" height="3"/>'
            +         '<rect x="18" y="19" width="4" height="3"/>'
            +         '<rect x="11" y="20" width="1" height="2" fill="#d67a3e"/>'
            +         '<rect x="20" y="20" width="1" height="2" fill="#d67a3e"/>'
            +         '<rect x="10" y="22" width="4" height="1" fill="#1a1a1a"/>'
            +         '<rect x="18" y="22" width="4" height="1" fill="#1a1a1a"/>'
            +       '</g>'
            +     '</g>'
            +   '</svg>'
            + '</div></div></div>'
            + '<div class="qa-board-daily-actions">'
            +   '<label class="qa-board-daily-pet-toggle" for="qa-board-daily-show-pet"><input type="checkbox" id="qa-board-daily-show-pet" aria-label="Show Pet"><span>Show Pet</span></label>'
            +   '<button type="button" class="qa-board-daily-copy" id="qa-board-daily-copy" title="Copy summary for standup" aria-label="Copy summary">📋</button>'
            +   '<button type="button" class="qa-board-daily-refresh" id="qa-board-daily-refresh" title="Refresh (bypass cache)" aria-label="Refresh">↻</button>'
            + '</div>';
        anchor.parentNode.insertBefore(wrap, anchor.nextSibling);

        wrap.querySelector("#qa-board-daily-refresh").addEventListener("click", (e) => {
            e.preventDefault();
            runQaDailyReport(true);
        });
        wrap.querySelector("#qa-board-daily-copy").addEventListener("click", async (e) => {
            e.preventDefault();
            const data = qaDailyCacheLoad();
            if (!data) { toast("Report not loaded yet"); return; }
            const start = qaDailyWindowStart();
            const first = (n) => n.split(/\s+/)[0] || n;
            const chunks = QA_TEAM_MEMBERS
                .map(n => ({ n, c: (data.byAuthor && data.byAuthor[n] ? data.byAuthor[n].count : 0) }))
                .sort((a, b) => b.c - a.c)
                .map(x => first(x.n) + " " + x.c);
            const line = "QA today (since " + qaDailyWindowLabel(start) + "): "
                + data.total + " total — " + chunks.join(", ");
            try { await navigator.clipboard.writeText(line); toast("Summary copied"); }
            catch (_) { toast("Copy failed — clipboard blocked"); }
        });
        wrap.querySelector("#qa-board-daily-title").addEventListener("click", (e) => {
            e.preventDefault();
            openQaWeeklyLeaderboard();
        });

        const showPetEl = wrap.querySelector("#qa-board-daily-show-pet");
        const applyShowPet = () => {
            const on = !!(showPetEl && showPetEl.checked);
            const catEl = wrap.querySelector(".qa-board-daily-cat");
            if (catEl) catEl.style.visibility = on ? "" : "hidden";
            if (on) qaCatStart(wrap);
            else qaCatStop(wrap);
        };
        if (showPetEl) {
            showPetEl.checked = qaDailyShowPetLoad();
            showPetEl.addEventListener("change", () => {
                qaDailyShowPetSave(showPetEl.checked);
                applyShowPet();
            });
        }
        applyShowPet();

        renderQaDailyReportSkeleton();
        runQaDailyReport(false);
    }

    function renderQaDailyReportSkeleton() {
        const wrap = document.getElementById("qa-board-daily");
        if (!wrap) return;
        const chipsEl = wrap.querySelector("#qa-board-daily-chips");
        if (!chipsEl) return;
        const parts = QA_TEAM_MEMBERS.map(() => '<span class="qa-board-daily-chip qa-board-daily-chip-skel" aria-hidden="true"></span>');
        chipsEl.innerHTML = parts.join('<span class="qa-board-daily-sep">·</span>');
    }

    async function runQaDailyReport(bypassCache) {
        const wrap = document.getElementById("qa-board-daily");
        if (!wrap) return;
        const chipsEl    = wrap.querySelector("#qa-board-daily-chips");
        const winEl      = wrap.querySelector("#qa-board-daily-window");
        const refreshBtn = wrap.querySelector("#qa-board-daily-refresh");
        const start = qaDailyWindowStart();
        winEl.textContent = "since " + qaDailyWindowLabel(start);

        const cache = qaDailyCacheLoad();
        if (!bypassCache && cache && cache.windowStartISO === start.toISOString() &&
            (Date.now() - cache.fetchedAt) < QA_DAILY_CACHE_TTL_MS) {
            renderQaDailyReport(cache, start);
            qaDailyScheduleAutoRefresh();
            return;
        }

        refreshBtn.disabled = true;
        wrap.classList.add("qa-board-daily-loading");
        renderQaDailyReportSkeleton();
        try {
            const data = await fetchQaDailyReport(start);
            qaDailyCacheSave(data);
            renderQaDailyReport(data, start);
        } catch (err) {
            console.info("[QA Assistant] QA daily report failed:", err);
            chipsEl.textContent = "Couldn't load — try Refresh.";
        } finally {
            refreshBtn.disabled = false;
            wrap.classList.remove("qa-board-daily-loading");
            qaDailyScheduleAutoRefresh();
        }
    }

    function renderQaDailyReport(data, start) {
        const wrap = document.getElementById("qa-board-daily");
        if (!wrap) return;
        const totalEl   = wrap.querySelector("#qa-board-daily-total");
        const totalPill = wrap.querySelector("#qa-board-daily-total-pill");
        const chipsEl   = wrap.querySelector("#qa-board-daily-chips");
        totalEl.textContent = String(data.total);

        const esc = (s) => String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        const firstName = (n) => (n.split(/\s+/)[0] || n);

        const teamBreakdown = Object.entries(data.trackersTotal || {})
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => n + " " + t).join(" · ") || "no tickets in window";
        totalPill.title = "Team breakdown: " + teamBreakdown;

        if (data.total === 0) {
            chipsEl.innerHTML = '<span class="qa-board-daily-empty">Nothing filed since ' + esc(qaDailyWindowLabel(start)) + ' — quiet morning.</span>';
            return;
        }

        let topCount = 0;
        QA_TEAM_MEMBERS.forEach(n => {
            const c = (data.byAuthor[n] && data.byAuthor[n].count) || 0;
            if (c > topCount) topCount = c;
        });

        const currentUser = qaDetectCurrentUser();
        const currentName = currentUser ? currentUser.name : null;

        const parts = QA_TEAM_MEMBERS.map(name => {
            const b = (data.byAuthor && data.byAuthor[name]) || { count: 0, trackers: {}, authorId: null };
            const breakdown = Object.entries(b.trackers)
                .sort((a, b2) => b2[1] - a[1])
                .map(([t, n]) => n + " " + t).join(" · ") || "no tickets in window";
            const isTop = b.count > 0 && b.count === topCount;
            const isSelf = currentName === name && b.count > 0;
            const badge = isTop ? '<span class="qa-board-daily-crown" title="Top today">🏆</span>' : '';
            const label = badge
                        + '<span class="qa-board-daily-name">' + esc(firstName(name)) + '</span>'
                        + ' <span class="qa-board-daily-count">' + b.count + '</span>';
            if (isSelf) {
                return '<button type="button" class="qa-board-daily-chip qa-board-daily-chip-self" data-qa-self="1" title="' + esc(name + " — " + breakdown + " · Click for details") + '">' + label + '</button>';
            }
            if (b.authorId && b.count > 0) {
                const href = qaDailyMemberFilterUrl(b.authorId, start);
                return '<a class="qa-board-daily-chip" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" title="' + esc(name + " — " + breakdown) + '">' + label + '</a>';
            }
            return '<span class="qa-board-daily-chip qa-board-daily-chip-empty" title="' + esc(name + " — " + breakdown) + '">' + label + '</span>';
        });
        chipsEl.innerHTML = parts.join('<span class="qa-board-daily-sep">·</span>');

        const selfBtn = chipsEl.querySelector('[data-qa-self="1"]');
        if (selfBtn && currentName) {
            selfBtn.addEventListener("click", (e) => {
                e.preventDefault();
                openQaTesterDashboard(currentName);
            });
        }
    }

    //////////////////////////////////////////////////////
    // QA Daily Report — Weekly leaderboard modal
    //////////////////////////////////////////////////////

    function openQaWeeklyLeaderboard() {
        if (document.getElementById("qa-board-daily-week-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "qa-board-daily-week-overlay";
        overlay.className = "qa-board-daily-modal-overlay";
        overlay.innerHTML = ''
            + '<div class="qa-board-daily-modal" role="dialog" aria-labelledby="qa-board-daily-week-title">'
            +   '<div class="qa-board-daily-modal-head">'
            +     '<div class="qa-board-daily-modal-title" id="qa-board-daily-week-title">QA weekly leaderboard</div>'
            +     '<button type="button" class="qa-board-daily-modal-close" aria-label="Close">×</button>'
            +   '</div>'
            +   '<div class="qa-board-daily-modal-body" id="qa-board-daily-week-body">Loading…</div>'
            + '</div>';
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector(".qa-board-daily-modal-close").addEventListener("click", close);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); } };
        document.addEventListener("keydown", escHandler);

        (async () => {
            const start = qaDailyWindowStart();
            const startISO = start.toISOString();
            const cached = qaDailyWeekCacheLoad();
            let data = null;
            if (cached && cached.windowStartISO === startISO && (Date.now() - cached.fetchedAt) < QA_DAILY_WEEK_CACHE_TTL_MS) {
                data = cached;
            } else {
                try {
                    data = await fetchQaWeeklyReport(start);
                    qaDailyWeekCacheSave(data);
                } catch (err) {
                    console.info("[QA Assistant] weekly leaderboard failed:", err);
                    overlay.querySelector("#qa-board-daily-week-body").textContent = "Couldn't load weekly stats.";
                    return;
                }
            }
            renderQaWeeklyLeaderboard(data, overlay);
        })();
    }

    function renderQaWeeklyLeaderboard(data, overlay) {
        const body = overlay.querySelector("#qa-board-daily-week-body");
        const esc = (s) => String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

        let maxCell = 0;
        QA_TEAM_MEMBERS.forEach(n => {
            const row = data.byAuthor[n];
            if (row) row.daily.forEach(v => { if (v > maxCell) maxCell = v; });
        });
        const intensity = (v) => (!v || !maxCell) ? 0 : Math.min(1, v / maxCell);

        const header = '<tr>'
            + '<th class="qa-board-daily-week-name">Name</th>'
            + data.days.map(d => '<th>' + esc(d.dow) + '</th>').join('')
            + '<th class="qa-board-daily-week-total">Total</th>'
            + '</tr>';

        const rows = QA_TEAM_MEMBERS
            .map(n => ({ n, row: data.byAuthor[n] || { daily: new Array(7).fill(0), total: 0 } }))
            .sort((a, b) => b.row.total - a.row.total)
            .map(({ n, row }) => {
                const cells = row.daily.map((v, i) => {
                    const alpha = intensity(v);
                    const isToday = i === 6;
                    const style = alpha > 0
                        ? 'background:rgba(79,140,255,' + (0.08 + alpha * 0.55).toFixed(2) + ')'
                        : '';
                    return '<td class="' + (isToday ? 'qa-board-daily-week-today' : '') + '" style="' + style + '">' + v + '</td>';
                }).join('');
                return '<tr><td class="qa-board-daily-week-name">' + esc(n) + '</td>' + cells + '<td class="qa-board-daily-week-total">' + row.total + '</td></tr>';
            })
            .join('');

        body.innerHTML = '<table class="qa-board-daily-week-table">'
            + '<thead>' + header + '</thead>'
            + '<tbody>' + rows + '</tbody>'
            + '</table>'
            + '<div class="qa-board-daily-week-footnote">Rightmost column is the current 10:00 window. Cell shade scales to the busiest cell of the week.</div>';
    }

    //////////////////////////////////////////////////////
    // QA Daily Report — Tester dashboard modal
    //////////////////////////////////////////////////////

    function openQaTesterDashboard(name) {
        const data = qaDailyCacheLoad();
        if (!data || !data.byAuthor || !data.byAuthor[name]) { toast("Report not loaded yet"); return; }
        const existing = document.getElementById("qa-board-daily-me-overlay");
        if (existing) existing.remove();

        const esc = (s) => String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

        const start = qaDailyWindowStart();
        const bucket = data.byAuthor[name];
        const issues = bucket.issues || [];
        const trackerBreak = Object.entries(bucket.trackers)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => n + " " + t).join(" · ") || "no tickets";

        const rowsHtml = issues.length
            ? issues.slice()
                .sort((a, b) => (a.createdOn < b.createdOn ? 1 : -1))
                .map(i => ''
                    + '<tr>'
                    +   '<td><a href="/issues/' + esc(i.id) + '" target="_blank" rel="noopener noreferrer">#' + esc(i.id) + '</a></td>'
                    +   '<td>' + esc(i.tracker) + '</td>'
                    +   '<td>' + esc(i.status) + '</td>'
                    +   '<td class="qa-board-daily-me-subject">' + esc(i.subject) + '</td>'
                    + '</tr>'
                ).join('')
            : '<tr><td colspan="4" class="qa-board-daily-me-empty">No tickets filed since ' + esc(qaDailyWindowLabel(start)) + '.</td></tr>';

        const overlay = document.createElement("div");
        overlay.id = "qa-board-daily-me-overlay";
        overlay.className = "qa-board-daily-modal-overlay";
        overlay.innerHTML = ''
            + '<div class="qa-board-daily-modal" role="dialog">'
            +   '<div class="qa-board-daily-modal-head">'
            +     '<div class="qa-board-daily-modal-title">' + esc(name) + ' — since ' + esc(qaDailyWindowLabel(start)) + '</div>'
            +     '<button type="button" class="qa-board-daily-modal-close" aria-label="Close">×</button>'
            +   '</div>'
            +   '<div class="qa-board-daily-modal-body">'
            +     '<div class="qa-board-daily-me-summary">'
            +       '<strong>' + bucket.count + '</strong> total · ' + esc(trackerBreak)
            +       '<button type="button" class="qa-board-daily-me-copy" id="qa-board-daily-me-copy">Copy standup summary</button>'
            +     '</div>'
            +     '<table class="qa-board-daily-me-table"><thead><tr>'
            +       '<th>ID</th><th>Tracker</th><th>Status</th><th>Subject</th>'
            +     '</tr></thead><tbody>' + rowsHtml + '</tbody></table>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector(".qa-board-daily-modal-close").addEventListener("click", close);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); } };
        document.addEventListener("keydown", escHandler);

        overlay.querySelector("#qa-board-daily-me-copy").addEventListener("click", async () => {
            const lines = ["Standup — " + name + " (since " + qaDailyWindowLabel(start) + "):"];
            if (!issues.length) {
                lines.push("• no tickets filed yet");
            } else {
                issues.forEach(i => {
                    lines.push("• #" + i.id + " [" + i.tracker + "] " + i.subject);
                });
            }
            try { await navigator.clipboard.writeText(lines.join("\n")); toast("Summary copied"); }
            catch (_) { toast("Copy failed — clipboard blocked"); }
        });
    }

    // Board DOM re-renders on filter/sort changes; re-mount if the widget was
    // ripped out. Cheap because mount() short-circuits when present.
    function observeBoardDailyReport() {
        if (location.origin !== REDMINE) return;
        if (!isAgileBoardPage()) return;
        mountBoardDailyReport();
        const root = document.getElementById("content") || document.body;
        if (!root) return;
        const mo = new MutationObserver(() => mountBoardDailyReport());
        mo.observe(root, { childList: true, subtree: true });
    }

    //////////////////////////////////////////////////////
    // Bootstrap
    //////////////////////////////////////////////////////

    let qaInitialized = false;

    // Load Inter from Google Fonts so the modern typography actually renders on
    // machines where Inter (or Segoe UI Variable / SF Pro) is not installed.
    // Fails silently if the page's CSP blocks fonts.googleapis.com — the CSS
    // font stack then falls back to the OS default.
    function loadModernFont() {
        if (document.getElementById("qa-font-link")) return;
        const preconnect1 = document.createElement("link");
        preconnect1.rel = "preconnect";
        preconnect1.href = "https://fonts.googleapis.com";
        const preconnect2 = document.createElement("link");
        preconnect2.rel = "preconnect";
        preconnect2.href = "https://fonts.gstatic.com";
        preconnect2.crossOrigin = "anonymous";
        const link = document.createElement("link");
        link.id = "qa-font-link";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
        (document.head || document.documentElement).appendChild(preconnect1);
        (document.head || document.documentElement).appendChild(preconnect2);
        (document.head || document.documentElement).appendChild(link);
    }

    function init() {
        if (qaInitialized) return;
        qaInitialized = true;
        loadModernFont();
        createPanel();
        initShortcuts();
        consumeProjectHash();
        autoFillIfNeeded();
        rememberCurrentBoard();
        observeChecklistSection();
        observeIssueHeader();
        observeRelatedIssues();
        installAttachmentLightbox();
        observeBoardDailyReport();
    }

    // Tampermonkey may inject before OR after the page finishes loading. Relying
    // only on the "load" event means the panel silently fails to appear whenever
    // the script runs after load has already fired (common on some devices).
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})();
