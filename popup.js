// popup.js - robust CSV loader, enhanced status/counters, live progress from background

function parseCSVWithHeaders(text) {
  // Basic robust CSV parser supporting quoted values and commas inside quotes
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  // Parse header
  const headerLine = lines.shift();
  const header = parseLine(headerLine);
  // Normalize header: trim & lowercase
  const headerNorm = header.map(h => (h || '').trim().toLowerCase());
  for (const line of lines) {
    const cols = parseLine(line);
    const obj = {};
    for (let i = 0; i < headerNorm.length; i++) {
      obj[headerNorm[i] || `col${i}`] = cols[i] || '';
    }
    rows.push(obj);
  }
  return rows;

  function parseLine(line) {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' ) {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; } 
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        res.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur);
    return res.map(s => s.trim());
  }
}

function detectColumns(rowObj) {
  // rowObj keys are normalized headers (lowercase)
  let firstKey = null;
  let profileKey = null;
  for (const k of Object.keys(rowObj)) {
    if (!firstKey && k.includes('first')) firstKey = k;
    if (!firstKey && k.includes('name')) firstKey = k; // fallback
    if (!profileKey && (k.includes('profile') || k.includes('link') || k.includes('url'))) profileKey = k;
  }
  // last resort: use first 2 columns
  const keys = Object.keys(rowObj);
  if (!firstKey && keys[0]) firstKey = keys[0];
  if (!profileKey && keys[1]) profileKey = keys[1];
  return { firstKey, profileKey };
}

async function updateCounts() {
  const s = await chrome.storage.local.get(['outreachQueue','outreachState']);
  const queue = s.outreachQueue || [];
  const state = s.outreachState || { sentToday: 0 };
  document.getElementById('sentCount').textContent = `Sent: ${state.sentToday}`;
  document.getElementById('waitingCount').textContent = `Waiting: ${queue.length}`;
}

document.getElementById('start').addEventListener('click', async () => {
  const fileInput = document.getElementById('csvfile');
  if (!fileInput.files[0]) return alert('Please upload CSV first');
  const text = await fileInput.files[0].text();
  const rows = parseCSVWithHeaders(text);
  if (!rows.length) return alert('CSV parse failed or empty');

  const { firstKey, profileKey } = detectColumns(rows[0]);
  if (!profileKey) return alert('Could not detect profile URL column in CSV headers');

  const template = document.getElementById('template').value;
  const mode = document.getElementById('mode_auto').checked ? 'auto' : 'manual';
  const delayMin = parseInt(document.getElementById('delayMin').value, 10) || 30;
  const delayMax = parseInt(document.getElementById('delayMax').value, 10) || 90;
  const groupSize = parseInt(document.getElementById('groupSize').value, 10) || 10;
  const groupPause = parseInt(document.getElementById('groupPause').value, 10) || 20;
  const dailyLimit = parseInt(document.getElementById('dailyLimit').value, 10) || 0;

  // Build queue with filled messages
  const queue = rows.map(r => {
    const first = r[firstKey] || '';
    const profile = r[profileKey] || '';
    const message = template.replace(/\{\{First\}\}/gi, first);
    return { profile_url: profile, first, message };
  }).filter(item => item.profile_url && item.message);

  await chrome.storage.local.set({ outreachQueue: queue, outreachConfig: { mode, delayMin, delayMax, groupSize, groupPause, dailyLimit, startedAt: Date.now() } });
  chrome.runtime.sendMessage({ action: 'START_OUTREACH' });
  setStatus(`Started queue: ${queue.length} targets. Mode: ${mode}.`);
  await updateCounts();
});

document.getElementById('stop').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'STOP_OUTREACH' });
  setStatus('Stop requested.');
  await updateCounts();
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove(['outreachQueue','outreachState']);
  setStatus('Queue cleared.');
  await updateCounts();
});

function setStatus(text) {
  document.getElementById('status').innerText = text;
}

// show stored queue length and counts on popup open
(async () => {
  await updateCounts();
  const s = await chrome.storage.local.get(['outreachQueue','outreachConfig']);
  const q = s.outreachQueue || [];
  if (q.length) setStatus(`Loaded queue: ${q.length} targets. Configured.`);
})();

// LIVE COUNTER UPDATE: Listen for progress messages from background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'OUTREACH_PROGRESS') {
    updateCounts();
  }
});