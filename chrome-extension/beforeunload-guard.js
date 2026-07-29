// beforeunload-guard.js
//
// Injected into the page's main world at document_start so it runs before
// Redmine's own scripts. Its only job is to intercept every
// beforeunload listener that anyone (Redmine core, the Agile plugin,
// jQuery's warn_leaving_unsaved, third-party plugins) registers on
// window, so that content.js can detach all of them right before firing
// location.reload() after a bulk-close operation.
//
// Why this is necessary: Redmine 4.x's warn_leaving_unsaved.js binds
// beforeunload on window at DOMContentLoaded and returns a warning
// string when it detects "dirty" textareas. Some plugins call
// preventDefault() on the same event. Once a handler either sets a
// non-empty returnValue or calls preventDefault(), the browser shows a
// "Leave site? Changes you made may not be saved." prompt, and there
// is no way from a later-registered listener to un-cancel that event.
// The only reliable defuse is to remove the offending listeners
// entirely, which requires knowing what they are — hence this early
// registry.
(function () {
    "use strict";
    if (window.__qaBeforeUnloadGuardInstalled) return;
    window.__qaBeforeUnloadGuardInstalled = true;

    // Every native beforeunload listener registered on window ends up
    // in here. We can't reach into jQuery's or plugins' internals to
    // enumerate them after the fact — but wrapping addEventListener
    // now catches every single one going forward, including the single
    // native wrapper jQuery installs to dispatch its own bindings.
    const registry = new Set();
    const origAdd    = EventTarget.prototype.addEventListener;
    const origRemove = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function (type, listener, opts) {
        if (this === window && type === "beforeunload" && typeof listener === "function") {
            registry.add({ listener: listener, opts: opts });
        }
        return origAdd.apply(this, arguments);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, opts) {
        if (this === window && type === "beforeunload" && typeof listener === "function") {
            for (const entry of registry) {
                if (entry.listener === listener) registry.delete(entry);
            }
        }
        return origRemove.apply(this, arguments);
    };

    // window.onbeforeunload is a distinct entry point that bypasses
    // addEventListener. Wrap the property so assignments still work
    // (Redmine or any plugin can read/write it normally) but we can
    // null it out at reload time via our tracked value.
    let onbufValue = null;
    const nativeDesc = Object.getOwnPropertyDescriptor(Window.prototype, "onbeforeunload");
    try {
        Object.defineProperty(window, "onbeforeunload", {
            configurable: true,
            get() { return onbufValue; },
            set(v) {
                onbufValue = v;
                if (nativeDesc && nativeDesc.set) {
                    try { nativeDesc.set.call(window, v); } catch (_) {}
                }
            }
        });
    } catch (_) { /* older browsers may refuse to redefine — no-op fallback */ }

    // content.js dispatches this event when the bulk-close modal has
    // been dismissed. We detach every collected listener, null
    // onbeforeunload, do one belt-and-suspenders jQuery sweep, then
    // reload. With no handlers left to cancel the event, the browser
    // reloads without prompting.
    window.addEventListener("qa-safe-reload", function () {
        for (const entry of registry) {
            try { origRemove.call(window, "beforeunload", entry.listener, entry.opts); } catch (_) {}
        }
        registry.clear();
        try {
            onbufValue = null;
            if (nativeDesc && nativeDesc.set) nativeDesc.set.call(window, null);
        } catch (_) {}
        try {
            const jq = window.jQuery || window.$;
            if (jq) jq(window).off("beforeunload");
        } catch (_) {}
        location.reload();
    });
})();
