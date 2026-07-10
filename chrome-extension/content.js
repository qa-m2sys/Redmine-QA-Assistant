/* QA Assistant for Redmine — Chrome extension content script.
 * Ported from the Tampermonkey userscript (qa-assistant.user.js).
 * Styles live in content.css, injected via the manifest.
 */

(function () {

    'use strict';

    //////////////////////////////////////////////////////
    // CONFIG
    //////////////////////////////////////////////////////

    // The ?issue[tracker_id]=1 query makes Redmine render the NEW issue form for
    // the Bug tracker server-side. This ensures Bug-specific fields (e.g.
    // "Affected version") are present on load, without any client-side AJAX
    // reload (which caused a stuck "Loading..." spinner).
    const PROJECTS = {
        web:     { label: "🌐 Web",     url: "/projects/web-app-version-2/issues/new?issue[tracker_id]=1", assignee: "CloudApper Web Team" },
        backend: { label: "⚙️ Backend", url: "/projects/backend/issues/new?issue[tracker_id]=1",     assignee: "CloudApper Backend Team" },
        ios:     { label: "🍎 iOS",     url: "/projects/ios-app/issues/new?issue[tracker_id]=1",     assignee: "CloudApper iOS Team" },
        android: { label: "🤖 Android", url: "/projects/android-app/issues/new?issue[tracker_id]=1", assignee: "CloudApper Android Team" }
    };

    // Order in which project buttons are rendered, and their keyboard shortcut digit.
    const PROJECT_ORDER = ["web", "backend", "ios", "android"];

    // Shipped default. Users can override this with their own template from the
    // panel; their version is saved in localStorage (STORAGE.template) and used
    // for Fill / Copy / auto-fill. "Reset" restores this default.
    const DEFAULT_DESCRIPTION = `

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

`;

    const STORAGE = {
        project:   "qa-project",
        panelPos:  "qa-panel-pos",
        collapsed: "qa-panel-collapsed",
        template:  "qa-template",
        tmplOpen:  "qa-template-open"
    };

    const MAX_AUTOFILL_TRIES = 40; // ~12s at 300ms

    // Returns the user's saved template, or the shipped default if none set.
    function getTemplate() {
        const saved = localStorage.getItem(STORAGE.template);
        return (saved !== null && saved !== "") ? saved : DEFAULT_DESCRIPTION;
    }

    function saveTemplate(text) {
        localStorage.setItem(STORAGE.template, text);
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
        setSelectSilently("issue_tracker_id", "1"); // Bug   (no AJAX reload)
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
    // Navigation
    //////////////////////////////////////////////////////

    function gotoProject(project) {
        if (!PROJECTS[project]) return;
        sessionStorage.setItem(STORAGE.project, project);
        window.location.href = PROJECTS[project].url;
    }

    //////////////////////////////////////////////////////
    // Floating Panel
    //////////////////////////////////////////////////////

    function createPanel() {
        if (document.getElementById("qa-panel")) return;

        const panel = document.createElement("div");
        panel.id = "qa-panel";

        const projectButtons = PROJECT_ORDER.map((key, i) => {
            const p = PROJECTS[key];
            return `<button class="qa-btn qa-project-btn" data-project="${key}">
                        <span>${p.label}</span><kbd>${i + 1}</kbd>
                    </button>`;
        }).join("");

        panel.innerHTML = `
            <div class="qa-header" id="qa-header">
                <span class="qa-title">🚀 QA Assistant</span>
                <button class="qa-collapse" id="qa-collapse" title="Collapse / Expand">–</button>
            </div>
            <div class="qa-body" id="qa-body">
                <div class="qa-section-label">Projects</div>
                ${projectButtons}
                <div class="qa-divider"></div>
                <div class="qa-section-label">Actions</div>
                <button class="qa-btn qa-action" data-action="fill">
                    <span>✍️ Fill Template</span><kbd>F</kbd>
                </button>
                <button class="qa-btn qa-action" data-action="copy">
                    <span>📋 Copy Description</span><kbd>C</kbd>
                </button>
                <button class="qa-btn qa-action qa-danger" data-action="clear">
                    <span>🧹 Clear Form</span><kbd>X</kbd>
                </button>
                <div class="qa-divider"></div>
                <button class="qa-section-toggle" id="qa-tmpl-toggle" type="button" aria-expanded="false">
                    <span>Description Template</span>
                    <span class="qa-caret" id="qa-tmpl-caret">▸</span>
                </button>
                <div class="qa-tmpl-wrap" id="qa-tmpl-wrap" hidden>
                    <textarea id="qa-template-input" class="qa-template-input"
                              spellcheck="false"
                              placeholder="Type your description template here…"></textarea>
                    <div class="qa-template-actions">
                        <button class="qa-btn qa-tmpl-btn" data-action="save-template">💾 Save</button>
                        <button class="qa-btn qa-tmpl-btn" data-action="reset-template">↺ Reset</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // Project buttons
        panel.querySelectorAll(".qa-project-btn").forEach(btn => {
            btn.addEventListener("click", () => gotoProject(btn.dataset.project));
        });

        // Action buttons
        panel.querySelector('[data-action="fill"]').addEventListener("click", () => {
            fillIssue(sessionStorage.getItem(STORAGE.project));
            toast("Template filled");
        });
        panel.querySelector('[data-action="copy"]').addEventListener("click", copyDescription);
        panel.querySelector('[data-action="clear"]').addEventListener("click", clearForm);

        // Template editor
        const tmplInput = panel.querySelector("#qa-template-input");
        tmplInput.value = getTemplate();
        // Don't let clicks/keys inside the textarea trigger drag or shortcuts.
        tmplInput.addEventListener("mousedown", (e) => e.stopPropagation());
        tmplInput.addEventListener("keydown", (e) => e.stopPropagation());
        panel.querySelector('[data-action="save-template"]').addEventListener("click", () => {
            saveTemplate(tmplInput.value);
            toast("Template saved");
        });
        panel.querySelector('[data-action="reset-template"]').addEventListener("click", () => {
            localStorage.removeItem(STORAGE.template);
            tmplInput.value = DEFAULT_DESCRIPTION;
            toast("Template reset to default");
        });

        // Description Template collapse (hidden until user expands)
        const tmplToggle = panel.querySelector("#qa-tmpl-toggle");
        const tmplWrap   = panel.querySelector("#qa-tmpl-wrap");
        const tmplCaret  = panel.querySelector("#qa-tmpl-caret");
        function setTemplateOpen(open) {
            tmplWrap.hidden = !open;
            tmplCaret.textContent = open ? "▾" : "▸";
            tmplToggle.setAttribute("aria-expanded", open ? "true" : "false");
            localStorage.setItem(STORAGE.tmplOpen, open ? "1" : "0");
        }
        tmplToggle.addEventListener("click", () => {
            setTemplateOpen(tmplWrap.hidden);
        });
        setTemplateOpen(localStorage.getItem(STORAGE.tmplOpen) === "1");

        // Collapse toggle
        document.getElementById("qa-collapse").addEventListener("click", (e) => {
            e.stopPropagation();
            togglePanel(panel);
        });

        restorePanelState(panel);
        makeDraggable(panel, document.getElementById("qa-header"));
    }

    //////////////////////////////////////////////////////
    // Collapse
    //////////////////////////////////////////////////////

    function togglePanel(panel, force) {
        const collapsed = force !== undefined ? force : !panel.classList.contains("qa-collapsed");
        panel.classList.toggle("qa-collapsed", collapsed);
        const btn = document.getElementById("qa-collapse");
        if (btn) btn.textContent = collapsed ? "+" : "–";
        localStorage.setItem(STORAGE.collapsed, collapsed ? "1" : "0");
    }

    //////////////////////////////////////////////////////
    // Dragging
    //////////////////////////////////////////////////////

    function makeDraggable(panel, handle) {
        let dragging = false, offsetX = 0, offsetY = 0;

        handle.addEventListener("mousedown", (e) => {
            if (e.target.closest("#qa-collapse")) return;
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
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
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
            localStorage.setItem(STORAGE.panelPos, JSON.stringify({
                left: panel.style.left,
                top: panel.style.top
            }));
        });
    }

    function restorePanelState(panel) {
        try {
            const pos = JSON.parse(localStorage.getItem(STORAGE.panelPos) || "null");
            if (pos && pos.left && pos.top) {
                panel.style.left = pos.left;
                panel.style.top = pos.top;
                panel.style.right = "auto";
            }
        } catch (e) { /* ignore */ }

        if (localStorage.getItem(STORAGE.collapsed) === "1") {
            togglePanel(panel, true);
        }
    }

    //////////////////////////////////////////////////////
    // Keyboard Shortcuts (OS-independent via e.code)
    //   Alt+1..4 -> switch project
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

            // Project switch by digit (Digit1..DigitN or Numpad1..NumpadN)
            const digitMatch = code.match(/^(?:Digit|Numpad)([1-9])$/);
            if (digitMatch) {
                const idx = parseInt(digitMatch[1], 10);
                if (idx >= 1 && idx <= PROJECT_ORDER.length) {
                    e.preventDefault();
                    gotoProject(PROJECT_ORDER[idx - 1]);
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
    // Auto Fill After Navigation
    //////////////////////////////////////////////////////

    function autoFillIfNeeded(tries = 0) {
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

    function init() {
        if (qaInitialized) return;
        qaInitialized = true;
        createPanel();
        initShortcuts();
        autoFillIfNeeded();
    }

    // The content script runs at document_idle, but guard against both timings.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})();
