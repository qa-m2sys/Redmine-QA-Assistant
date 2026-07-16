/* QA Assistant for Redmine — background service worker.
 *
 * Content scripts can't reliably call api.openai.com directly: the request is
 * subject to the host page's Content-Security-Policy (connect-src), which
 * Redmine restricts. The service worker runs in the extension context, so it
 * can make the cross-origin request (host_permissions grants access) and relay
 * the result back to the content script.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "qa-openai") return;

    const key = (msg.key || "").trim();
    if (!key) {
        sendResponse({ error: "No API key set. Paste your OpenAI API key first." });
        return true;
    }

    fetch(OPENAI_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key
        },
        body: JSON.stringify(msg.payload)
    })
        .then(async (res) => {
            let data = {};
            try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
            if (!res.ok) {
                const detail = (data && data.error && data.error.message) || ("HTTP " + res.status);
                sendResponse({ error: detail });
                return;
            }
            sendResponse({ data });
        })
        .catch((err) => sendResponse({ error: err.message || "Network error" }));

    return true; // keep the message channel open for the async response
});
