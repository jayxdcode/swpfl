// config.js
(async function() {
	const demoMode = true;
	
	const { getSettings, setSettings, getItems, setItems, exportBlob } = window.swpStore;
	
	const $ = sel => document.querySelector(sel);
	
	const enableSync = $('#enableSync');
	const enableNotifications = $('#enableNotifications');
	const enableLogging = $('#enableLogging');
	const autoSave = $('#autoSave');
	const hotkey = $('#hotkey');
	
	const exportSettingsBtn = $('#exportSettingsBtn');
	const importSettingsFile = $('#importSettingsFile');
	const clearAllBtn = $('#clearAllBtn');
	
	async function load() {
		const s = await getSettings();
		enableSync.checked = !!s.enableSync;
		enableNotifications.checked = !!s.enableNotifications;
		enableLogging.checked = !!s.enableLogging;
		autoSave.checked = !!s.autoSave;
		hotkey.value = s.hotkey || 'Alt+L';
	}
	
	async function save(partial) {
		await setSettings(partial);
	}
	
	enableSync.addEventListener('change', () => save({ enableSync: enableSync.checked }));
	enableNotifications.addEventListener('change', () => save({ enableNotifications: enableNotifications.checked }));
	enableLogging.addEventListener('change', () => save({ enableLogging: enableLogging.checked }));
	autoSave.addEventListener('change', () => save({ autoSave: autoSave.checked }));
	hotkey.addEventListener('change', () => save({ hotkey: hotkey.value.trim() }));
	
	exportSettingsBtn.addEventListener('click', async () => {
		const s = await getSettings();
		await exportBlob(`swpfl-settings-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ type: 'swpfl-settings', version: 1, settings: s }, null, 2));
	});
	
	importSettingsFile.addEventListener('change', async e => {
		const f = e.target.files?.[0];
		if (!f) return;
		try {
			const txt = await f.text();
			const j = JSON.parse(txt);
			if (j.type === 'swpfl-settings' && j.settings) {
				await setSettings(j.settings);
				await load();
			}
		} catch (err) { console.error(err); }
		e.target.value = '';
	});
	
	clearAllBtn.addEventListener('click', async () => {
		if (!confirm('Clear all settings and items?')) return;
		if (demoMode) {
			localStorage.clear();
		} else {
			await browser.storage.local.clear();
			try { await browser.storage.sync.clear(); } catch (_) {}
		}
		await load();
		// Saved list will refresh via storage listener
	});
	
	load();
})();