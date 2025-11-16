/*
 Element Picker — UMD build (v1.3.1)
 - Exports: startElementPicker
 - Fix: dotted JSON keys create nested objects (e.g. "merged.titleEl" -> obj.merged.titleEl)
 - Automatically sets top-level `lastUpd` (ISO 8601 UTC) and `site` (location.hostname) on save
 Version: 1.3.1
*/
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		define([], factory);
	} else if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	} else {
		root.startElementPicker = factory();
	}
}(typeof self !== 'undefined' ? self : this, function () {

	const VERSION = '1.3.1';

	if (typeof globalThis !== 'undefined' && globalThis.__elementPickerLoaded) {
		if (globalThis.startElementPicker) {
			try { globalThis.startElementPicker.version = VERSION; } catch(e){}
			return globalThis.startElementPicker;
		}
	}
	try { if (typeof globalThis !== 'undefined') globalThis.__elementPickerLoaded = true; } catch(e){}

	// Utility
	const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([ !"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');

	// Unique selector generator (same as before)
	function getUniqueSelector(el){
		if(!el || el.nodeType !== 1) return '';
		if (el.id) return `#${cssEscape(el.id)}`;
		const parts = [];
		let node = el;
		while(node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html'){
			let tag = node.tagName.toLowerCase();
			let cls = node.classList && node.classList.length ? '.'+Array.from(node.classList).slice(0,3).map(c=>cssEscape(c)).join('.') : '';
			let segment = tag + cls;
			const parent = node.parentNode;
			if (parent){
				const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
				if (sameTag.length > 1){
					let index = 0;
					for (let i=0;i<parent.children.length;i++){
						const child = parent.children[i];
						if (child.tagName === node.tagName) index++;
						if (child === node) break;
					}
					segment += `:nth-of-type(${index})`;
				}
			}
			parts.unshift(segment);
			node = node.parentNode;
		}
		for (let start = 0; start < parts.length; start++){
			const candidate = parts.slice(start).join(' > ');
			try{
				if (candidate && document.querySelectorAll(candidate).length === 1){
					return candidate;
				}
			}catch(e){}
		}
		return parts.join(' > ');
	}

	function getSimpleChildSelector(child){
		if(!child || child.nodeType !== 1) return '';
		const tag = child.tagName.toLowerCase();
		const cls = child.classList && child.classList.length ? '.'+Array.from(child.classList).slice(0,2).map(c=>cssEscape(c)).join('.') : '';
		const parent = child.parentNode;
		if (!parent) return tag + cls;
		const sameTag = Array.from(parent.children).filter(c => c.tagName === child.tagName);
		if (sameTag.length > 1){
			let idx = 0;
			for (let i=0;i<parent.children.length;i++){
				const c = parent.children[i];
				if (c.tagName === child.tagName) idx++;
				if (c === child) break;
			}
			return `${tag}${cls}:nth-of-type(${idx})`;
		}
		return tag + cls;
	}

	function getAttributes(el){
		const attrs = {};
		for (let i=0;i<el.attributes.length;i++){
			const at = el.attributes[i];
			attrs[at.name] = at.value;
		}
		if (el.dataset && Object.keys(el.dataset).length){
			attrs['data-*'] = JSON.parse(JSON.stringify(el.dataset));
		}
		return attrs;
	}

	// localStorage helpers
	function loadStorageObject(storageKey){
		storageKey = storageKey || 'selectorscfg';
		try{
			const raw = localStorage.getItem(storageKey);
			if (!raw) return {};
			return JSON.parse(raw) || {};
		}catch(e){
			return {};
		}
	}
	function saveStorageObject(storageKey, obj){
		storageKey = storageKey || 'selectorscfg';
		try{
			localStorage.setItem(storageKey, JSON.stringify(obj));
			return true;
		}catch(e){
			return false;
		}
	}

	// Nested path helpers (dot notation)
	function getNested(obj, path){
		if (!path) return obj;
		const parts = String(path).split('.');
		let cur = obj;
		for (let p of parts){
			if (cur == null) return undefined;
			cur = cur[p];
		}
		return cur;
	}
	function setNested(obj, path, value){
		if (!path) return;
		const parts = String(path).split('.');
		let cur = obj;
		for (let i=0;i<parts.length-1;i++){
			const p = parts[i];
			if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
			cur = cur[p];
		}
		cur[parts[parts.length-1]] = value;
	}

	// inject styles
	function injectStyles(){
		if (document.getElementById('ep-styles')) return;
		const css = `/* element picker styles (prefix ep-) */
#ep-notify { position: fixed; right: 16px; top: 16px; background: #000; color: #fff; border: 1px solid rgba(255,255,255,0.12); padding: 12px 14px; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.5); z-index: 2147483000; min-width: 240px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
#ep-notify .ep-close{ position: absolute; right: 6px; top: 6px; background: transparent; border: 0; color: #bbb; font-size: 14px; cursor: pointer; }
#ep-notify .ep-title{ font-weight: 600; margin-bottom: 6px; } #ep-notify .ep-message{ font-size: 13px; opacity: 0.95; margin-bottom: 8px; }
#ep-notify .ep-timer { position: relative; height: 6px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden; }
#ep-notify .ep-timer > i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: linear-gradient(90deg, #07f 0%, #0af 100%); animation: ep-bar-var linear forwards; } @keyframes ep-bar-var { from { width: 100%; } to { width: 0%; } }
.ep-highlight-overlay { pointer-events: none; position: fixed; background: rgba(0,120,255,0.08); box-shadow: 0 0 0 2px rgba(0,160,255,0.95) inset; border-radius: 4px; z-index: 2147482999; transition: all 0.06s ease; }
.ep-floater { position: fixed; z-index: 2147483001; background: rgba(0,0,0,0.85); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 13px; border: 1px solid rgba(255,255,255,0.06); pointer-events: none; opacity: 0; transform: translateY(-6px); transition: opacity 180ms ease, transform 180ms ease; }
#ep-details { position: fixed; left: 20px; right: 20px; bottom: 20px; max-width: 720px; background: #0b0b0b; color: #fff; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; box-shadow: 0 12px 34px rgba(0,0,0,0.6); z-index: 2147483000; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; max-height: calc(100vh - 80px); overflow: auto; }
#ep-details h3{ margin: 0 0 10px 0; font-size: 15px; } #ep-details .ep-row{ margin-bottom: 8px; font-size: 13px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; } #ep-details input[type="text"]{ padding: 8px 10px; background: rgba(255,255,255,0.03); color: #fff; border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; } #ep-details input.ep-input-storage{ width: 180px; } #ep-details input.ep-input-jsonkey{ width: 220px; } #ep-details input#ep-selector-input{ flex:1; min-width:180px; } #ep-details select#ep-child-select { width: 220px; } #ep-details .ep-controls { display:flex; gap:8px; align-items:center; } #ep-details button { padding: 8px 10px; border-radius: 6px; border: 0; background: #07f; color: #fff; cursor: pointer; } #ep-details textarea{ width: 100%; height: 100px; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #fff; border: 1px solid rgba(255,255,255,0.04); font-family: monospace; font-size: 12px; resize: vertical; } .ep-mini { font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 0px; cursor: pointer; background: rgba(255,255,255,0.03); color: #fff; } .ep-saved-msg { font-size: 12px; color: #aef; margin-top: 8px; }
#ep-sorter { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 320px; max-width: calc(100% - 40px); background: #0b0b0b; color: #fff; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; box-shadow: 0 12px 34px rgba(0,0,0,0.6); z-index: 2147484000; max-height: calc(100vh - 80px); overflow: auto; }
#ep-sorter h4{ margin: 0 0 8px 0; } .ep-sorter-list { max-height: 320px; overflow: auto; margin-bottom: 8px; } .ep-sorter-item { display:flex; align-items:center; gap:8px; padding:6px; border-radius:6px; background: rgba(255,255,255,0.02); margin-bottom:6px; cursor: grab; } .ep-sorter-item.dragging { opacity: 0.45; } .ep-sorter-item .sel-preview { font-family: monospace; font-size:12px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .ep-sort-btn { padding:4px 6px; border-radius:6px; border:0; cursor:pointer; background: rgba(255,255,255,0.03); color:#fff; }
@media (max-width:480px){ #ep-details{ left:12px; right:12px; bottom:12px; padding:10px; } }`;
		const style = document.createElement('style');
		style.id = 'ep-styles';
		style.textContent = css;
		document.head.appendChild(style);
	}

	// overlay helpers
	let globalOverlay = null;
	function ensureGlobalOverlay(){
		if (globalOverlay && document.body.contains(globalOverlay)) return globalOverlay;
		if (globalOverlay && !document.body.contains(globalOverlay)) globalOverlay = null;
		globalOverlay = document.createElement('div');
		globalOverlay.className = 'ep-highlight-overlay';
		globalOverlay.style.transition = 'all 0.12s ease';
		document.body.appendChild(globalOverlay);
		return globalOverlay;
	}
	function flashElement(el, duration = 700){
		if(!el || el.nodeType !== 1) return;
		const r = el.getBoundingClientRect();
		const flash = document.createElement('div');
		flash.style.position = 'fixed';
		flash.style.left = (r.left + window.scrollX) + 'px';
		flash.style.top = (r.top + window.scrollY) + 'px';
		flash.style.width = (r.width) + 'px';
		flash.style.height = (r.height) + 'px';
		flash.style.zIndex = 2147484001;
		flash.style.borderRadius = window.getComputedStyle(el).borderRadius || '6px';
		flash.style.background = 'rgba(0,160,255,0.12)';
		flash.style.boxShadow = '0 0 0 3px rgba(0,160,255,0.12) inset';
		document.body.appendChild(flash);
		setTimeout(()=> { try{ flash.remove(); }catch(e){} }, duration);
	}
	function highlightElement(el){
		const overlay = ensureGlobalOverlay();
		if (!el || el.nodeType !== 1) {
			overlay.style.display = 'none';
			return;
		}
		const r = el.getBoundingClientRect();
		overlay.style.display = 'block';
		overlay.style.left = `${r.left + window.scrollX}px`;
		overlay.style.top = `${r.top + window.scrollY}px`;
		overlay.style.width = `${r.width}px`;
		overlay.style.height = `${r.height}px`;
		overlay.style.borderRadius = window.getComputedStyle(el).borderRadius || '4px';
	}

	// split/join helpers (for sorter)
	function splitSelectorsString(s){
		if (!s && s !== '') return [];
		if (Array.isArray(s)) return s.map(String);
		try {
			if (typeof s === 'object' && s !== null) {
				return Object.values(s).map(v => (v && v.selector) ? v.selector : String(v));
			}
		}catch(e){}
		if (typeof s !== 'string') s = String(s || '');
		return s.split(/\s*(?:,|\n|;)\s*/).map(x=>x.trim()).filter(x=>x.length>0);
	}
	function joinSelectorsString(list){
		return list.map(x => String(x).trim()).filter(x=>x.length>0).join(', ');
	}

	// main start function
	function startElementPicker(opts = {}){
		injectStyles();
		const onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
		const timerSeconds = Number(opts.timeoutSeconds) || 8;
		const UI_ATTR = 'data-ep-ui';

		// notify
		const notify = document.createElement('div');
		notify.id = 'ep-notify';
		notify.setAttribute(UI_ATTR, '1');
		notify.innerHTML = `
			<button class="ep-close" title="Close" ${UI_ATTR}>&times;</button>
			<div class="ep-title">Element picker active</div>
			<div class="ep-message">Click any element on the page to select it. Press Esc to cancel.</div>
			<div class="ep-timer"><i></i></div>
		`;
		document.body.appendChild(notify);
		const bar = notify.querySelector('.ep-timer > i');
		bar.style.animationDuration = `${timerSeconds}s`;
		const closeBtn = notify.querySelector('.ep-close');
		closeBtn.addEventListener('click', cleanup);

		// hover overlay
		const hoverOverlay = document.createElement('div');
		hoverOverlay.className = 'ep-highlight-overlay';
		hoverOverlay.setAttribute(UI_ATTR, '1');
		document.body.appendChild(hoverOverlay);

		// floater
		const floater = document.createElement('div');
		floater.className = 'ep-floater';
		floater.setAttribute(UI_ATTR, '1');
		floater.textContent = 'Click the element again to lock it in';
		document.body.appendChild(floater);

		// details window
		const details = document.createElement('div');
		details.id = 'ep-details';
		details.setAttribute(UI_ATTR, '1');
		details.style.display = 'none';
		details.innerHTML = `
			<h3>Element details</h3>
			<div class="ep-row">
				<div style="font-weight:600; min-width:85px;">Selector</div>
				<input type="text" id="ep-selector-input" placeholder="CSS selector (editable)" />
				<select id="ep-child-select"><option value="">-- show children --</option></select>
				<div class="ep-controls">
					<button id="ep-test-selector" class="ep-mini">Test</button>
				</div>
			</div>
			<div class="ep-row">
				<div style="font-weight:600; min-width:85px;">Attributes</div>
				<textarea id="ep-attrs" readonly></textarea>
			</div>
			<div class="ep-row">
				<div style="font-weight:600; min-width:85px;">Text content</div>
				<textarea id="ep-text" readonly></textarea>
			</div>
			<div class="ep-row">
				<input id="ep-storage-key" class="ep-input-storage" type="text" placeholder="LocalStorage key (default: selectorscfg)" value="selectorscfg" />
				<input id="ep-json-key" class="ep-input-jsonkey" type="text" placeholder="JSON key (e.g. merged.titleEl)" />
				<button id="ep-update" class="ep-mini">Update (overwrite)</button>
				<button id="ep-add" class="ep-mini">Add (append)</button>
				<button id="ep-open-sorter" class="ep-mini">Open sorter</button>
				<button id="ep-close-details" class="ep-mini">Close</button>
			</div>
			<div id="ep-saved" class="ep-saved-msg" style="display:none"></div>
		`;
		document.body.appendChild(details);

		// populate child dropdown (walking)
		function populateChildDropdown(parentEl, parentSelector){
			const sel = details.querySelector('#ep-child-select');
			sel.innerHTML = '<option value="">-- show children --</option>';
			if (!parentEl || parentEl.nodeType !== 1) return;
			// ".. (parent)" option
			const p = parentEl.parentElement;
			if (p) {
				const parentSel = getUniqueSelector(p);
				const optUp = document.createElement('option');
				optUp.value = '__UP__|' + (parentSel || '');
				optUp.textContent = '.. (parent)';
				sel.appendChild(optUp);
			}
			const children = Array.from(parentEl.children).slice(0, 400);
			children.forEach((child, idx) => {
				const labelText = (child.tagName.toLowerCase() + (child.className ? ' .' + String(child.className).split(/\s+/).slice(0,2).join('.') : '')).slice(0,120);
				const childRel = getSimpleChildSelector(child);
				const value = parentSelector ? `${parentSelector} > ${childRel}` : childRel;
				const opt = document.createElement('option');
				opt.value = value;
				opt.textContent = `${idx+1}. ${labelText}`;
				sel.appendChild(opt);
			});
		}

		// set selector input and optionally test (updates children list too)
		function setSelectorInputAndShow(selector, testImmediately){
			const input = details.querySelector('#ep-selector-input');
			input.value = selector || '';
			if (testImmediately) {
				try {
					const match = document.querySelector(input.value);
					if (match){
						highlightElement(match);
						flashElement(match, 650);
						details.querySelector('#ep-attrs').value = JSON.stringify(getAttributes(match), null, 2);
						details.querySelector('#ep-text').value = (match.textContent || '').trim();
						populateChildDropdown(match, input.value);
					} else {
						showSavedMsg('No element matches that selector', true);
					}
				}catch(e){
					showSavedMsg('Invalid selector', true);
				}
			}
		}

		// child selection behavior (walks and supports __UP__)
		details.querySelector('#ep-child-select').addEventListener('change', (ev) => {
			const val = ev.target.value || '';
			if (!val) return;
			if (val.startsWith('__UP__|')) {
				const parentSelector = val.split('|')[1] || '';
				if (!parentSelector) { showSavedMsg('Parent selector unknown', true); return; }
				setSelectorInputAndShow(parentSelector, true);
				return;
			}
			setSelectorInputAndShow(val, true);
		});

		// Test button
		details.querySelector('#ep-test-selector').addEventListener('click', () => {
			const s = details.querySelector('#ep-selector-input').value || '';
			if (!s) { showSavedMsg('Selector is empty', true); return; }
			try {
				const el = document.querySelector(s);
				if (!el) { showSavedMsg('No element found for that selector', true); return; }
				highlightElement(el);
				flashElement(el, 650);
				details.querySelector('#ep-attrs').value = JSON.stringify(getAttributes(el), null, 2);
				details.querySelector('#ep-text').value = (el.textContent || '').trim();
				populateChildDropdown(el, s);
			}catch(e){
				showSavedMsg('Invalid selector', true);
			}
		});

		// make selector string for storing
		function makeSelectorString(){
			return (details.querySelector('#ep-selector-input').value || '').trim();
		}

		// Update (overwrite) — writes nested path and sets lastUpd & site
		const updateBtn = details.querySelector('#ep-update');
		updateBtn.addEventListener('click', () => {
			const storageKey = (details.querySelector('#ep-storage-key').value || 'selectorscfg').trim();
			const jsonKey = (details.querySelector('#ep-json-key').value || '').trim();
			if (!jsonKey) { showSavedMsg('Enter a JSON key (e.g. merged.titleEl)', true); return; }
			const obj = loadStorageObject(storageKey);
			// set metadata
			try { obj.lastUpd = new Date().toISOString(); } catch(e){}
			try { obj.site = location.hostname || ''; } catch(e){}
			setNested(obj, jsonKey, makeSelectorString());
			if (saveStorageObject(storageKey, obj)) {
				showSavedMsg(`Saved as ${storageKey}.${jsonKey}`);
			} else {
				showSavedMsg('Failed to save to localStorage', true);
			}
		});

		// Add (append) — appends a selector to comma-separated string at nested path
		const addBtn = details.querySelector('#ep-add');
		addBtn.addEventListener('click', () => {
			const storageKey = (details.querySelector('#ep-storage-key').value || 'selectorscfg').trim();
			const jsonKey = (details.querySelector('#ep-json-key').value || '').trim();
			if (!jsonKey) { showSavedMsg('Enter a JSON key (e.g. merged.titleEl)', true); return; }
			const obj = loadStorageObject(storageKey);
			const existing = getNested(obj, jsonKey);
			const list = splitSelectorsString(existing);
			const payloadSelector = makeSelectorString();
			if (!payloadSelector) { showSavedMsg('Selector is empty', true); return; }
			list.push(payloadSelector);
			// set metadata & joined string
			try { obj.lastUpd = new Date().toISOString(); } catch(e){}
			try { obj.site = location.hostname || ''; } catch(e){}
			setNested(obj, jsonKey, joinSelectorsString(list));
			if (saveStorageObject(storageKey, obj)) {
				showSavedMsg(`Appended selector to ${storageKey}.${jsonKey}`);
				openSorter(storageKey, jsonKey, list.slice());
			} else {
				showSavedMsg('Failed to append to localStorage', true);
			}
		});

		// Open sorter: reads nested path, opens DnD modal for reordering string list
		details.querySelector('#ep-open-sorter').addEventListener('click', () => {
			const storageKey = (details.querySelector('#ep-storage-key').value || 'selectorscfg').trim();
			const jsonKey = (details.querySelector('#ep-json-key').value || '').trim();
			if (!jsonKey) { showSavedMsg('Enter a JSON key (e.g. merged.titleEl)', true); return; }
			const obj = loadStorageObject(storageKey);
			const raw = getNested(obj, jsonKey);
			if (raw === undefined) { showSavedMsg('No existing value under that JSON key', true); return; }
			const list = splitSelectorsString(raw);
			openSorter(storageKey, jsonKey, list.slice());
		});

		// close details
		details.querySelector('#ep-close-details').addEventListener('click', cleanup);

		const savedDiv = details.querySelector('#ep-saved');
		function showSavedMsg(msg, isError){
			savedDiv.style.display = 'block';
			savedDiv.textContent = msg;
			savedDiv.style.color = isError ? '#f88' : '#aef';
			setTimeout(()=> {
				if (savedDiv) savedDiv.style.display = 'none';
			}, 2400);
		}

		// Drag-and-drop sorter modal
		function openSorter(storageKey, jsonKey, list){
			const existingModal = document.getElementById('ep-sorter');
			if (existingModal) existingModal.remove();

			const modal = document.createElement('div');
			modal.id = 'ep-sorter';
			modal.setAttribute(UI_ATTR, '1');
			modal.innerHTML = `
				<h4>Sort selectors — ${storageKey}.${jsonKey}</h4>
				<div class="ep-sorter-list" id="ep-sorter-list"></div>
				<div style="display:flex; gap:8px; justify-content:flex-end;">
					<button id="ep-sort-save" class="ep-mini">Save</button>
					<button id="ep-sort-cancel" class="ep-mini">Cancel</button>
				</div>
			`;
			document.body.appendChild(modal);

			const listWrap = modal.querySelector('#ep-sorter-list');

			function renderList(){
				listWrap.innerHTML = '';
				list.forEach((item, idx) => {
					const row = document.createElement('div');
					row.className = 'ep-sorter-item';
					row.draggable = true;
					row.setAttribute('data-idx', idx);

					const preview = document.createElement('div');
					preview.className = 'sel-preview';
					preview.title = item;
					preview.textContent = item;

					const input = document.createElement('input');
					input.type = 'text';
					input.value = item;
					input.style.minWidth = '160px';
					input.style.marginLeft = '8px';
					input.addEventListener('change', (e) => {
						list[idx] = e.target.value.trim();
						renderList();
					});

					const up = document.createElement('button'); up.className = 'ep-sort-btn'; up.textContent = '↑';
					const down = document.createElement('button'); down.className = 'ep-sort-btn'; down.textContent = '↓';
					const del = document.createElement('button'); del.className = 'ep-sort-btn'; del.textContent = '✕';
					const grab = document.createElement('div'); grab.textContent = '⋮'; grab.style.padding = '0 6px';

					up.addEventListener('click', () => {
						if (idx <= 0) return;
						[list[idx-1], list[idx]] = [list[idx], list[idx-1]];
						renderList();
					});
					down.addEventListener('click', () => {
						if (idx >= list.length-1) return;
						[list[idx+1], list[idx]] = [list[idx], list[idx+1]];
						renderList();
					});
					del.addEventListener('click', () => {
						list.splice(idx, 1);
						renderList();
					});

					// drag handlers
					row.addEventListener('dragstart', (e) => {
						e.dataTransfer.setData('text/idx', String(idx));
						row.classList.add('dragging');
					});
					row.addEventListener('dragend', () => {
						row.classList.remove('dragging');
					});
					row.addEventListener('dragover', (e) => {
						e.preventDefault();
					});
					row.addEventListener('drop', (e) => {
						e.preventDefault();
						const from = Number(e.dataTransfer.getData('text/idx'));
						const to = idx;
						if (!Number.isFinite(from)) return;
						const item = list.splice(from, 1)[0];
						list.splice(to, 0, item);
						renderList();
					});

					row.appendChild(grab);
					row.appendChild(preview);
					row.appendChild(input);
					const ctrls = document.createElement('div');
					ctrls.style.display = 'flex';
					ctrls.style.gap = '6px';
					ctrls.appendChild(up); ctrls.appendChild(down); ctrls.appendChild(del);
					row.appendChild(ctrls);
					listWrap.appendChild(row);
				});
			}

			renderList();

			modal.querySelector('#ep-sort-save').addEventListener('click', () => {
				const obj = loadStorageObject(storageKey);
				// set metadata
				try { obj.lastUpd = new Date().toISOString(); } catch(e){}
				try { obj.site = location.hostname || ''; } catch(e){}
				const joined = joinSelectorsString(list);
				setNested(obj, jsonKey, joined);
				if (saveStorageObject(storageKey, obj)) {
					showSavedMsg(`Saved order to ${storageKey}.${jsonKey}`);
					modal.remove();
				} else {
					showSavedMsg('Failed to save sorted list', true);
				}
			});
			modal.querySelector('#ep-sort-cancel').addEventListener('click', () => {
				modal.remove();
			});
		}

		// isOurUI and pick handlers (unchanged besides using nested helpers where needed)
		function isOurUI(el){ return !!(el && (el.closest && el.closest('[data-ep-ui]'))); }

		let currentTarget = null;
		let locked = false;
		function updateFloaterPos(x,y){
			floater.style.left = `${x + 12}px`;
			floater.style.top = `${y + 12}px`;
			floater.style.opacity = '1';
			floater.style.transform = 'translateY(0)';
		}
		const onMouseMove = (ev) => {
			if (locked) return;
			const x = ev.clientX, y = ev.clientY;
			updateFloaterPos(x,y);
			let el = document.elementFromPoint(x, y);
			if (isOurUI(el)){
				hoverOverlay.style.display = 'none';
				currentTarget = null;
				return;
			}
			if (el && el !== currentTarget){
				currentTarget = el;
				const r = el.getBoundingClientRect();
				hoverOverlay.style.display = 'block';
				hoverOverlay.style.left = `${r.left + window.scrollX}px`;
				hoverOverlay.style.top = `${r.top + window.scrollY}px`;
				hoverOverlay.style.width = `${r.width}px`;
				hoverOverlay.style.height = `${r.height}px`;
				hoverOverlay.style.borderRadius = window.getComputedStyle(el).borderRadius || '4px';
			}
		};

		let clickState = 0;
		let lastClickedEl = null;
		const onClick = (ev) => {
			if (isOurUI(ev.target)) return;
			ev.preventDefault();
			ev.stopPropagation();

			const clicked = ev.target;
			if (clickState === 0 || lastClickedEl !== clicked){
				clickState = 1;
				lastClickedEl = clicked;
				const rect = clicked.getBoundingClientRect();
				floater.textContent = 'Tap/click again on the same element to confirm selection';
				floater.style.left = `${rect.left + window.scrollX + 8}px`;
				floater.style.top = `${rect.top + window.scrollY - 28}px`;
				floater.style.opacity = '1';
				floater.style.transform = 'translateY(0)';
				setTimeout(()=> {
					floater.style.opacity = '0';
					floater.style.transform = 'translateY(-6px)';
				}, 1600);
				return;
			}

			if (clickState === 1 && lastClickedEl === clicked){
				locked = true;
				const selector = getUniqueSelector(clicked);
				const attrs = getAttributes(clicked);
				details.style.display = 'block';
				details.querySelector('#ep-selector-input').value = selector;
				details.querySelector('#ep-attrs').value = JSON.stringify(attrs, null, 2);
				details.querySelector('#ep-text').value = (clicked.textContent || '').trim();
				details.scrollIntoView({behavior: 'smooth', block: 'end'});
				populateChildDropdown(clicked, selector);
				const info = {
					selector,
					attributes: attrs,
					tagName: clicked.tagName.toLowerCase(),
					outerHTML: clicked.outerHTML,
					text: (clicked.textContent || '').trim(),
					timestamp: Date.now()
				};
				if (onConfirm) {
					try { onConfirm(info); } catch(e){}
				}
				resolvePromise(info);
				highlightElement(clicked);
				teardownPickListeners();
			}
		};

		const onKeyDown = (ev) => {
			if (ev.key === 'Escape') cleanup();
		};

		let timerHandle = null;
		function setupPickListeners(){
			document.addEventListener('mousemove', onMouseMove, true);
			document.addEventListener('click', onClick, true);
			document.addEventListener('keydown', onKeyDown, true);
			timerHandle = setTimeout(()=> {
				if (!locked) cleanup();
			}, timerSeconds * 1000 + 100);
		}
		function teardownPickListeners(){
			document.removeEventListener('mousemove', onMouseMove, true);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
		}

		function cleanup(){
			[notify, hoverOverlay, floater, details].forEach(el => { try{ el.remove(); }catch(e){} });
			const sorter = document.getElementById('ep-sorter'); if (sorter) sorter.remove();
			teardownPickListeners();
			if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
			resolvePromise(null);
			try { if (globalOverlay) { globalOverlay.remove(); globalOverlay = null; } } catch(e){}
		}

		// Promise support
		let promResolve;
		const prom = new Promise((res) => { promResolve = res; });
		function resolvePromise(val){
			setTimeout(()=> {
				try { promResolve(val); } catch(e){}
			}, 0);
		}

		setupPickListeners();

		return {
			promise: prom,
			cancel: cleanup
		};
	}

	// expose for tampermonkey sandbox convenience
	try {
		if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
			try { unsafeWindow.startElementPicker = startElementPicker; } catch(e){}
		}
	} catch(e){}

	try { startElementPicker.version = VERSION; } catch(e){}

	return startElementPicker;
}));