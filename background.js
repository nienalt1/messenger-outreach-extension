// background.js - updated to wait for content script confirmation before closing tab
let running = false;
let stopRequested = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_OUTREACH') {
    if (!running) startOutreach();
  } else if (msg.action === 'STOP_OUTREACH') {
    stopRequested = true;
  }
});

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function randBetween(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }

async function startOutreach(){
  running = true;
  stopRequested = false;
  const data = await chrome.storage.local.get(['outreachQueue','outreachConfig','outreachState']);
  const queue = (data.outreachQueue || []).slice();
  const cfg = data.outreachConfig || { mode:'manual', delayMin:30, delayMax:90, groupSize:10, groupPause:20, dailyLimit:0 };

  const state = data.outreachState || { sentToday: 0, lastReset: Date.now() };
  const msDay = 24*60*60*1000;
  if (Date.now() - (state.lastReset||0) > msDay) { state.sentToday = 0; state.lastReset = Date.now(); }

  let processed = 0;
  while (queue.length && !stopRequested) {
    if (cfg.dailyLimit > 0 && state.sentToday >= cfg.dailyLimit) {
      console.log('Daily limit reached. Pausing.');
      break;
    }

    const item = queue.shift();
    await chrome.storage.local.set({ outreachQueue: queue });
    processed++;

    const threadUrl = deriveThreadUrl(item.profile_url);
    if (!threadUrl) {
      console.log('Bad profile URL:', item.profile_url);
      continue;
    }

    // Open tab (foreground=false) but set active true occasionally to reduce detection
    const tab = await chrome.tabs.create({ url: threadUrl, active: false });
    // Wait for load
    await sleep(4000 + randBetween(0,3000));

    // Send the payload to content script and wait for response (with timeout)
    const payload = { action: 'OUTREACH_PAYLOAD', payload: { message: item.message, mode: cfg.mode } };
    const response = await sendMessageToTabWithTimeout(tab.id, payload, 30000); // 30s timeout

    if (response && response.status === 'sent') {
      // Count as sent if auto mode, or if manual but user confirmed (content script returns 'filled' only)
      if (cfg.mode === 'auto') {
        state.sentToday++;
        await chrome.storage.local.set({ outreachState: state });
      }
      console.log('Message processed (sent):', item.profile_url);
    } else if (response && response.status === 'filled') {
      // Manual mode filled; we don't increment sentToday here (optionally could)
      console.log('Message filled and waiting for manual send:', item.profile_url);
    } else {
      console.warn('No confirmation from content script or timeout for:', item.profile_url);
    }

    // give user time if manual (so they can press send)
    if (cfg.mode === 'manual') {
      // keep tab open for review then close after a short period
      await sleep(6000 + randBetween(0,4000));
    } else {
      // auto mode: allow small buffer
      await sleep(2000 + randBetween(0,3000));
    }

    // close tab to avoid clutter
    try { chrome.tabs.remove(tab.id); } catch(e){}

    // group pause logic
    if (cfg.groupSize > 0 && processed % cfg.groupSize === 0 && queue.length > 0) {
      const pauseMs = cfg.groupPause * 60 * 1000;
      console.log(`Group pause for ${cfg.groupPause} minutes`);
      await sleep(pauseMs + randBetween(0, 60*1000));
    }

    // delay between sends (randomized)
    const delaySec = randBetween(cfg.delayMin, cfg.delayMax);
    await sleep(delaySec * 1000);
  }

  running = false;
  stopRequested = false;
  console.log('Outreach finished/paused.');
}

// send message to content script and wait for a response with timeout
function sendMessageToTabWithTimeout(tabId, message, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let finished = false;
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (finished) return;
      finished = true;
      resolve(resp);
    });
    setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(null);
    }, timeoutMs);
  });
}

function deriveThreadUrl(profileUrl) {
  try {
    if (!profileUrl) return null;
    if (profileUrl.includes('/messages/t/')) return profileUrl;
    const u = new URL(profileUrl);
    let path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return null;
    if (path.startsWith('profile.php')) {
      const id = u.searchParams.get('id');
      if (id) return `https://www.facebook.com/messages/t/${id}`;
      return null;
    }
    const firstSegment = path.split('/')[0];
    return `https://www.facebook.com/messages/t/${firstSegment}`;
  } catch(e) {
    console.error('deriveThreadUrl error', e);
    return null;
  }
}
