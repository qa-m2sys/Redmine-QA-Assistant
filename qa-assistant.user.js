// ==UserScript==
// @name         QA Assistant for Redmine
// @namespace    QA
// @version      4.1
// @description  Switch project, auto-fill bug template, draggable/collapsible/dockable panel, dark mode, shortcuts, copy & clear tools
// @match        https://redmine.kernello.com/*
// @grant        none
// ==/UserScript==

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
        docked:    "qa-panel-docked",
        dockPos:   "qa-panel-dock-pos",
        template:  "qa-template",
        tmplOpen:  "qa-template-open",
        theme:     "qa-theme"
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

    // Returns "dark" or "light". Falls back to the OS preference when unset.
    function getTheme() {
        const saved = localStorage.getItem(STORAGE.theme);
        if (saved === "dark" || saved === "light") return saved;
        return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }

    function applyTheme(panel, theme) {
        const dark = theme === "dark";
        panel.classList.toggle("qa-dark", dark);
        const btn = document.getElementById("qa-theme");
        if (btn) {
            btn.textContent = dark ? "☀️" : "🌙";
            btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
        }
    }

    function toggleTheme(panel) {
        const theme = panel.classList.contains("qa-dark") ? "light" : "dark";
        localStorage.setItem(STORAGE.theme, theme);
        applyTheme(panel, theme);
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
                <div class="qa-header-btns">
                    <button class="qa-hbtn" id="qa-theme" title="Switch to dark mode">🌙</button>
                    <button class="qa-hbtn" id="qa-dock" title="Dock to screen edge">📌</button>
                    <button class="qa-hbtn qa-collapse" id="qa-collapse" title="Collapse / Expand">–</button>
                </div>
            </div>
            <div class="qa-dock-face" id="qa-dock-face" title="Click to restore QA Assistant">QA</div>
            <div class="qa-body" id="qa-body">
                <div class="qa-section-label">Projects</div>
                ${projectButtons}
                <div class="qa-divider"></div>
                <div class="qa-section-label">Actions</div>
                <button class="qa-btn qa-action" data-action="fill">
                    <span>✍️ Fill Template</span><kbd>F</kbd>
                </button>git config --global user.name
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

        restorePanelState(panel);
        makeDraggable(panel, document.getElementById("qa-header"));
        makeDockDraggable(panel, document.getElementById("qa-dock-face"));
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

    function restorePanelState(panel) {
        restorePanelPosition(panel);

        if (localStorage.getItem(STORAGE.collapsed) === "1") {
            togglePanel(panel, true);
        }
        if (localStorage.getItem(STORAGE.docked) === "1") {
            setDocked(panel, true);
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
    // Style
    //////////////////////////////////////////////////////

    const style = document.createElement("style");
    style.textContent = `
#qa-panel{
    position:fixed;
    right:20px;
    top:180px;
    width:260px;
    background:#ffffff;
    border:1px solid #dfe3e8;
    border-radius:12px;
    overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,.18);
    z-index:2147483647;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    font-size:13px;
    color:#1f2933;
    user-select:none;
}
#qa-panel.qa-dragging{
    box-shadow:0 14px 40px rgba(0,0,0,.30);
    opacity:.97;
}
.qa-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    background:linear-gradient(135deg,#2c3e50,#1976d2);
    color:#fff;
    padding:10px 12px;
    cursor:move;
}
.qa-title{
    font-weight:600;
    letter-spacing:.2px;
}
.qa-header-btns{
    display:flex;
    gap:6px;
    align-items:center;
}
.qa-hbtn{
    width:24px;
    height:24px;
    border:none;
    border-radius:6px;
    background:rgba(255,255,255,.18);
    color:#fff;
    font-size:13px;
    line-height:1;
    cursor:pointer;
    transition:background .15s ease;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:0;
}
.qa-hbtn:hover{ background:rgba(255,255,255,.32); }
.qa-collapse{ font-size:16px; }

/* Dock button only makes sense once the panel is collapsed. */
#qa-dock{ display:none; }
#qa-panel.qa-collapsed #qa-dock{ display:flex; }

/* Docked (edge-pinned) pill. */
.qa-dock-face{ display:none; }
#qa-panel.qa-docked{
    width:60px !important;
    height:44px;
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
    background:linear-gradient(135deg,#2c3e50,#1976d2);
    color:#fff;
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
    height:60px;
}
#qa-panel.qa-docked.qa-dock-vert .qa-dock-face{
    width:100%;
    height:100%;
}

.qa-body{
    padding:10px;
    overflow:visible;
    transition:padding .25s ease,opacity .2s ease;
}
#qa-panel.qa-collapsed .qa-body{
    max-height:0;
    padding-top:0;
    padding-bottom:0;
    opacity:0;
    overflow:hidden;
}

/* Collapsed bar: same length (long side) & thickness in both orientations. */
#qa-panel.qa-collapsed:not(.qa-collapsed-vert){
    width:250px !important;
    height:44px;
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
#qa-panel.qa-collapsed.qa-collapsed-vert{
    width:44px !important;
    height:250px;
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-header{
    flex-direction:column;
    gap:8px;
    padding:10px 4px;
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-title{
    writing-mode:vertical-rl;
    text-orientation:mixed;
    letter-spacing:.3px;
}
/* On the left edge, flip the title so it faces the other way. */
#qa-panel.qa-collapsed.qa-collapsed-vert.qa-collapsed-left .qa-title{
    transform:rotate(180deg);
}
#qa-panel.qa-collapsed.qa-collapsed-vert .qa-header-btns{
    flex-direction:column;
}

.qa-section-label{
    font-size:10px;
    text-transform:uppercase;
    letter-spacing:.6px;
    color:#8a94a6;
    margin:4px 2px 6px;
    font-weight:700;
}

.qa-section-toggle{
    display:flex;
    align-items:center;
    justify-content:space-between;
    width:100%;
    background:transparent;
    border:none;
    cursor:pointer;
    padding:4px 2px;
    margin:2px 0 4px;
    font-size:10px;
    text-transform:uppercase;
    letter-spacing:.6px;
    color:#8a94a6;
    font-weight:700;
    font-family:inherit;
}
.qa-section-toggle:hover{ color:#1976d2; }
.qa-caret{
    font-size:11px;
    line-height:1;
    transition:transform .12s ease;
}
.qa-tmpl-wrap[hidden]{ display:none; }

.qa-btn{
    display:flex;
    align-items:center;
    justify-content:space-between;
    width:100%;
    padding:9px 10px;
    margin-bottom:6px;
    border:1px solid #e4e7eb;
    border-radius:8px;
    background:#f7f9fb;
    color:#1f2933;
    cursor:pointer;
    font-size:13px;
    text-align:left;
    transition:background .15s ease,border-color .15s ease,transform .05s ease;
}
.qa-btn:hover{
    background:#1976d2;
    border-color:#1976d2;
    color:#fff;
}
.qa-btn:active{ transform:translateY(1px); }
.qa-btn kbd{
    font-family:inherit;
    font-size:10px;
    background:rgba(0,0,0,.08);
    color:inherit;
    border-radius:4px;
    padding:1px 6px;
    margin-left:8px;
    opacity:.75;
}
.qa-btn:hover kbd{ background:rgba(255,255,255,.25); }

.qa-danger:hover{
    background:#e53935;
    border-color:#e53935;
}

.qa-divider{
    height:1px;
    background:#eceff3;
    margin:8px 0;
}

.qa-template-input{
    width:100%;
    box-sizing:border-box;
    min-height:120px;
    resize:vertical;
    padding:8px 9px;
    margin-bottom:6px;
    border:1px solid #e4e7eb;
    border-radius:8px;
    background:#fbfcfd;
    color:#1f2933;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
    font-size:12px;
    line-height:1.45;
    user-select:text;
    white-space:pre;
    overflow:auto;
    transition:border-color .15s ease,box-shadow .15s ease;
}
.qa-template-input:focus{
    outline:none;
    border-color:#1976d2;
    box-shadow:0 0 0 3px rgba(25,118,210,.15);
}

.qa-template-actions{
    display:flex;
    gap:6px;
}
.qa-tmpl-btn{
    justify-content:center;
    margin-bottom:0;
    font-size:12px;
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
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
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

/* ---------- Dark mode ---------- */
#qa-panel.qa-dark{
    background:#1f2933;
    border-color:#3a4553;
    color:#e4e7eb;
}
#qa-panel.qa-dark .qa-section-label,
#qa-panel.qa-dark .qa-section-toggle{ color:#9aa5b1; }
#qa-panel.qa-dark .qa-section-toggle:hover{ color:#4a9eff; }
#qa-panel.qa-dark .qa-btn{
    background:#2c3846;
    border-color:#3a4553;
    color:#e4e7eb;
}
#qa-panel.qa-dark .qa-btn:hover{
    background:#1976d2;
    border-color:#1976d2;
    color:#fff;
}
#qa-panel.qa-dark .qa-btn kbd{ background:rgba(255,255,255,.12); }
#qa-panel.qa-dark .qa-danger:hover{
    background:#e53935;
    border-color:#e53935;
}
#qa-panel.qa-dark .qa-divider{ background:#3a4553; }
#qa-panel.qa-dark .qa-template-input{
    background:#263340;
    border-color:#3a4553;
    color:#e4e7eb;
}
#qa-panel.qa-dark .qa-template-input:focus{
    border-color:#4a9eff;
    box-shadow:0 0 0 3px rgba(74,158,255,.2);
}
`;
    document.head.appendChild(style);

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

    // Tampermonkey may inject before OR after the page finishes loading. Relying
    // only on the "load" event means the panel silently fails to appear whenever
    // the script runs after load has already fired (common on some devices).
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})();
