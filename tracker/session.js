// Temporary tracking session for the public tracking pages.
//
//   ENTER CODE -> VERIFY (server) -> SHOW SHIPMENT -> LEAVE / RELOAD / IDLE -> SESSION CLEARED -> ENTER CODE AGAIN
//
// The code is held only in memory (inside the tracker). This module makes sure nothing brings a previous
// shipment back:
//   - initial load: any ?code= in the address bar is consumed once and removed (history.replaceState), so a
//     reload always lands on the empty entry screen; browser-restored input values are wiped.
//   - pagehide: the shipment is wiped BEFORE the page can enter the back/forward cache, so a bfcache snapshot
//     never contains shipment data (mobile browsers fire pagehide reliably; beforeunload is not relied on).
//   - pageshow (persisted): wiped again in case a browser restored the page anyway.
//   - hidden for too long / idle for too long: the session expires and the code must be entered again.
// It never touches localStorage, sessionStorage or cookies, and never logs anyone out of an account.

const HIDDEN_LIMIT_MS = 10 * 60 * 1000;
const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** Reads ?code= once and strips it from the URL. Returns the code (or null). */
export function consumeCodeFromUrl() {
  let code = null;
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("code")) {
      code = url.searchParams.get("code");
      url.searchParams.delete("code");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    }
  } catch { /* ignore */ }
  return code;
}

/**
 * @param {object} p
 *   tracker   createTracker() instance
 *   input     the tracking-code <input>
 *   onCleared optional callback after a wipe (e.g. hide a results section)
 *   hiddenLimitMs / idleLimitMs  optional overrides
 */
export function bindTrackingSession({ tracker, input, onCleared, hiddenLimitMs = HIDDEN_LIMIT_MS, idleLimitMs = IDLE_LIMIT_MS }) {
  let hiddenAt = null;
  let lastActive = Date.now();
  const active = () => !!tracker.getState().code;

  const wipeInput = () => { if (input) { input.value = ""; input.setAttribute("autocomplete", "off"); } };
  const wipe = (reason) => {
    if (reason === "expired") tracker.expire(); else tracker.clear();
    if (reason !== "expired") wipeInput();
    hiddenAt = null;
    onCleared?.(reason);
  };

  wipeInput(); // some browsers restore form values on reload

  window.addEventListener("pagehide", () => wipe("left"));
  window.addEventListener("pageshow", (e) => { if (e.persisted) wipe("restored"); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && active() && Date.now() - hiddenAt >= hiddenLimitMs) wipe("expired");
    hiddenAt = null; lastActive = Date.now();
  });
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
  const timer = setInterval(() => { if (!document.hidden && active() && Date.now() - lastActive >= idleLimitMs) wipe("expired"); }, 30_000);

  return { wipe, stop: () => clearInterval(timer) };
}
