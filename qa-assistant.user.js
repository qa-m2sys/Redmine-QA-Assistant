// ==UserScript==
// @name         QA Assistant for Redmine
// @namespace    QA
// @version      5.2
// @description  Switch project, auto-fill bug template, AI bug-report assistant, draggable/collapsible/dockable panel, dark mode, shortcuts, copy & clear tools
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

    // The ?issue[tracker_id]=1 query makes Redmine render the NEW issue form for
    // the Bug tracker server-side. This ensures Bug-specific fields (e.g.
    // "Affected version") are present on load, without any client-side AJAX
    // reload (which caused a stuck "Loading..." spinner).
    const PROJECTS = {
        web:     { label: "🌐 Web",     url: "/projects/web-app-version-2/issues/new?issue[tracker_id]=1", board: "/projects/web-app-version-2/agile/board", version: "2216", assignee: "CloudApper Web Team" },
        backend: { label: "⚙️ Backend", url: "/projects/backend/issues/new?issue[tracker_id]=1",     board: "/projects/backend/agile/board",     version: "2215", assignee: "CloudApper Backend Team" },
        ios:     { label: "🍎 iOS",     url: "/projects/ios-app/issues/new?issue[tracker_id]=1",     board: "/projects/ios-app/agile/board",     version: "2163", assignee: "CloudApper iOS Team" },
        android: { label: "🤖 Android", url: "/projects/android-app/issues/new?issue[tracker_id]=1", board: "/projects/android-app/agile/board", version: "2206", assignee: "CloudApper Android Team" }
    };

    // Order in which project buttons are rendered, and their keyboard shortcut digit.
    const PROJECT_ORDER = ["web", "backend", "ios", "android"];

    // Shipped default. Users can override this with their own template from the
    // panel; their version is saved in localStorage (STORAGE.template) and used
    // for Fill / Copy / auto-fill. "Reset" restores this default.
    const DEFAULT_DESCRIPTION = `

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

`;

    const STORAGE = {
        project:   "qa-project",
        panelPos:  "qa-panel-pos",
        collapsed: "qa-panel-collapsed",
        docked:    "qa-panel-docked",
        dockPos:   "qa-panel-dock-pos",
        template:  "qa-template",
        tmplOpen:  "qa-template-open",
        boardsOpen:"qa-boards-open",
        lastBoard: "qa-last-board",
        theme:     "qa-theme",
        aiMode:    "qa-ai-mode",
        aiKey:     "qa-openai-key",
        aiModel:   "qa-openai-model"
    };

    const MAX_AUTOFILL_TRIES = 40; // ~12s at 300ms

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

    // Returns the user's saved template, or the shipped default if none set.
    function getTemplate() {
        const saved = localStorage.getItem(STORAGE.template);
        return (saved !== null && saved !== "") ? saved : DEFAULT_DESCRIPTION;
    }

    function saveTemplate(text) {
        localStorage.setItem(STORAGE.template, text);
    }

    //////////////////////////////////////////////////////
    // AI assistant (OpenAI)
    //////////////////////////////////////////////////////

    const AI = {
        key:   () => (localStorage.getItem(STORAGE.aiKey) || "").trim(),
        model: () => (localStorage.getItem(STORAGE.aiModel) || AI_DEFAULT_MODEL),
        setKey: (k) => localStorage.setItem(STORAGE.aiKey, (k || "").trim())
    };

    // Instructions that make the model return a predictable JSON shape so we can
    // split its answer into a chat reply plus reviewable subject/description.
    function aiSystemPrompt() {
        return [
            "You are a QA assistant that turns a tester's rough notes into a well-structured Redmine bug report.",
            "Always respond with a JSON object containing exactly these keys:",
            '- "reply": a short, friendly message to the tester (max 2 sentences) about what you produced or what you still need.',
            '- "subject": a concise, specific bug title (<= 120 chars). Use an empty string if there is not enough information yet.',
            '- "description": the full bug description formatted using EXACTLY this template structure, filling in what the notes provide and keeping the placeholders for anything missing:',
            "-----",
            getTemplate(),
            "-----",
            "Under the *Description:* heading, write a concise 1-2 sentence summary of the bug (what is broken and where). Never leave *Description:* empty when the notes describe a problem.",
            "Only use facts the tester provided. Do not invent steps, credentials, or versions. If the notes are too vague to build a report, ask a clarifying question in \"reply\" and give a best-effort subject/description."
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
    // Navigation
    //////////////////////////////////////////////////////

    function gotoProject(project) {
        if (!PROJECTS[project]) return;
        // The #qa=<project> marker tells the new tab which project to auto-fill.
        window.open(REDMINE + PROJECTS[project].url + "#qa=" + project, "_blank", "noopener");
    }

    // If the URL carries a #qa=<project> marker (from a Report Bug link/shortcut
    // opened in a new tab), record it so auto-fill and manual Fill know the project.
    function consumeProjectHash() {
        const m = location.hash.match(/(?:^#|[#&])qa=([a-z]+)/i);
        if (m && PROJECTS[m[1]]) {
            sessionStorage.setItem(STORAGE.project, m[1]);
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

        // The Actions and Description Template sections only make sense on Redmine
        // (they act on the issue form). On the app under test they are hidden.
        const onRedmine = location.origin === REDMINE;

        const projectButtons = PROJECT_ORDER.map((key, i) => {
            const p = PROJECTS[key];
            return `<a class="qa-btn qa-project-btn" data-project="${key}"
                        href="${REDMINE}${p.url}#qa=${key}" target="_blank" rel="noopener">
                        <span>${p.label}</span><kbd>${i + 1}</kbd>
                    </a>`;
        }).join("");

        const boardButtons = PROJECT_ORDER.map((key, i) => {
            const p = PROJECTS[key];
            const name = p.label.replace(/^\S+\s+/, ""); // label without the emoji
            const href = toRedmineAbs(getLastBoards()[key] || boardUrl(key));
            return `<a class="qa-btn qa-board-btn" data-board="${key}"
                        href="${href}" target="_blank" rel="noopener"
                        title="${name} agile board" aria-label="${name} agile board">
                        <span>${p.label}</span><kbd>⇧${i + 1}</kbd>
                    </a>`;
        }).join("");

        const actionsHtml = onRedmine ? `
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
                </button>` : "";

        const templateHtml = onRedmine ? `
                <div class="qa-divider"></div>
                <button class="qa-section-toggle" id="qa-tmpl-toggle" type="button" aria-expanded="false">
                    <span>Description Template</span>
                    <span class="qa-caret" id="qa-tmpl-caret">▸</span>
                </button>
                <div class="qa-tmpl-wrap" id="qa-tmpl-wrap" hidden>
                    <label class="qa-mode-switch" title="Switch between template editing and the AI assistant">
                        <span class="qa-mode-name" data-mode="template">📝 Template</span>
                        <span class="qa-switch"><input type="checkbox" id="qa-ai-toggle"><span class="qa-switch-track"></span></span>
                        <span class="qa-mode-name" data-mode="ai">🤖 AI</span>
                    </label>

                    <div id="qa-tmpl-mode">
                        <textarea id="qa-template-input" class="qa-template-input"
                                  spellcheck="false"
                                  placeholder="Type your description template here…"></textarea>
                        <div class="qa-template-actions">
                            <button class="qa-btn qa-tmpl-btn" data-action="save-template">💾 Save</button>
                            <button class="qa-btn qa-tmpl-btn" data-action="reset-template">↺ Reset</button>
                        </div>
                    </div>

                    <div id="qa-ai-mode" hidden>
                        <div class="qa-ai-key" id="qa-ai-key">
                            <div class="qa-ai-key-saved" id="qa-ai-key-saved" hidden>
                                <span class="qa-ai-key-status">🔑 API key saved</span>
                                <button class="qa-btn qa-tmpl-btn" data-action="ai-change-key">Change</button>
                            </div>
                            <div class="qa-ai-key-edit" id="qa-ai-key-edit">
                                <input type="password" id="qa-ai-key-input" class="qa-ai-field"
                                       placeholder="OpenAI API key (sk-…)" autocomplete="off" spellcheck="false">
                                <button class="qa-btn qa-tmpl-btn" data-action="ai-save-key">🔑 Save</button>
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
                            <button class="qa-btn qa-tmpl-btn" data-action="ai-send">✨ Structure</button>
                            <button class="qa-btn qa-tmpl-btn" data-action="ai-clear">🧹 Reset Chat</button>
                        </div>
                        <div class="qa-ai-review" id="qa-ai-review" hidden>
                            <div class="qa-section-label">Review &amp; edit before filling</div>
                            <input type="text" id="qa-ai-subject" class="qa-ai-field" placeholder="Subject">
                            <textarea id="qa-ai-desc" class="qa-template-input" spellcheck="false" placeholder="Description"></textarea>
                            <button class="qa-btn qa-tmpl-btn qa-ai-fill" data-action="ai-fill">⬇️ Fill Subject &amp; Description</button>
                        </div>
                    </div>
                </div>` : "";

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
                <div class="qa-section-label">Report Bug</div>
                ${projectButtons}
                ${actionsHtml}
                <div class="qa-divider"></div>
                <button class="qa-section-toggle" id="qa-boards-toggle" type="button" aria-expanded="false">
                    <span>Agile Boards</span>
                    <span class="qa-caret" id="qa-boards-caret">▸</span>
                </button>
                <div class="qa-tmpl-wrap" id="qa-boards-wrap" hidden>
                    ${boardButtons}
                </div>
                ${templateHtml}
                <div class="qa-version">${QA_VERSION ? "v" + QA_VERSION : ""}</div>
            </div>
        `;

        document.body.appendChild(panel);

        // Report Bug links are plain <a target="_blank"> elements; the new tab
        // reads the #qa=<project> marker in the URL to run auto-fill.

        // Agile board links: refresh the href just before navigation so it points
        // at the last-viewed board (or the current sprint) for that project.
        // mousedown covers left / middle / ctrl-click.
        panel.querySelectorAll(".qa-board-btn").forEach(a => {
            a.addEventListener("mousedown", () => {
                a.href = toRedmineAbs(getLastBoards()[a.dataset.board] || boardUrl(a.dataset.board));
            });
        });

        // Action buttons + template editor only exist on Redmine.
        if (onRedmine) {
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

            // ---- AI assistant mode ----
            const aiToggle   = panel.querySelector("#qa-ai-toggle");
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

            function setAiMode(on) {
                aiModeEl.hidden = !on;
                tmplModeEl.hidden = on;
                aiToggle.checked = on;
                panel.querySelector(".qa-mode-switch").classList.toggle("qa-ai-on", on);
                localStorage.setItem(STORAGE.aiMode, on ? "1" : "0");
                if (on) refreshKeyRow();
            }

            aiToggle.addEventListener("change", () => setAiMode(aiToggle.checked));

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

            async function sendToAi() {
                const text = aiInput.value.trim();
                if (!text) return;
                if (!AI.key()) { refreshKeyRow(); toast("Add your OpenAI API key first"); return; }

                addBubble("user", text);
                aiHistory.push({ role: "user", content: text });
                aiInput.value = "";

                const thinking = addBubble("ai", "Thinking…");
                const sendBtn = panel.querySelector('[data-action="ai-send"]');
                sendBtn.disabled = true;
                try {
                    const res = await aiChat(aiHistory);
                    aiHistory.push({ role: "assistant", content: res.raw || JSON.stringify(res) });
                    thinking.textContent = res.reply || "Done.";
                    if (res.subject || res.description) {
                        aiSubject.value = res.subject || aiSubject.value;
                        aiDesc.value = res.description || aiDesc.value;
                        aiReview.hidden = false;
                    }
                } catch (err) {
                    thinking.classList.add("qa-bubble-error");
                    thinking.textContent = "⚠️ " + err.message;
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

            setAiMode(localStorage.getItem(STORAGE.aiMode) === "1");
        }

        // Agile Boards collapse (hidden until user expands)
        const boardsToggle = panel.querySelector("#qa-boards-toggle");
        const boardsWrap   = panel.querySelector("#qa-boards-wrap");
        const boardsCaret  = panel.querySelector("#qa-boards-caret");
        function setBoardsOpen(open) {
            boardsWrap.hidden = !open;
            boardsCaret.textContent = open ? "▾" : "▸";
            boardsToggle.setAttribute("aria-expanded", open ? "true" : "false");
            localStorage.setItem(STORAGE.boardsOpen, open ? "1" : "0");
        }
        boardsToggle.addEventListener("click", () => {
            setBoardsOpen(boardsWrap.hidden);
        });
        setBoardsOpen(localStorage.getItem(STORAGE.boardsOpen) === "1");

        // Description Template collapse only exists on Redmine.
        if (onRedmine) {
            const tmplToggle = panel.querySelector("#qa-tmpl-toggle");
            const tmplWrap   = panel.querySelector("#qa-tmpl-wrap");
            const tmplCaret  = panel.querySelector("#qa-tmpl-caret");
            const setTemplateOpen = (open) => {
                tmplWrap.hidden = !open;
                tmplCaret.textContent = open ? "▾" : "▸";
                tmplToggle.setAttribute("aria-expanded", open ? "true" : "false");
                localStorage.setItem(STORAGE.tmplOpen, open ? "1" : "0");
            };
            tmplToggle.addEventListener("click", () => {
                setTemplateOpen(tmplWrap.hidden);
            });
            setTemplateOpen(localStorage.getItem(STORAGE.tmplOpen) === "1");
        }

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

/* Dock button is available in both expanded and collapsed states so the two
   headers keep matching buttons and positions. */

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
    max-height:75vh;
    overflow-y:auto;
    overflow-x:hidden;
    transition:padding .25s ease,opacity .2s ease;
}
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
    width:260px !important;
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
#qa-panel.qa-collapsed.qa-collapsed-vert:not(.qa-docked){
    width:40px !important;
    height:370px;
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
    box-sizing:border-box;
    padding:9px 10px;
    margin-bottom:6px;
    border:1px solid #e4e7eb;
    border-radius:8px;
    background:#f7f9fb;
    color:#1f2933;
    cursor:pointer;
    font-size:13px;
    text-align:left;
    text-decoration:none;
    transition:background .15s ease,border-color .15s ease,transform .05s ease;
}
.qa-btn:hover{
    background:#1976d2;
    border-color:#1976d2;
    color:#fff;
}
/* Beat the Redmine theme's a:hover underline (higher specificity). */
#qa-panel .qa-btn:hover,
#qa-panel .qa-btn:focus,
#qa-panel .qa-btn:active{
    text-decoration:none;
}
.qa-btn:active{ transform:translateY(1px); }
.qa-btn:focus-visible,
.qa-hbtn:focus-visible,
.qa-section-toggle:focus-visible{
    outline:2px solid #1976d2;
    outline-offset:2px;
}
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

/* ---------- AI mode ---------- */
.qa-mode-switch{
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    margin:2px 0 10px;
    cursor:pointer;
    user-select:none;
}
.qa-mode-name{
    font-size:11px;
    font-weight:600;
    color:#8a94a6;
    transition:color .15s ease;
}
.qa-mode-name[data-mode="template"]{ color:#1f2933; }
.qa-mode-switch.qa-ai-on .qa-mode-name[data-mode="template"]{ color:#8a94a6; }
.qa-mode-switch.qa-ai-on .qa-mode-name[data-mode="ai"]{ color:#7b3fe4; }
.qa-switch{ position:relative; display:inline-block; width:34px; height:18px; }
.qa-switch input{ position:absolute; opacity:0; width:0; height:0; }
.qa-switch-track{
    position:absolute;
    inset:0;
    background:#cbd2d9;
    border-radius:999px;
    transition:background .18s ease;
}
.qa-switch-track::before{
    content:"";
    position:absolute;
    top:2px;
    left:2px;
    width:14px;
    height:14px;
    background:#fff;
    border-radius:50%;
    box-shadow:0 1px 3px rgba(0,0,0,.3);
    transition:transform .18s ease;
}
.qa-switch input:checked + .qa-switch-track{ background:#7b3fe4; }
.qa-switch input:checked + .qa-switch-track::before{ transform:translateX(16px); }

.qa-ai-field{
    width:100%;
    box-sizing:border-box;
    padding:8px 9px;
    margin-bottom:6px;
    border:1px solid #e4e7eb;
    border-radius:8px;
    background:#fbfcfd;
    color:#1f2933;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    font-size:12px;
    line-height:1.45;
    user-select:text;
    transition:border-color .15s ease,box-shadow .15s ease;
}
.qa-ai-field:focus{
    outline:none;
    border-color:#7b3fe4;
    box-shadow:0 0 0 3px rgba(123,63,228,.15);
}
.qa-ai-compose{ resize:vertical; min-height:52px; }

.qa-ai-key{ display:flex; gap:6px; align-items:stretch; }
.qa-ai-key .qa-ai-field{ flex:1; margin-bottom:6px; }
.qa-ai-key .qa-tmpl-btn{
    width:auto;
    white-space:nowrap;
    margin-bottom:6px;
    padding-top:0;
    padding-bottom:0;
}
.qa-ai-key-edit{ display:flex; gap:6px; align-items:stretch; flex:1; }
.qa-ai-key-edit[hidden]{ display:none; }
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
    color:#2e7d32;
}
.qa-ai-key-saved .qa-tmpl-btn{
    width:auto;
    white-space:nowrap;
    margin-bottom:0;
}

.qa-ai-model-row{
    display:flex;
    align-items:center;
    gap:8px;
    margin-bottom:8px;
    font-size:12px;
    font-weight:600;
    color:#1f2933;
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

.qa-ai-chat{
    display:flex;
    flex-direction:column;
    gap:6px;
    max-height:220px;
    overflow-y:auto;
    margin-bottom:8px;
}
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
    background:#1976d2;
    color:#fff;
    border-bottom-right-radius:3px;
}
.qa-bubble-ai{
    align-self:flex-start;
    background:#f0eefe;
    color:#3a2a6b;
    border-bottom-left-radius:3px;
}
.qa-bubble-error{
    background:#fde8e8;
    color:#b12020;
}

.qa-ai-review{
    margin-top:6px;
    padding-top:8px;
    border-top:1px dashed #e4e7eb;
}
.qa-ai-fill{
    background:#7b3fe4;
    border-color:#7b3fe4;
    color:#fff;
}
.qa-ai-fill:hover{
    background:#6a2fd0;
    border-color:#6a2fd0;
    color:#fff;
}

.qa-version{
    text-align:center;
    color:#8a94a6;
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
#qa-panel.qa-dark .qa-btn:focus-visible,
#qa-panel.qa-dark .qa-hbtn:focus-visible,
#qa-panel.qa-dark .qa-section-toggle:focus-visible{ outline-color:#4a9eff; }
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
#qa-panel.qa-dark .qa-version{ color:#9aa5b1; }
#qa-panel.qa-dark .qa-template-input{
    background:#263340;
    border-color:#3a4553;
    color:#e4e7eb;
}
#qa-panel.qa-dark .qa-template-input:focus{
    border-color:#4a9eff;
    box-shadow:0 0 0 3px rgba(74,158,255,.2);
}

/* Dark mode — AI assistant */
#qa-panel.qa-dark .qa-mode-name{ color:#9aa5b1; }
#qa-panel.qa-dark .qa-mode-name[data-mode="template"]{ color:#e4e7eb; }
#qa-panel.qa-dark .qa-mode-switch.qa-ai-on .qa-mode-name[data-mode="template"]{ color:#9aa5b1; }
#qa-panel.qa-dark .qa-mode-switch.qa-ai-on .qa-mode-name[data-mode="ai"]{ color:#b79cff; }
#qa-panel.qa-dark .qa-switch-track{ background:#4a5563; }
#qa-panel.qa-dark .qa-ai-field{
    background:#263340;
    border-color:#3a4553;
    color:#e4e7eb;
}
#qa-panel.qa-dark .qa-ai-field:focus{
    border-color:#b79cff;
    box-shadow:0 0 0 3px rgba(123,63,228,.25);
}
#qa-panel.qa-dark .qa-bubble-ai{ background:#2f2a4a; color:#d9d2f5; }
#qa-panel.qa-dark .qa-bubble-error{ background:#4a2020; color:#ff9d9d; }
#qa-panel.qa-dark .qa-ai-review{ border-top-color:#3a4553; }
#qa-panel.qa-dark .qa-ai-model-row{ color:#e4e7eb; }
#qa-panel.qa-dark .qa-ai-key-status{ color:#81c784; }
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

    function init() {
        if (qaInitialized) return;
        qaInitialized = true;
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
