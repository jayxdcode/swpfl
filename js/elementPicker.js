/* Element Picker — UMD build
   Exports: startElementPicker
   Usage (browser): window.startElementPicker(...)
   Usage (CommonJS): const startElementPicker = require('...') 
*/
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		define([], factory);
	} else if (typeof module === 'object' && module.exports) {
		module.exports = factory();
	} else {
		// attach to the global root (window/self)
		root.startElementPicker = factory();
	}
}(typeof self !== 'undefined' ? self : this, function () {

	// Prevent double-loading across contexts
	if (typeof globalThis !== 'undefined' && globalThis.__elementPickerLoaded) {
		// if already loaded and has the function, reuse it
		if (globalThis.startElementPicker) return globalThis.startElementPicker;
		// otherwise continue but avoid reinitializing UI internals twice
	}
	try { if (typeof globalThis !== 'undefined') globalThis.__elementPickerLoaded = true; } catch(e){}

	// Utility: escape CSS identifiers if CSS.escape exists; else simple fallback
	const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([ !"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');

	// Generates a compact but reasonably unique selector for element `el`.
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

	// Read attributes as {name: value}
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

	// Create base styles (once)
	function injectStyles(){
		if (document.getElementById('ep-styles')) return;
		const css = `
/* element picker styles (prefix ep-) */
#ep-notify {
	position: fixed;
	right: 16px;
	top: 16px;
	background: #000;
	color: #fff;
	border: 1px solid rgba(255,255,255,0.12);
	padding: 12px 14px;
	border-radius: 8px;
	box-shadow: 0 6px 18px rgba(0,0,0,0.5);
	z-index: 2147483000;
	min-width: 240px;
	font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
#ep-notify .ep-close{
	position: absolute;
	right: 6px;
	top: 6px;
	background: transparent;
	border: 0;
	color: #bbb;
	font-size: 14px;
	cursor: pointer;
}
#ep-notify .ep-title{ font-weight: 600; margin-bottom: 6px; }
#ep-notify .ep-message{ font-size: 13px; opacity: 0.95; margin-bottom: 8px; }
#ep-notify .ep-timer {
	position: relative;
	height: 6px;
	background: rgba(255,255,255,0.06);
	border-radius: 4px;
	overflow: hidden;
}
#ep-notify .ep-timer > i {
	position: absolute;
	left: 0; top: 0; bottom: 0;
	width: 100%;
	background: linear-gradient(90deg, #07f 0%, #0af 100%);
	animation: ep-bar-var linear forwards;
}
@keyframes ep-bar-var { from { width: 100%; } to { width: 0%; } }

/* Hover highlight */
.ep-highlight-overlay {
	pointer-events: none;
	position: fixed;
	background: rgba(0,120,255,0.08);
	box-shadow: 0 0 0 2px rgba(0,160,255,0.95) inset;
	border-radius: 4px;
	z-index: 2147482999;
	transition: all 0.06s ease;
}

/* small floating label near cursor/element */
.ep-floater {
	position: fixed;
	z-index: 2147483001;
	background: rgba(0,0,0,0.85);
	color: #fff;
	padding: 6px 10px;
	border-radius: 6px;
	font-size: 13px;
	border: 1px solid rgba(255,255,255,0.06);
	pointer-events: none;
	opacity: 0;
	transform: translateY(-6px);
	transition: opacity 180ms ease, transform 180ms ease;
}

/* details window */
#ep-details {
	position: fixed;
	left: 20px;
	bottom: 20px;
	width: 420px;
	max-width: calc(100% - 40px);
	background: #0b0b0b;
	color: #fff;
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 10px;
	padding: 14px;
	box-shadow: 0 12px 34px rgba(0,0,0,0.6);
	z-index: 2147483000;
	font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
#ep-details h3{ margin: 0 0 10px 0; font-size: 15px; }
#ep-details .ep-row{ margin-bottom: 8px; font-size: 13px; }
#ep-details input[type="text"]{
	width: calc(100% - 96px);
	padding: 8px 10px;
	background: rgba(255,255,255,0.03);
	color: #fff;
	border: 1px solid rgba(255,255,255,0.04);
	border-radius: 6px;
}
#ep-details button {
	padding: 8px 10px;
	border-radius: 6px;
	border: 0;
	background: #07f;
	color: #fff;
	cursor: pointer;
	margin-left: 8px;
}
#ep-details textarea{
	width: 100%;
	height: 120px;
	padding: 8px;
	border-radius: 6px;
	background: rgba(255,255,255,0.03);
	color: #fff;
	border: 1px solid rgba(255,255,255,0.04);
	font-family: monospace;
	font-size: 12px;
	resize: vertical;
}

/* tiny helper buttons */
.ep-mini {
	font-size: 12px;
	padding: 6px 8px;
	border-radius: 6px;
	border: 0px;
	cursor: pointer;
	background: rgba(255,255,255,0.03);
	color: #fff;
	margin-left: 6px;
}
.ep-saved-msg {
	font-size: 12px;
	color: #aef;
	margin-top: 8px;
}
@media (max-width:480px){
	#ep-details{ width: calc(100% - 32px); left: 16px; right: 16px; bottom: 16px; }
}
`;
		const style = document.createElement('style');
		style.id = 'ep-styles';
		style.textContent = css;
		document.head.appendChild(style);
	}

	// main exported function
	function startElementPicker(opts = {}){
		injectStyles();
		const onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
		const timerSeconds = Number(opts.timeoutSeconds) || 8; // notification dismiss timer
		// mark UI elements so we ignore them when picking
		const UI_ATTR = 'data-ep-ui';

		// Create notify popup
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
		// set timer animation duration
		const bar = notify.querySelector('.ep-timer > i');
		bar.style.animationDuration = `${timerSeconds}s`;

		// close button
		const closeBtn = notify.querySelector('.ep-close');
		closeBtn.addEventListener('click', cleanup);

		// Overlay highlight
		const overlay = document.createElement('div');
		overlay.className = 'ep-highlight-overlay';
		overlay.setAttribute(UI_ATTR, '1');
		document.body.appendChild(overlay);

		// Floater label
		const floater = document.createElement('div');
		floater.className = 'ep-floater';
		floater.setAttribute(UI_ATTR, '1');
		floater.textContent = 'Click the element again to lock it in';
		document.body.appendChild(floater);

		// details window (hidden until confirmed)
		const details = document.createElement('div');
		details.id = 'ep-details';
		details.setAttribute(UI_ATTR, '1');
		details.style.display = 'none';
		details.innerHTML = `
			<h3>Element details</h3>
			<div class="ep-row"><strong>Selector</strong></div>
			<div class="ep-row">
				<input type="text" id="ep-selector-input" readonly />
				<button class="ep-mini" id="ep-copy-selector">Copy</button>
			</div>
			<div class="ep-row"><strong>Attributes</strong></div>
			<textarea id="ep-attrs" readonly></textarea>
			<div class="ep-row" style="display:flex; align-items:center; gap:8px; margin-top:8px;">
				<input id="ep-config-key" type="text" placeholder="Enter a new or existing config key (e.g. merged.el1)" list="ep-config-keys" />
				<datalist id="ep-config-keys"></datalist>
				<button id="ep-update" class="ep-mini">Update</button>
				<button id="ep-close-details" class="ep-mini">Close</button>
			</div>
			<div id="ep-saved" class="ep-saved-msg" style="display:none"></div>
		`;
		document.body.appendChild(details);

		// populate datalist with existing localStorage keys
		const datalist = details.querySelector('#ep-config-keys');
		function refreshDatalist(){
			datalist.innerHTML = '';
			try{
				for (let i=0;i<localStorage.length;i++){
					const key = localStorage.key(i);
					const opt = document.createElement('option');
					opt.value = key;
					datalist.appendChild(opt);
				}
			}catch(e){
				// storage access denied (private mode) - ignore
			}
		}
		refreshDatalist();

		// small helper: center overlay on element
		function highlightElement(el){
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

		let currentTarget = null;
		let locked = false;

		// show floater near mouse
		function updateFloaterPos(x,y){
			floater.style.left = `${x + 12}px`;
			floater.style.top = `${y + 12}px`;
			floater.style.opacity = '1';
			floater.style.transform = 'translateY(0)';
		}

		// small helper to check if an element is part of our UI
		function isOurUI(el){
			return !!(el && (el.closest && el.closest('[data-ep-ui]')));
		}

		// Mouse move tracks hovered element and positions the floater
		const onMouseMove = (ev) => {
			if (locked) return;
			const x = ev.clientX, y = ev.clientY;
			updateFloaterPos(x,y);
			let el = document.elementFromPoint(x, y);
			// ignore if element is part of our UI
			if (isOurUI(el)){
				highlightElement(null);
				currentTarget = null;
				return;
			}
			if (el && el !== currentTarget){
				currentTarget = el;
				highlightElement(el);
			}
		};

		// Single-click: first click marks and asks to click again (we'll show the floater message)
		let clickState = 0;
		let lastClickedEl = null;

		const onClick = (ev) => {
			// ignore UI
			if (isOurUI(ev.target)) return;
			ev.preventDefault();
			ev.stopPropagation();

			const clicked = ev.target;
			// first click
			if (clickState === 0 || lastClickedEl !== clicked){
				clickState = 1;
				lastClickedEl = clicked;
				// show temporary floater message near element
				const rect = clicked.getBoundingClientRect();
				floater.textContent = 'Tap/click again on the same element to confirm selection';
				floater.style.left = `${rect.left + window.scrollX + 8}px`;
				floater.style.top = `${rect.top + window.scrollY - 28}px`;
				floater.style.opacity = '1';
				floater.style.transform = 'translateY(0)';
				setTimeout(()=> {
					// fade out floater after 1.6s if not confirmed
					floater.style.opacity = '0';
					floater.style.transform = 'translateY(-6px)';
				}, 1600);
				return;
			}

			// second click on same element -> lock it
			if (clickState === 1 && lastClickedEl === clicked){
				locked = true;
				const selector = getUniqueSelector(clicked);
				const attrs = getAttributes(clicked);
				details.style.display = 'block';
				details.querySelector('#ep-selector-input').value = selector;
				details.querySelector('#ep-attrs').value = JSON.stringify(attrs, null, 2);
				details.scrollIntoView({behavior: 'smooth', block: 'end'});
				const info = {
					selector,
					attributes: attrs,
					tagName: clicked.tagName.toLowerCase(),
					outerHTML: clicked.outerHTML,
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

		// keyboard handler for cancel
		const onKeyDown = (ev) => {
			if (ev.key === 'Escape') cleanup();
		};

		// copy selector button
		const copyBtn = details.querySelector('#ep-copy-selector');
		copyBtn.addEventListener('click', () => {
			const v = details.querySelector('#ep-selector-input').value;
			navigator.clipboard && navigator.clipboard.writeText(v).then(()=>{
				showSavedMsg('Selector copied to clipboard');
			}, ()=> showSavedMsg('Copied (fallback may be required)'));
		});

		// update/save to localStorage
		const updateBtn = details.querySelector('#ep-update');
		updateBtn.addEventListener('click', () => {
			const keyInput = details.querySelector('#ep-config-key');
			const key = keyInput.value && keyInput.value.trim();
			if (!key){
				showSavedMsg('Enter a config key to save', true);
				return;
			}
			const payload = {
				selector: details.querySelector('#ep-selector-input').value,
				attributes: (() => {
					try { return JSON.parse(details.querySelector('#ep-attrs').value); } catch(e){ return details.querySelector('#ep-attrs').value; }
				})(),
				html: details.querySelector('#ep-attrs').value,
				savedAt: new Date().toISOString()
			};
			try{
				localStorage.setItem(key, JSON.stringify(payload));
				refreshDatalist();
				showSavedMsg(`Saved to localStorage['${key}']`);
			}catch(e){
				showSavedMsg('Failed to save to localStorage', true);
			}
		});

		// close details
		details.querySelector('#ep-close-details').addEventListener('click', cleanup);

		// Helper message shown under details window
		const savedDiv = details.querySelector('#ep-saved');
		function showSavedMsg(msg, isError){
			savedDiv.style.display = 'block';
			savedDiv.textContent = msg;
			savedDiv.style.color = isError ? '#f88' : '#aef';
			setTimeout(()=> {
				savedDiv.style.display = 'none';
			}, 2400);
		}

		// Setup listeners
		function setupPickListeners(){
			document.addEventListener('mousemove', onMouseMove, true);
			document.addEventListener('click', onClick, true);
			document.addEventListener('keydown', onKeyDown, true);
			timerHandle = setTimeout(()=> {
				if (!locked) cleanup();
			}, timerSeconds * 1000 + 100); // a tiny buffer
		}

		// teardown picking listeners (called when element locked)
		function teardownPickListeners(){
			document.removeEventListener('mousemove', onMouseMove, true);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
			// keep overlay & details open until closed by user
		}

		// Cleanup all UI and listeners
		let timerHandle = null;
		function cleanup(){
			[notify, overlay, floater, details].forEach(el => { try{ el.remove(); }catch(e){} });
			document.removeEventListener('mousemove', onMouseMove, true);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
			if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
			resolvePromise(null);
		}

		// Promise support: return a promise that resolves when selection confirmed or canceled
		let promResolve;
		const prom = new Promise((res) => { promResolve = res; });
		function resolvePromise(val){
			setTimeout(()=> {
				try { promResolve(val); } catch(e){}
			}, 0);
		}

		// start listeners
		setupPickListeners();

		// return object with promise and cancel helper
		return {
			promise: prom,
			cancel: cleanup
		};
	}

	// try to expose to unsafeWindow for Tampermonkey sandbox convenience
	try {
		if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
			try { unsafeWindow.startElementPicker = startElementPicker; } catch(e){}
		}
	} catch(e){}

	// Provide the function as the factory return value
	return startElementPicker;
}));