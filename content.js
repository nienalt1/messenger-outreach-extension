chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'OUTREACH_PAYLOAD') return;
  (async () => {
    const payload = msg.payload || {};
    const message = payload.message || '';
    const mode = payload.mode || 'manual';

    await wait(1500);
    await robustClickContinueButton();

    const input = await waitForMessengerInput(20000);
    if (!input) {
      sendResponse({ status: 'no_input' });
      return;
    }

    fillMessageIntoInput(input, message);

    if (mode === 'manual') {
      sendResponse({ status: 'filled' });
      return;
    }

    const sendOk = await attemptAutoSendAndVerify(input, message, 20000);
    if (sendOk) {
      sendResponse({ status: 'sent' });
    } else {
      sendResponse({ status: 'failed' });
    }
  })();

  return true;
});

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function robustClickContinueButton() {
  const possibleSelectors = [
    'button', 'input[type="button"]', 'input[type="submit"]', '[role="button"]', 'a'
  ];
  for (const sel of possibleSelectors) {
    const elements = document.querySelectorAll(sel);
    for (const el of elements) {
      const txt = (el.textContent || el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
      if (
        txt.includes('Kontynuuj') ||
        txt.includes('Continue') ||
        txt.includes('OK') ||
        txt.includes('Rozumiem') ||
        txt.includes('Got it') ||
        txt.includes('Close')
      ) {
        ['mousedown', 'mouseup', 'click'].forEach(evName => {
          const event = new MouseEvent(evName, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0
          });
          el.dispatchEvent(event);
        });
        await wait(1200);
        return true;
      }
    }
  }
  tryDismissOverlays();
  return false;
}

function tryDismissOverlays() {
  try {
    const texts = ['OK', 'Ok', 'Continue', 'Rozumiem', 'Zamknij', 'Close', 'Got it', 'Got it!', 'Kontynuuj'];
    const dialogs = document.querySelectorAll('[role="dialog"], div[aria-modal="true"]');
    for (const d of dialogs) {
      const btns = d.querySelectorAll('button, a');
      for (const b of btns) {
        const t = (b.innerText || '').trim();
        if (!t) continue;
        if (texts.some(x => t.includes(x))) {
          b.click();
          return;
        }
      }
    }
    const closeSelectors = ['[aria-label="Close"]', '.layerCancel', '.close', '[aria-label*="Close"]'];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el && el.click) { el.click(); return; }
    }
  } catch (e) {}
}

async function waitForMessengerInput(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let el = document.querySelector('[contenteditable="true"][role="combobox"]');
    if (!el) el = document.querySelector('[contenteditable="true"]');
    if (!el) el = document.querySelector('textarea');
    if (el && isVisible(el)) return el;
    await wait(500);
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 10 && rect.height > 5;
}

function fillMessageIntoInput(input, message) {
  try {
    input.focus();
    // Try execCommand for contenteditables
    if (input.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, message);
    } else if (input.tagName.toLowerCase() === 'textarea' || input.tagName.toLowerCase() === 'input') {
      input.value = message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Simulate typing for React inputs/contenteditables
    for (let i = 0; i < message.length; i++) {
      const char = message[i];
      const e = new InputEvent('input', { data: char, bubbles: true });
      input.dispatchEvent(e);
    }

    // Final input event
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.style.outline = '2px dashed #2b7cff';
    setTimeout(() => { input.style.outline = ''; }, 3500);
  } catch (e) { console.warn('fillMessageIntoInput error', e); }
}

// --- THE FIXED SEND LOGIC WITH CURSOR ---
async function attemptAutoSendAndVerify(input, message, timeout = 20000) {
  let sent = false;

  // Focus input and move cursor to end
  try {
    input.focus();
    // For contenteditable, set caret to end
    if (input.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false); // Move to end
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (input.setSelectionRange) {
      // For textarea
      input.setSelectionRange(input.value.length, input.value.length);
    }
    await wait(100);
  } catch (e) {}

  // Now send Enter key
  try {
    const evDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    input.dispatchEvent(evDown);

    const evUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true });
    input.dispatchEvent(evUp);
    sent = true;
    await wait(300);
  } catch (e) {}

  // Verification: wait until a message bubble containing first 15 chars appears in the chat
  const snippet = (message || '').slice(0, 25).replace(/\s+/g, ' ').trim();
  if (!snippet) return false;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const candidates = Array.from(document.querySelectorAll('div, span, p'));
    const found = candidates.some(node => {
      try {
        const txt = (node.innerText || '').replace(/\s+/g, ' ').trim();
        return txt.includes(snippet);
      } catch (e) { return false; }
    });
    if (found) return true;
    await wait(700);
  }
  try {
    const currentVal = (input.tagName.toLowerCase() === 'textarea' || input.tagName.toLowerCase() === 'input') ? input.value : input.innerText;
    if (!currentVal || currentVal.trim().length === 0) {
      return true;
    }
  } catch (e) {}
  return false;
}