function parseCSVWithHeaders(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const headerLine = lines.shift();
  const header = parseLine(headerLine);
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
  let firstKey = null;
  let profileKey = null;
  for (const k of Object.keys(rowObj)) {
    if (!firstKey && k.includes('first')) firstKey = k;
    if (!firstKey && k.includes('name')) firstKey = k;
    if (!profileKey && (k.includes('profile') || k.includes('link') || k.includes('url'))) profileKey = k;
  }
  const keys = Object.keys(rowObj);
  if (!firstKey && keys[0]) firstKey = keys[0];
  if (!profileKey && keys[1]) profileKey = keys[1];
  return { firstKey, profileKey };
}

async function updateCounts() {
  const s = await chrome.storage.local.get(['outreachQueue','outreachState']);
  const queue = s.outreachQueue || [];
  const state = s.outreachState || { sentToday: 0 };
  document.querySelector('#sentCount .count-value').textContent = state.sentToday;
  document.querySelector('#waitingCount .count-value').textContent = queue.length;
}

function setStatus(text) {
  document.getElementById('status').innerText = text;
}

function getCurrentCampaignData() {
  const mode = document.getElementById('mode_auto').checked ? 'auto' : 'manual';
  const template = document.getElementById('template').value;
  const delayMin = parseInt(document.getElementById('delayMin').value, 10) || 30;
  const delayMax = parseInt(document.getElementById('delayMax').value, 10) || 90;
  const groupSize = parseInt(document.getElementById('groupSize').value, 10) || 10;
  const groupPause = parseInt(document.getElementById('groupPause').value, 10) || 20;
  const dailyLimit = parseInt(document.getElementById('dailyLimit').value, 10) || 0;

  return {
    template,
    mode,
    delayMin,
    delayMax,
    groupSize,
    groupPause,
    dailyLimit
  };
}

function loadCampaignData(campaign) {
  document.getElementById('template').value = campaign.template || '';
  document.getElementById('delayMin').value = campaign.delayMin || 30;
  document.getElementById('delayMax').value = campaign.delayMax || 90;
  document.getElementById('groupSize').value = campaign.groupSize || 10;
  document.getElementById('groupPause').value = campaign.groupPause || 20;
  document.getElementById('dailyLimit').value = campaign.dailyLimit || 0;

  if (campaign.mode === 'auto') {
    document.getElementById('mode_auto').checked = true;
  } else {
    document.getElementById('mode_manual').checked = true;
  }
}

async function saveCampaign(name) {
  const campaignData = getCurrentCampaignData();
  const campaigns = await getSavedCampaigns();

  const newCampaign = {
    id: Date.now().toString(),
    name,
    ...campaignData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  campaigns.push(newCampaign);
  await chrome.storage.local.set({ savedCampaigns: campaigns });

  return newCampaign;
}

async function getSavedCampaigns() {
  const result = await chrome.storage.local.get('savedCampaigns');
  return result.savedCampaigns || [];
}

async function deleteCampaign(id) {
  const campaigns = await getSavedCampaigns();
  const filtered = campaigns.filter(c => c.id !== id);
  await chrome.storage.local.set({ savedCampaigns: filtered });
}

async function duplicateCampaign(id) {
  const campaigns = await getSavedCampaigns();
  const original = campaigns.find(c => c.id === id);
  if (!original) return;

  const duplicate = {
    ...original,
    id: Date.now().toString(),
    name: `${original.name} (Copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  campaigns.push(duplicate);
  await chrome.storage.local.set({ savedCampaigns: campaigns });
  await renderCampaignList();
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function renderCampaignList() {
  const campaigns = await getSavedCampaigns();
  const listContainer = document.getElementById('campaignList');

  if (campaigns.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">No saved campaigns yet</div>
      </div>
    `;
    return;
  }

  campaigns.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  listContainer.innerHTML = campaigns.map(campaign => `
    <div class="campaign-item" data-id="${campaign.id}">
      <div class="campaign-header">
        <div>
          <div class="campaign-name">${escapeHtml(campaign.name)}</div>
          <div class="campaign-date">${formatDate(campaign.updatedAt)}</div>
        </div>
        <div class="campaign-actions">
          <button class="icon-btn" data-action="load" data-id="${campaign.id}">Load</button>
          <button class="icon-btn" data-action="duplicate" data-id="${campaign.id}">Duplicate</button>
          <button class="icon-btn danger" data-action="delete" data-id="${campaign.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.campaign-item button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'load') {
        const campaigns = await getSavedCampaigns();
        const campaign = campaigns.find(c => c.id === id);
        if (campaign) {
          loadCampaignData(campaign);
          setStatus(`Loaded campaign: ${campaign.name}`);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (action === 'duplicate') {
        await duplicateCampaign(id);
        setStatus('Campaign duplicated successfully');
      } else if (action === 'delete') {
        if (confirm('Are you sure you want to delete this campaign?')) {
          await deleteCampaign(id);
          await renderCampaignList();
          setStatus('Campaign deleted');
        }
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${targetTab}-tab`).classList.add('active');
  });
});

document.getElementById('saveCampaign').addEventListener('click', () => {
  const modal = document.getElementById('saveModal');
  document.getElementById('campaignName').value = '';
  modal.classList.add('active');
  document.getElementById('campaignName').focus();
});

document.getElementById('confirmSave').addEventListener('click', async () => {
  const name = document.getElementById('campaignName').value.trim();
  if (!name) {
    alert('Please enter a campaign name');
    return;
  }

  await saveCampaign(name);
  document.getElementById('saveModal').classList.remove('active');
  await renderCampaignList();
  setStatus(`Campaign "${name}" saved successfully`);
});

document.getElementById('cancelSave').addEventListener('click', () => {
  document.getElementById('saveModal').classList.remove('active');
});

document.getElementById('saveModal').addEventListener('click', (e) => {
  if (e.target.id === 'saveModal') {
    document.getElementById('saveModal').classList.remove('active');
  }
});

document.getElementById('campaignName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('confirmSave').click();
  }
});

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

(async () => {
  await updateCounts();
  await renderCampaignList();
  const s = await chrome.storage.local.get(['outreachQueue','outreachConfig']);
  const q = s.outreachQueue || [];
  if (q.length) setStatus(`Loaded queue: ${q.length} targets. Configured.`);
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'OUTREACH_PROGRESS') {
    updateCounts();
  }
});
