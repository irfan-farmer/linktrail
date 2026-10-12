import { browser } from './browser.js';

/**
 * Delete all saved links. The background worker performs the delete inside
 * its write queue so it can't race an in-flight snapshot.
 */
export async function clearAllData() {
  const response = await browser.runtime.sendMessage({ type: 'clear' });
  if (!response?.ok) throw new Error(response?.error || 'Delete failed');
}

/**
 * Two-step confirmation on a button: first click arms it, a second click within
 * a few seconds runs the action. Used instead of window.confirm(), which isn't
 * reliably available in extension popups (notably Firefox).
 */
export function confirmTwice(button, action) {
  const label = button.textContent;
  let timer = null;

  button.addEventListener('click', async () => {
    if (!timer) {
      button.textContent = 'Click again to confirm';
      timer = setTimeout(() => {
        timer = null;
        button.textContent = label;
      }, 4000);
      return;
    }

    clearTimeout(timer);
    timer = null;
    button.disabled = true;
    try {
      await action();
      button.textContent = label;
    } catch (err) {
      console.error('LinkTrail:', err);
      button.textContent = 'Failed, try again';
    } finally {
      button.disabled = false;
    }
  });
}
