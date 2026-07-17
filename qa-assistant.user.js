// ==UserScript==
// @name         QA Assistant for Redmine
// @namespace    QA
// @version      6.1.2
// @description  Report Redmine issues in any tracker with per-tracker templates, an AI report assistant, and a draggable/dockable panel.
// @match        https://redmine.kernello.com/*
// @match        https://dev.cloudapper.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// ==/UserScript==

(function () {

    'use strict';

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

    const AI = {
        key:   () => (localStorage.getItem(STORAGE.aiKey) || "").trim(),
        model: () => (localStorage.getItem(STORAGE.aiModel) || AI_DEFAULT_MODEL),
        setKey: (k) => localStorage.setItem(STORAGE.aiKey, (k || "").trim())
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
            noun: "test case",
            role: "A Test case describes how to verify a specific behaviour, including the steps and the expected result.",
            placeholder: "Describe what to test and the expected result\u2026 (Ctrl+Enter to send)",
            template: () => getTemplate("testcase"),
            guide: "Under *Objective:* summarise what is being verified in one sentence. Under *Preconditions:* list the state or data required before testing. Provide clear, ordered actions under *Test Steps:* and describe the precise, observable outcome under *Expected Result:*."
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
        return [
            "You are a QA assistant that turns rough notes into a well-structured Redmine " + t.noun + ".",
            t.role,
            "Always respond with a JSON object containing exactly these keys:",
            '- "reply": a short, friendly message to the reporter (max 2 sentences) about what you produced or what you still need.',
            '- "subject": a concise, specific ' + t.noun + ' title (<= 120 chars). Use an empty string if there is not enough information yet.',
            '- "description": the full ' + t.noun + ' formatted using EXACTLY this template structure, filling in what the notes provide and keeping the placeholders for anything missing:',
            "-----",
            t.template(),
            "-----",
            t.guide,
            "Keep the exact *Heading:* labels and the blank-line spacing from the template, and write in clear, professional English with each section kept focused.",
            "Only use facts the reporter provided. Do not invent steps, credentials, versions, or acceptance criteria that the notes do not imply. If the notes are too vague to build a report, ask a clarifying question in \"reply\" and give a best-effort subject/description."
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
        const payload = {
            model: AI.model(),
            temperature: 0.3,
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

        panel.innerHTML = `
            <div class="qa-header" id="qa-header">
                <span class="qa-title"><span class="qa-title-icon">${svgIcon("rocket")}</span>QA Assistant</span>
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
                <div class="qa-divider"></div>
                <div class="qa-section-label">Agile Boards</div>
                <div class="qa-boards-row" id="qa-boards-wrap">
                    ${boardButtons}
                </div>
                <div class="qa-version">${QA_VERSION ? "v" + QA_VERSION : ""}</div>
            </div>
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
        makeDraggable(panel, document.getElementById("qa-header"));
        makeDockDraggable(panel, document.getElementById("qa-dock-face"));
        addResizeHandles(panel);
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
