/* storage.js (non-module) */
const SWP_NS = 'swpfl';
const DEFAULT_SETTINGS = { enableSync: false, enableNotifications: true, enableLogging: false, autoSave: true, hotkey: 'Alt+L', theme: 'dark' };

async function swp_getArea(enableSync) { try { return (enableSync ? browser.storage.sync : browser.storage.local); } catch (e) { return browser.storage.local; } }
async function swp_getSettings() { const local = await browser.storage.local.get(`${SWP_NS}:settings`); const s = local[`${SWP_NS}:settings`] || {}; return { ...DEFAULT_SETTINGS, ...s }; }
async function swp_setSettings(partial) { const prev = await swp_getSettings(); const next = { ...prev, ...partial };
  await browser.storage.local.set({
    [`${SWP_NS}:settings`]: next }); return next; }
async function swp_getItems() { const s = await swp_getSettings(); const area = await swp_getArea(s.enableSync); const all = await area.get(`${SWP_NS}:items`); return all[`${SWP_NS}:items`] || []; }
async function swp_setItems(items) { const s = await swp_getSettings(); const area = await swp_getArea(s.enableSync);
  await area.set({
    [`${SWP_NS}:items`]: items }); return items; }

function swp_uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function swp_log(...args) { swp_getSettings().then(s => { if (s.enableLogging) console.log('[swpfl]', ...args); }); }
async function swp_exportBlob(filename, data) { const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); }

window.swpStore = {
  SWP_NS,
  DEFAULT_SETTINGS,
  getSettings: swp_getSettings,
  setSettings: swp_setSettings,
  getItems: swp_getItems,
  setItems: swp_setItems,
  uid: swp_uid,
  log: swp_log,
  exportBlob: swp_exportBlob
};