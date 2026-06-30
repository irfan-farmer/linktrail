// Cross-browser WebExtension API handle.
// Firefox/Safari expose `browser` (promise-based); Chrome/Edge/Brave/Opera/Vivaldi
// expose `chrome` (promise-based under MV3). Picking whichever exists lets the
// exact same code run on every major browser without per-browser branches.
export const browser = globalThis.browser ?? globalThis.chrome;
