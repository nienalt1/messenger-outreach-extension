// content.js - improved: handles overlay dismissal, manual & auto modes, sends back status to background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'OUTREACH_PAYLOAD') return;
  (async () => {
    const payload = msg.payload || {};
    const message = payload.message || '';
    const mode = payload.mode || 'manual';

    // Wait for page ready-ish
    await wait(1500);

    // Try dismissing info/overlay dialogs that block typing
    tryDismissOverlays();

    // Wait for input element
    const input = await waitForMessengerInput(20000);
    if (!input) {
      // no input found — inform background
      sendResponse({ status: 'no_input' });
      return;
    }

    // Fill message into input
    fillMessageIntoInput(input, message);

    // If manual: return 'filled' and let user press Send
    if (mode === 'manual') {
      sendResponse({ status: 'filled' });
      return;
    }

    // Auto mode: attempt to send (with retries and verification)
    const sendOk = await attemptAutoSendAndVerify(input, message, 20000);
    if (sendOk) {
      sendResponse({ status: 'sent' });
    } else {
      sendResponse({ status: 'failed' });
    }
  })();

  // must return true to indicate we will sendResponse asynchronously
  return true;
});

// small helper: wait ms
function wait(ms) { return new Promise(r=>setTimeout(r, ms)); }

// attempt to dismiss common overlays/dialogs
function tryDismissOverlays() {
  try {
    // Common button texts in various languages: OK, Continue, Rozumiem, Zamknij, Close
    const texts = ['OK', 'Ok', 'Continue', 'Rozumiem', 'Zamknij', 'Close', 'Got it', 'Got it!'];
    // find buttons inside dialogs
    const dialogs = document.querySelectorAll('[role="dialog"], div[aria-modal="true"]');
    for (const d of dialogs) {
      // try find a button to click
      const btns = d.querySelectorAll('button, a');
      for (const b of btns) {
        const t = (b.innerText || '').trim();
        if (!t) continue;
        if (texts.some(x => t.includes(x))) {
          b.click();
          // quick wait for dismissal
          return;
        }
      }
    }

    // Fallback: try close icons
    const closeSelectors = ['[aria-label="Close"]', '.layerCancel', '.close', '[aria-label*="Close"]'];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
  } catch (e) { console.warn('dismiss overlays failed', e); }
}

// find messenger input (various heuristics)
async function waitForMessengerInput(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // contenteditable combobox (modern)
    let el = document.querySelector('[contenteditable="true"][role="combobox"]');
    if (!el) el = document.querySelector('[contenteditable="true"]');
    if (!el) el = document.querySelector('textarea');
    if (el && isVisible(el)) return el;
    // Also check if the page loaded an initial "Start chat" or 'message' button - try to click to open input
    // but avoid aggressive clicks
    await wait(500);
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 10 && rect.height > 5;
}

// fill message into input element (works for textarea or contenteditable)
function fillMessageIntoInput(input, message) {
  try {
    input.focus();
    if (input.tagName.toLowerCase() === 'textarea' || input.tagName.toLowerCase() === 'input') {
      input.value = message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable
      // Use innerText to preserve formatting expected by messenger
      input.innerText = message;
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    // small highlight so user can see
    input.style.outline = '2px dashed #2b7cff';
    setTimeout(() => { input.style.outline = ''; }, 3500);
  } catch (e) { console.warn('fillMessageIntoInput error', e); }
}

// attempt to auto-send then verify the message appears in chat
async function attemptAutoSendAndVerify(input, message, timeout = 20000) {
  // attempt send using multiple methods
  try {
    // Try to press Enter key event (keydown)
    const evDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    input.dispatchEvent(evDown);
    // also dispatch keyup
    const evUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true });
    input.dispatchEvent(evUp);
  } catch (e) { /* continue */ }

  // Also try to find and click obvious Send buttons
  const possibleSendSelectors = [
    '[aria-label="Press Enter to send"]', '[aria-label="Send"]', 'form button[type="submit"]', 'button[aria-label*="Send"]'
  ];
  for (const sel of possibleSendSelectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn && isVisible(btn)) {
        btn.click();
        break;
      }
    } catch (e) {}
  }

  // Verification: wait until a message bubble containing first 15 chars appears in the chat
  const snippet = (message || '').slice(0, 25).replace(/\s+/g, ' ').trim();
  if (!snippet) return false;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // collect message-like elements
    const candidates = Array.from(document.querySelectorAll('div, span, p'));
    const found = candidates.some(node => {
      try {
        const txt = (node.innerText || '').replace(/\s+/g, ' ').trim();
        if (!txt) return false;
        // Heuristic: message bubbles often contain the exact snippet
        return txt.includes(snippet);
      } catch (e) { return false; }
    });
    if (found) return true;
    await wait(700);
  }

  // As a fallback, check if input is cleared (some messenger UIs clear input after send)
  try {
    const currentVal = (input.tagName.toLowerCase() === 'textarea' || input.tagName.toLowerCase() === 'input') ? input.value : input.innerText;
    if (!currentVal || currentVal.trim().length === 0) {
      // likely sent
      return true;
    }
  } catch (e) {}

  // failed to confirm
  return false;
}
