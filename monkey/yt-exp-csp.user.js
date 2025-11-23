// ==UserScript==
// @name         YouTube Music Floating Lyrics
// @namespace    http://tampermonkey.net/
// @version      2.0.4-CSP
// @description  YT Music version of SWPFL. Synced lyrics with translation/romanization resizable/draggable panel, themed, opacity control. Translations are provided by Gemini 2.0 Flash and 1.5 Flash via the Google AI Studio API (Accessed via a remote server).
// @author       jayxdcode
// @match        https://music.youtube.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @connect      lrclib.net
// @connect      src-backend.onrender.com
// @connect      genius.com
// @connect      google.com
// @connect      sv443.net
// @copyright    2025, jayxdcode
// @sandbox      JavaScript
// @run-at       document-start
// @require      https://raw.githubusercontent.com/jayxdcode/swpfl/refs/heads/main/js/elementPicker.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.7/purify.min.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=music.youtube.com
// @downloadURL  https://raw.githubusercontent.com/jayxdcode/swpfl/refs/heads/main/monkey/yt-exp-csp.user.js?dl=true
// @updateURL    https://raw.githubusercontent.com/jayxdcode/swpfl/refs/heads/main/monkey/yt-exp-csp.user.js?dl=true
// ==/UserScript==

(function() {
    'use strict';
    
    // -- begin --
    try {
        GM_notification({ text: '[2.0.4-CSP] Script Started..', title: 'Userscript Alert', timeout: 7500, onclick: () => { console.log('Notification clicked!'); }, ondone: (wasClicked) => { console.log(`Notification closed. Clicked: ${wasClicked}`); } });
        
        const YTML_VERSION = '2.0.4-CSP';
        const YTML_USER_AGENT = `YTML (user.js release) v${YTML_VERSION} (https://github.com/jayxdcode/swpfl)`;
        
        const LRCLIB_HEADERS = {
            'User-Agent': YTML_USER_AGENT,
            'Accept': "application/json"
        };
        
        const mobileDebug = false; // only set to true if you have eruda.
        let got = false
        
        /*
        developer flags. keep all ``toggle``s to false in release unless you know what you are doing.
        */
        
        let prefs = {
            activeBeta: {
                lrcNotif: false, // toggle
            },
            
            devOps: false, // toggle
            // local development experiment. doesnt do anything if you are not the developer (may throw an error tho)
            
            ws: false, // toggle
            wsLastSent: null,
            
            lrcNotif: {
                silent: false,
                singleMode: true,
                fallback: false,
                maxNotifs: 5,
            },
        }
        
        // *** ENDING OF developer flags ***
        
        /*
        UPDATE v2.9.2 (from swpfl): added all querySelectors in one area for easier patches when site changes querySelectors. (Also for reusing code for other sites like YTM)
        */
        const defSel = {
            "lastUpd": "2025-11-16T12:22:59.590Z",
            "site": "music.youtube.com",
            "version": 5,
            "title": [
                "yt-formatted-string.title.style-scope.ytmusic-player-bar",
                "body > ytmusic-app > ytmusic-app-layout.style-scope.ytmusic-app > ytmusic-player-bar.style-scope.ytmusic-app > div.middle-controls.style-scope.ytmusic-player-bar:nth-of-type(2) > div.content-info-wrapper.style-scope.ytmusic-player-bar:nth-of-type(2) > yt-formatted-string.title.style-scope.ytmusic-player-bar"
            ],
            "artist": [
                "body > ytmusic-app > ytmusic-app-layout.style-scope.ytmusic-app > ytmusic-player-page.style-scope.ytmusic-app > div.content.style-scope.ytmusic-player-page > div.style-scope.ytmusic-player-page:nth-of-type(3) > ytmusic-player-controls.style-scope.ytmusic-player-page > div.metadata-and-progress.style-scope.ytmusic-player-controls:nth-of-type(1) > div.content-info-wrapper.style-scope.ytmusic-player-controls:nth-of-type(1) > div.byline-wrapper.style-scope.ytmusic-player-controls > yt-formatted-string.byline.style-scope.ytmusic-player-controls",
                "div.middle-controls > div.content-info-wrapper > span.byline-wrapper > span.subtitle > yt-formatted-string.byline > a.yt-simple-endpoint:nth-of-type(1)",
                "ytmusic-app > #layout > ytmusic-player-bar.style-scope.ytmusic-app > div.middle-controls.style-scope.ytmusic-player-bar:nth-of-type(2) > div.content-info-wrapper.style-scope.ytmusic-player-bar:nth-of-type(2) > span.byline-wrapper.style-scope.ytmusic-player-bar > span.subtitle.style-scope.ytmusic-player-bar:nth-of-type(2) > yt-formatted-string.byline.style-scope.ytmusic-player-bar.complex-string > a.yt-simple-endpoint.style-scope.yt-formatted-string"
            ],
            "bar": "#layout > ytmusic-player-bar.style-scope",
            "YTMPROG": "#progress-bar",
            "album": [
                "div.middle-controls > div.content-info-wrapper > span.byline-wrapper > span.subtitle > yt-formatted-string.byline > a.yt-simple-endpoint:nth-of-type(2)",
                "ytmusic-app > #layout > ytmusic-player-bar.style-scope.ytmusic-app > div.middle-controls.style-scope.ytmusic-player-bar:nth-of-type(2) > div.content-info-wrapper.style-scope.ytmusic-player-bar:nth-of-type(2) > span.byline-wrapper.style-scope.ytmusic-player-bar > span.subtitle.style-scope.ytmusic-player-bar:nth-of-type(2) > yt-formatted-string.byline.style-scope.ytmusic-player-bar.complex-string > a.yt-simple-endpoint.style-scope.yt-formatted-string:nth-of-type(2)"
            ]
        }
        
        // Replace the broken cfgUtil with this:
        const cfgUtil = (mvar) => Array.isArray(mvar) ? mvar : (mvar ? [mvar] : []);
        
        // helper: try selectors in order and return first matching element (or null)
        function queryFirst(selOrArray, root = document) {
            if (!selOrArray) return null;
            const list = Array.isArray(selOrArray) ? selOrArray : [selOrArray];
            for (const s of list) {
                try {
                    const el = root.querySelector(s);
                    if (el) return el;
                } catch (e) {
                    // invalid selector — skip
                    console.debug('[queryFirst] invalid selector', s, e?.message || e);
                }
            }
            return null;
        }
        
        /*
        UPDATE v1.3.1: phase 1 - using localStorage to have editing capabilities for advance users and devs
        */
        const SELECTORS = (() => {
            try {
                // Attempt to parse the stored item; if getItem returns null,
                // JSON.parse throws an error on invalid input, which is handled by catch.
                if (localStorage.getItem('selectorscfg') === null) localStorage.setItem('selectorscfg', JSON.stringify(defSel))
                const parsed = JSON.parse(localStorage.getItem('selectorscfg'));
                // Check if parsed is non-null and not 'undefined' (for cases like "null" string)
                return (parsed !== null && parsed !== undefined) ? parsed : defSel;
            } catch (e) {
                // Falls here if getItem('context') is null (first error case),
                // or if the stored string is invalid JSON (second error case).
                return defSel;
            }
        })();
        
        const BACKEND_URL = "https://src-backend.onrender.com/api/translate";
        
        const POLL_INTERVAL = 1000;
        const STORAGE_KEY = 'tm-lyrics-panel-position';
        const SIZE_KEY = 'tm-lyrics-panel-size';
        const THEME_KEY = 'tm-lyrics-theme';
        const OPACITY_KEY = 'tm-lyrics-opacity';
        const CONFIG_KEY = 'tm-lyrics-config';
        
        const compWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        let lyricsConfig = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
        let lastCandidates = [];
        let currentTrackId = null;
        let currentTrackDur = null;
        let currInf = null;
        let syncIntervalId = null;
        let prevLyricsData = null;
        let lyricsData = null;
        let observer = null;
        let isDragging = false;
        let dragLocked = false;
        let isResizing = false;
        let currentOpacity = parseFloat(localStorage.getItem(OPACITY_KEY)) || 0.85;
        let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';
        let lastRenderedIdx = -1;
        
        let logVisible = false
        
        let dur = 0;
        let playbackPos = 0;
        
        const fallbackSync = true;
        
        let notifExists = false;
        let notifIdx = 0;
        
        const delayTune = 0; // How much delay do you observe? (in ms)
        
        // Icon style (Material Icons)
        GM_addStyle(`
@import url('https://fonts.googleapis.com/icon?family=Material+Icons');

.material-icons-button {
  /* Set the font family for any element using this class */
  font-family: 'Material Icons';
  /* Standard icon properties */
  font-weight: normal;
  font-style: normal;
  font-size: 24px; /* Adjust size as needed */
  display: inline-block;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  white-space: nowrap;
  direction: ltr;

  /* Support for all WebKit browsers. */
  -webkit-font-smoothing: antialiased;
  /* Support for Safari and Chrome. */
  text-rendering: optimizeLegibility;
  /* Support for Firefox. */
  -moz-osx-font-smoothing: grayscale;
  /* Support for IE. */
  font-feature-settings: 'liga';
}
`);
        
        /**
         * Creates and inserts a CSP-safe element, leveraging Trusted Types and DOMPurify for robust security.
         *
         * It prioritizes:
         * 1. Using a Trusted Types policy for innerHTML/Scripts if available and sanitized (RECOMMENDED).
         * 2. Falling back to element creation and using textContent/appendChild if Trusted Types is not active.
         *
         * NOTE: This function requires the global availability of DOMPurify (e.g., from the 'dompurify' library).
         *
         * @param {HTMLElement|string} parent - The parent element or a CSS selector string.
         * @param {string} tagName - The tag name of the element to create (e.g., 'div', 'p', 'script').
         * @param {object} [attributes={}] - An object mapping attribute names to values.
         * @param {string} [content=''] - The content to insert. For regular elements, this is HTML/text. For 'script' elements, this is the script content or URL.
         * @returns {HTMLElement|null} The created element, or null if creation failed.
         */
        function createCSPSafeElement(parent, tagName, attributes = {}, content = '') {
            // Check for DOMPurify dependency
            if (typeof DOMPurify === 'undefined') {
                console.error('DOMPurify is required for CSP-safe element creation using sanitization.');
                return null;
            }
            
            // 1. Resolve the parent element
            let parentEl = parent;
            if (typeof parent === 'string') {
                parentEl = document.querySelector(parent);
            }
            
            if (!parentEl) {
                console.error('Parent element not found.');
                return null;
            }
            
            // 2. Create the new element
            const newElement = document.createElement(tagName);
            const isScript = tagName.toLowerCase() === 'script';
            
            // 3. Apply attributes
            for (const key in attributes) {
                if (attributes.hasOwnProperty(key)) {
                    newElement.setAttribute(key, attributes[key]);
                }
            }
            
            // 4. Handle Content Insertion (The CSP-Safe Part)
            
            // Check if Trusted Types API is available and active
            if (typeof trustedTypes !== 'undefined' && content) {
                try {
                    // A. Create a secure policy using DOMPurify for sanitation
                    const policy = trustedTypes.createPolicy('csp-safe-purify', {
                        // Policy for innerHTML content
                        createHTML: (html) => {
                            // Sanitize the HTML content using DOMPurify before converting to a TrustedHTML object
                            return DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true });
                        },
                        
                        // Policy for script content (inline scripts)
                        createScript: (scriptContent) => {
                            // For script content, we might not need DOMPurify if we trust the source. 
                            // However, we return it as a TrustedScript to satisfy CSP.
                            // *A real-world application should validate this content source carefully.*
                            return scriptContent;
                        },
                        
                        // Policy for script source URLs (script tags with 'src' attribute)
                        createScriptURL: (url) => {
                            // Ensure the URL is allowed. In a production app, you would check 
                            // if the URL belongs to a trusted domain (e.g., allowlist).
                            if (url.startsWith('https://trusted-cdn.com/') || url.startsWith('/')) {
                                return url;
                            }
                            console.warn(`CSP-safe element creator blocked untrusted script URL: ${url}`);
                            return ''; // Block untrusted URLs
                        }
                    });
                    
                    // Apply content based on the element type
                    if (isScript) {
                        if (newElement.hasAttribute('src')) {
                            // Use createScriptURL for 'src' attribute
                            const trustedUrl = policy.createScriptURL(newElement.getAttribute('src'));
                            newElement.setAttribute('src', trustedUrl);
                        } else if (content) {
                            // Use createScript for inline script content
                            const trustedScript = policy.createScript(content);
                            newElement.textContent = trustedScript;
                        }
                    } else if (content) {
                        // Use createHTML for non-script elements (innerHTML)
                        const trustedContent = policy.createHTML(content);
                        newElement.innerHTML = trustedContent;
                    }
                    
                } catch (e) {
                    // Fallback if Trusted Types fails or policy is disallowed
                    console.error('Trusted Types operation failed. Falling back to textContent/blocking script.', e);
                    if (!isScript && content) {
                        newElement.textContent = content;
                    } else if (isScript) {
                        // If the script fails Trusted Types, we cannot safely load it, so we prevent insertion
                        return null;
                    }
                }
                
            } else if (content) {
                // B. Fallback: If Trusted Types is not available
                if (isScript) {
                    // If Trusted Types isn't available, script insertion is too risky without manual checks
                    console.warn('Cannot safely insert script element without Trusted Types. Blocking content.');
                    return null;
                } else {
                    // Use textContent for non-script elements to prevent XSS
                    newElement.textContent = content;
                }
            }
            
            // 5. Append the new element
            parentEl.appendChild(newElement);
            
            return newElement;
        }
        
        
        // ---- cancellation helpers (insert near other top-level globals) ----
        const gmFetchControllers = new Map(); // key -> [AbortController, ...] (supports multiple controllers per key)
        
        function addController(key, controller) {
            if (!gmFetchControllers.has(key)) gmFetchControllers.set(key, []);
            gmFetchControllers.get(key).push(controller);
        }
        
        function removeController(key, controller) {
            const arr = gmFetchControllers.get(key);
            if (!arr) return;
            const i = arr.indexOf(controller);
            if (i !== -1) arr.splice(i, 1);
            if (arr.length === 0) gmFetchControllers.delete(key);
        }
        
        /**
         * Abort all controllers under `key`
         */
        function abortFetch(key) {
            const arr = gmFetchControllers.get(key);
            if (!arr) return;
            arr.forEach(ctrl => {
                try {
                    ctrl.abort();
                } catch (_) {}
            });
            gmFetchControllers.delete(key);
            console.log(`[Lyrics] Aborted fetches for key: ${key}`);
        }
        
        /*******************
         * Abort everything *
         ********************/
        function abortAllFetches() {
            for (const key of Array.from(gmFetchControllers.keys())) abortFetch(key);
            console.log('[Lyrics] Aborted ALL fetches');
        }
        
        // --- Utility Functions ---
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
        
        // EXTENSION COMPATIBILITY  --- cors bypass patch ---
        
        /**
         * Custom fetch-like function that routes requests through the background script
         * to potentially bypass CORS or handle other privileged operations.
         *
         * @param {RequestInfo} input The URL or Request object.
         * @param {RequestInit} [init] An object containing custom settings for the request.
         * @returns {Promise<Response>} A Promise that resolves to the Response object.
         */
        async function fetchViaBackground(input, init) {
            return new Promise(async (resolve, reject) => {
                try {
                    // Send a message to the background script with the fetch arguments
                    // We need to stringify/parse complex objects like Headers if they are in 'init'
                    // For simplicity, let's assume 'init' might contain a simple body or headers object.
                    // If 'input' is a Request object, you'd need to serialize it as well.
                    // For most cases, input will be a string URL.
                    const serializedInit = {};
                    if (init) {
                        for (const key in init) {
                            if (Object.prototype.hasOwnProperty.call(init, key)) {
                                // Handle common cases like Headers or Body for serialization
                                if (key === 'headers' && init.headers instanceof Headers) {
                                    serializedInit.headers = {};
                                    for (const [hName, hValue] of init.headers.entries()) {
                                        serializedInit.headers[hName] = hValue;
                                    }
                                } else if (key === 'body' && (init.body instanceof ReadableStream || init.body instanceof Blob || init.body instanceof FormData)) {
                                    // For complex body types, you might need to read them into text/arrayBuffer first
                                    // For simplicity here, we'll assume JSON.stringify can handle it or pass as is.
                                    // A more robust solution might read the body here before sending.
                                    serializedInit.body = init.body; // Try sending as is, background might re-construct
                                } else {
                                    serializedInit[key] = init[key];
                                }
                            }
                        }
                    }
                    
                    // If 'input' is a Request object, you might want to extract its URL and init properties
                    let requestUrl = input;
                    if (input instanceof Request) {
                        requestUrl = input.url;
                        // Merge request's init with provided init, prioritizing provided init
                        serializedInit = {
                            ...input.init,
                            ...serializedInit
                        };
                    }
                    
                    
                    const responseFromBackground = await browser.runtime.sendMessage({
                        action: "makeFetchRequest",
                        url: requestUrl,
                        init: serializedInit
                    });
                    
                    // Handle errors or non-OK responses from the background script
                    if (responseFromBackground.error) {
                        const error = new Error(responseFromBackground.error || "Background fetch failed");
                        // Optionally attach more details from the background error
                        error.backgroundDetails = responseFromBackground.error;
                        reject(error);
                        return;
                    }
                    
                    // Reconstruct a Response object from the data sent by the background script
                    const mockResponse = {
                        ok: responseFromBackground.ok,
                        status: responseFromBackground.status,
                        statusText: responseFromBackground.statusText,
                        headers: new Headers(responseFromBackground.headers || {}),
                        url: responseFromBackground.url || requestUrl,
                        type: 'default',
                        redirected: false,
                        bodyUsed: false,
                        clone: () => ({
                            ...mockResponse
                        }),
                        // attach methods
                        text: () => Promise.resolve(responseFromBackground.textData),
                        json: () => {
                            try {
                                return Promise.resolve(JSON.parse(responseFromBackground.textData));
                            } catch (e) {
                                return Promise.reject(new Error("Failed to parse response as JSON"));
                            }
                        },
                        blob: () => Promise.resolve(new Blob([responseFromBackground.textData], {
                            type: mockResponse.headers.get('content-type') || 'application/octet-stream'
                        })),
                        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(responseFromBackground.textData).buffer)
                    };
                    
                    // Add these for compatibility
                    mockResponse.responseText = responseFromBackground.textData;
                    mockResponse.ok = responseFromBackground.ok;
                    mockResponse.status = responseFromBackground.status;
                    mockResponse.url = responseFromBackground.url || requestUrl;
                    
                    resolve(mockResponse);
                    
                } catch (error) {
                    debug("Error in fetchViaBackground:", error);
                    reject(error); // Handle errors from sendMessage or content script logic
                }
            });
        }
        
        // --- Panel viewport adjustment logic ---
        function handleViewportChange() {
            const panel = document.getElementById('tm-lyrics-panel');
            if (!panel) return;
            
            const rect = panel.getBoundingClientRect();
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            
            const isOutOfBounds =
                rect.left < 0 ||
                rect.top < 0 ||
                rect.right > winWidth ||
                rect.bottom > winHeight;
            
            const isTooLarge =
                rect.width > winWidth ||
                rect.height > winHeight;
            
            if (isOutOfBounds || isTooLarge) {
                window.debug('Panel is out of bounds or too large for viewport. Adjusting...');
                
                // Clamp size to fit viewport with a small margin
                const newWidth = Math.min(rect.width, winWidth - 20);
                const newHeight = Math.min(rect.height, winHeight - 20);
                panel.style.width = newWidth + 'px';
                panel.style.height = newHeight + 'px';
                
                // Re-check rect after resize
                const newRect = panel.getBoundingClientRect();
                
                // Clamp position to keep the panel fully inside the viewport
                const newLeft = Math.max(10, Math.min(newRect.left, winWidth - newRect.width - 10));
                const newTop = Math.max(10, Math.min(newRect.top, winHeight - newRect.height - 10));
                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
                
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    left: panel.style.left,
                    top: panel.style.top
                }));
                localStorage.setItem(SIZE_KEY, JSON.stringify({
                    width: panel.style.width,
                    height: panel.style.height
                }));
            }
        }
        
        // --- Manual Lyrics Menu ---
        function showManualLyricsMenu(trackKey) {
            try {
                // Ensure we have candidates
                if (!lastCandidates || !lastCandidates.length) {
                    const manualQuery = prompt('No lyric candidates available. Search manually:');
                    if (manualQuery && manualQuery.trim() !== '') {
                        loadLyrics('', '', '', currentTrackDur, (parsed) => {
                            lyricsData = parsed;
                            renderLyrics(0);
                            setupProgressSync(currInf.bar, currInf.duration);
                        }, {
                            flag: true,
                            query: manualQuery
                        });
                    }
                    return;
                }
                
                // Add blur overlay
                const existingOverlay = document.getElementById('tm-manual-overlay');
                if (existingOverlay) existingOverlay.remove();
                const overlay = document.createElement('div');
                overlay.id = 'tm-manual-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(5px)',
                    zIndex: 9999
                });
                overlay.onclick = () => {
                    overlay.remove();
                    menu.remove();
                };
                document.body.appendChild(overlay);
                
                // Remove any existing menu
                document.getElementById('tm-manual-menu')?.remove();
                
                // Container
                const menu = document.createElement('div');
                menu.id = 'tm-manual-menu';
                Object.assign(menu.style, {
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '90vw',
                    maxWidth: '600px',
                    maxHeight: '70vh',
                    background: '#2a2a2a',
                    color: '#fff',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 10000,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                });
                document.body.appendChild(menu);
                
                // Header with title & close
                const header = document.createElement('div');
                header.textContent = 'Choose Lyrics Source';
                Object.assign(header.style, {
                    padding: '12px 16px',
                    fontWeight: 'bold',
                    borderBottom: '1px solid #444',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                });
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                Object.assign(closeBtn.style, {
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    fontSize: '20px',
                    cursor: 'pointer'
                });
                closeBtn.onclick = () => {
                    overlay.remove();
                    menu.remove();
                };
                header.appendChild(closeBtn);
                menu.appendChild(header);
                
                // Scrollable list
                const list = document.createElement('div');
                Object.assign(list.style, {
                    flex: '1',
                    overflowY: 'auto',
                    padding: '8px'
                });
                menu.appendChild(list);
                
                function create(idx, lrcS, lrcP) {
                    const isSynced = !!lrcS;
                    
                    const panel = document.createElement('div');
                    Object.assign(panel.style, {
                        background: '#333',
                        borderRadius: '8px',
                        marginBottom: '8px',
                        overflow: 'hidden'
                    });
                    
                    // Summary row
                    const summary = document.createElement('div');
                    Object.assign(summary.style, {
                        padding: '10px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer'
                    });
                    // summary.innerHTML = `<span>Candidate ${idx + 1} <input type="button" id="toggle-${idx}" style="margin-left: 1em; size: .75em;" ${isSynced ? 'value="SYNCED"': 'value="PLAIN only" disabled'} /></span><span style="font-size:12px; opacity:.7;">▼</span>`;
                    const mainSpan = createCSPSafeElement(summary, 'span', {});
                    createCSPSafeElement(mainSpan, 'text', {
                        textContent: `Candidate ${idx + 1} `
                    });
                    const buttonValue = isSynced ? 'SYNCED' : 'PLAIN only';
                    const buttonDisabled = isSynced ? null : 'disabled';
                    createCSPSafeElement(mainSpan, 'input', {
                        type: 'button',
                        id: `toggle-${idx}`,
                        style: 'margin-left: 1em; size: .75em;',
                        value: buttonValue,
                        disabled: buttonDisabled
                    });
                    createCSPSafeElement(summary, 'span', {
                        style: 'font-size:12px; opacity:.7;',
                        textContent: '▼'
                    });
                    // Exp C
                    
                    // ttp is short for Transform to plain
                    function ttp(lrc) {
                        return lrc
                            .trim()
                            .split("\n")
                            .map(l => l.replace(/\[.*?\]/g, "")) // use .map to transform
                            .join("\n");
                    }
                    
                    panel.appendChild(summary);
                    
                    // 3-line preview
                    const preview = document.createElement('pre');
                    
                    preview.id = `prev${idx}`;
                    preview.textContent = (isSynced ? lrcS : lrcP).split("\n").slice(0, 3).join('\n');
                    Object.assign(preview.style, {
                        margin: '0 12px 8px',
                        padding: '0',
                        fontSize: '12px',
                        lineHeight: '1.2',
                        color: '#ccc'
                    });
                    panel.appendChild(preview);
                    
                    // Body (hidden full lyrics)
                    const body = document.createElement('pre');
                    
                    body.id = `item${idx}`;
                    body.textContent = isSynced ? lrcS : lrcP;
                    Object.assign(body.style, {
                        margin: 0,
                        padding: '8px 12px',
                        fontSize: '13px',
                        lineHeight: '1.4',
                        whiteSpace: 'pre-wrap',
                        display: 'none',
                        background: '#2b2b2b'
                    });
                    panel.appendChild(body);
                    
                    // Toggle on click
                    summary.onclick = () => {
                        const isOpen = body.style.display === 'block';
                        body.style.display = isOpen ? 'none' : 'block';
                        summary.querySelector('span:last-child').textContent = isOpen ? '▼' : '▲';
                        updateUseBtnState();
                    };
                    
                    // Only add click handler if synced
                    if (isSynced) {
                        let toggleEl = summary.querySelector(`#toggle-${idx}`);
                        toggleEl.addEventListener("click", function(event) {
                            event.stopPropagation();
                            try {
                                const prevEl = document.querySelector(`#prev${idx}`);
                                const itemEl = document.querySelector(`#item${idx}`);
                                if (!prevEl || !itemEl) return;
                                
                                const isCurrentlySynced = String(event.target.value || "").startsWith("SYNCED");
                                
                                if (isCurrentlySynced) {
                                    // switch from SYNCED -> PLAIN
                                    const content = (lrcP && typeof lrcP === 'string' && lrcP.trim()) ? lrcP.trim() : (lrcS ? ttp(lrcS) : "");
                                    event.target.value = "PLAIN";
                                    itemEl.textContent = content;
                                    prevEl.textContent = content.split("\n").slice(0, 3).join("\n");
                                } else {
                                    // switch from PLAIN -> SYNCED
                                    const content = (lrcS && typeof lrcS === 'string') ? lrcS.trim() : "";
                                    event.target.value = "SYNCED";
                                    itemEl.textContent = content;
                                    prevEl.textContent = content.split("\n").slice(0, 3).join("\n");
                                }
                                
                                updateUseBtnState();
                            } catch (err) {
                                // Defensive: don't let a toggle error corrupt the whole menu
                                debug('[ManualMenu toggle error]', err && err.message ? err.message : err);
                            }
                        });
                    }
                    
                    list.appendChild(panel);
                }
                
                lastCandidates.forEach((c, idx) => {
                    try {
                        if (c.syncedLyrics || c.plainLyrics) {
                            let lrcS = (typeof c.syncedLyrics === 'string') ? c.syncedLyrics.trim() : null;
                            let lrcP = (typeof c.plainLyrics === 'string') ? c.plainLyrics.trim() : null;
                            create(idx, lrcS, lrcP);
                        }
                    } catch (err) {
                        debug('[ManualMenu candidate error]', idx, err && err.message ? err.message : err);
                    }
                });
                
                // Footer with offset input + buttons
                const footer = document.createElement('div');
                Object.assign(footer.style,
                {
                    padding: '12px 16px',
                    borderTop: '1px solid #444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                });
                
                // Offset
                const offLabel = document.createElement('label');
                offLabel.textContent = 'Offset (ms):';
                Object.assign(offLabel.style,
                {
                    fontSize: '14px'
                });
                const offInput = document.createElement('input');
                offInput.type = 'number';
                offInput.value = lyricsConfig[trackKey]?.offset || 0;
                Object.assign(offInput.style,
                {
                    width: '60px',
                    padding: '4px',
                    borderRadius: '4px',
                    border: '1px solid #555',
                    background: '#444',
                    color: '#fff'
                });
                footer.appendChild(offLabel);
                footer.appendChild(offInput);
                
                // Manual Search button
                const searchBtn = document.createElement('button');
                searchBtn.textContent = 'Manual Search';
                Object.assign(searchBtn.style,
                {
                    padding: '6px 12px',
                    background: 'none',
                    color: '#fff',
                    border: '2px solid #555',
                    borderRadius: '4px',
                    cursor: 'pointer'
                });
                searchBtn.onclick = () => {
                    const manualQuery = prompt('Enter manual search query (e.g., song title and artist):');
                    if (manualQuery && manualQuery.trim() !== '') {
                        overlay.remove();
                        menu.remove();
                        const [title,
                            artist
                        ] = currentTrackId.split('|');
                        loadLyrics(title, artist, '', currentTrackDur, (parsed) => {
                            lyricsData = parsed;
                            renderLyrics(0);
                            if (currInf) {
                                setupProgressSync(currInf.bar, currInf.duration, currInf.vid);
                            }
                        },
                        {
                            flag: true,
                            query: manualQuery
                        });
                    }
                };
                footer.appendChild(searchBtn);
                
                // Reset Pick button
                const resetBtn = document.createElement('button');
                resetBtn.textContent = 'Reset Pick';
                Object.assign(resetBtn.style,
                {
                    padding: '6px 12px',
                    background: 'none',
                    color: '#fff',
                    border: '2px solid #555',
                    borderRadius: '4px',
                    cursor: 'pointer'
                });
                resetBtn.onclick = () => {
                    try {
                        const configRaw = localStorage.getItem(CONFIG_KEY) || '{}';
                        const config = JSON.parse(configRaw);
                        window.debug("[RESET] trackKey to delete:",
                            trackKey);
                        window.debug("[RESET] keys before delete:",
                            Object.keys(config));
                        delete config[trackKey];
                        localStorage.setItem(CONFIG_KEY,
                            JSON.stringify(config));
                        window.debug("[RESET] keys after delete:",
                            Object.keys(config));
                        
                        // Close the manual panel
                        overlay.remove();
                        menu.remove();
                        
                        // Reload lyrics from normal source
                        const [t, a] = trackKey.split('|');
                        loadLyrics(t,
                            a,
                            '',
                            currentTrackDur,
                            parsed => {
                                lyricsData = parsed;
                                renderLyrics(0);
                                if (currInf) setupProgressSync(currInf.bar, currInf.duration);
                            });
                    } catch (error) {
                        window.debug("[RESET] Failed to reset pick:",
                            error);
                    }
                };
                footer.appendChild(resetBtn);
                
                // Use Selected button
                const useBtn = document.createElement('button');
                useBtn.textContent = 'Use Selected';
                Object.assign(useBtn.style,
                {
                    padding: '6px 12px',
                    background: 'none',
                    color: '#fff',
                    border: '2px solid #333',
                    borderRadius: '4px',
                    cursor: 'pointer'
                });
                
                useBtn.onclick = () => {
                    const openBodies = Array.from(list.children)
                        .filter(p => p.querySelector('pre:last-of-type').style.display === 'block');
                    
                    if (openBodies.length !== 1) {
                        alert("Please select exactly one candidate to use.");
                        return;
                    }
                    
                    const rawLrc = openBodies[0].querySelector('pre:last-of-type').textContent;
                    const offset = parseInt(offInput.value, 10) || 0;
                    
                    const [t, a] = trackKey.split('|');
                    
                    lyricsConfig[trackKey] = { manualLrc: addTimestamps(rawLrc), offset };
                    localStorage.setItem(CONFIG_KEY, JSON.stringify(lyricsConfig));
                    
                    overlay.remove();
                    menu.remove();
                    
                    // reload. use normal loadLyrics so UI flow remains same
                    loadLyrics(t,
                        a,
                        '',
                        0,
                        parsed => {
                            lyricsData = parsed;
                            renderLyrics(0);
                            setupProgressSync(null, 0);
                        });
                };
                footer.appendChild(useBtn);
                
                menu.appendChild(footer);
                
                function updateUseBtnState() {
                    const openBodies = Array.from(list.children)
                        .filter(p => p.querySelector('pre[id^="item"]:last-of-type').style.display === 'block');
                    
                    if (openBodies.length === 1) {
                        // highlight
                        useBtn.style.borderColor = '#0a84ff';
                        useBtn.style.color = '#0a84ff';
                    } else {
                        // remove highlight
                        useBtn.style.borderColor = '#333';
                        useBtn.style.color = '#fff';
                    }
                }
                
                updateUseBtnState();
                
            } catch (e) {
                window.debug("[ERROR] showManualLyricsMenu error:", e.message);
            }
        }
        
        // --- Panel creation and drag/resize logic ---
        function createPanel() {
            try {
                document.getElementById('tm-lyrics-overlay')?.remove();
                const overlay = document.createElement('div');
                overlay.id = 'tm-lyrics-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    width: '100vw',
                    height: '100vh',
                    zIndex: 9998,
                    pointerEvents: 'none'
                });
                const panel = document.createElement('div');
                panel.id = 'tm-lyrics-panel';
                Object.assign(panel.style, {
                    position: 'fixed',
                    width: '470px',
                    height: '390px',
                    minWidth: '470px',
                    minHeight: '390px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    borderRadius: '10px',
                    fontSize: '25px',
                    lineHeight: '1.6',
                    padding: '0',
                    overflow: 'hidden',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    zIndex: 9999,
                    border: '2px solid #333',
                    display: 'flex',
                    flexDirection: 'column'
                });
                const defaultPos = {
                    left: '100px',
                    top: '100px'
                };
                const savedPos = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
                panel.style.left = (savedPos && savedPos.left) ? savedPos.left : defaultPos.left;
                panel.style.top = (savedPos && savedPos.top) ? savedPos.top : defaultPos.top;
                const savedSize = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
                if (savedSize && savedSize.width && savedSize.height) {
                    panel.style.width = savedSize.width;
                    panel.style.height = savedSize.height;
                }
                const header = document.createElement('div');
                header.id = 'tm-lyrics-header';
                Object.assign(header.style, {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 14px',
                    cursor: 'move',
                    userSelect: 'none',
                    borderTopLeftRadius: '10px',
                    borderTopRightRadius: '10px',
                    flexShrink: 0,
                });
                /* const title = document.createElement('span');
                title.id = 'tm-header-title';
                dragLocked ? createCSPSafeElement(title, 'em', {}, 'Lyrics (Locked)')  : createCSPSafeElement(title, 'em', {}, 'Lyrics');
                */
                
                const headerTitle = createCSPSafeElement(header, 'span', { id: 'tm-header-title' }, dragLocked ? `<em>Lyrics (Locked)</em>` : `<em>Lyrics</em>`)
                
                // header.appendChild(title);
                
                if (headerTitle) {
                    detectLongClick(headerTitle, toggleLogVisibility, null, 1000);
                } else {
                    debug('warn', 'createPanel warning: headerTitle doesnt exist. Either a failure occured in creation or there is an incorrect variable query.')
                }
                
                const controls = document.createElement('div');
                Object.assign(controls.style, {
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center'
                });
                const opDown = document.createElement('button');
                opDown.textContent = '- Opacity';
                opDown.addEventListener('click', () => {
                    currentOpacity = Math.max(0.2, parseFloat((currentOpacity - 0.1).toFixed(2)));
                    localStorage.setItem(OPACITY_KEY, currentOpacity);
                    applyTheme(panel);
                });
                const opUp = document.createElement('button');
                opUp.textContent = '+ Opacity';
                opUp.addEventListener('click', () => {
                    currentOpacity = Math.min(1, parseFloat((currentOpacity + 0.1).toFixed(2)));
                    localStorage.setItem(OPACITY_KEY, currentOpacity);
                    applyTheme(panel);
                });
                const manualBtn = document.createElement('button');
                manualBtn.textContent = 'Manual LRC';
                manualBtn.onclick = () => {
                    const trackKey = currentTrackId;
                    showManualLyricsMenu(trackKey);
                };
                const refreshBtn = document.createElement('button');
                refreshBtn.className = 'material-icons-button';
                refreshBtn.textContent = "refresh";
                detectLongClick(refreshBtn, () => { startElementPicker(); }, () => { currentTrackId = null; }, 500);
                
                const ghIcon = document.createElement('div');
                Object.assign(ghIcon.style, {
                    display: 'flex',
                    alignItems: 'center',
                    paddingTop: '5px',
                    fontSize: '14px'
                });
                // ghIcon.innerHTML = `<a href="https://github.com/jayxdcode" target="_blank" title="View on GitHub" style="opacity:0.8; color:white"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg></a>`;
                const GhLink = createCSPSafeElement(ghIcon, 'a', {
                    href: 'https://github.com/jayxdcode',
                    target: '_blank',
                    title: 'View on GitHub',
                    style: 'opacity:0.8; color:white'
                });
                
                const GhSvg = createCSPSafeElement(GhLink, 'svg', {
                    xmlns: 'http://www.w3.org/2000/svg',
                    width: '20',
                    height: '20',
                    fill: 'currentColor',
                    viewBox: '0 0 16 16'
                });
                
                createCSPSafeElement(GhSvg, 'path', {
                    d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8'
                });
                // Exp C
                
                controls.append(refreshBtn, manualBtn, opDown, opUp, ghIcon);
                header.appendChild(controls);
                controls.querySelectorAll('button').forEach(btn => Object.assign(btn.style, {
                    background: 'transparent',
                    color: '#fff',
                    border: '2px solid #333',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s'
                }));
                
                /*
                const content = document.createElement('div');
                content.id = 'tm-lyrics-lines';
                Object.assign(content.style, {
                    padding: '12px',
                    overflowY: 'auto',
                    scrollBehavior: 'smooth',
                    flex: '1 1 auto',
                    minHeight: '0'
                });
                content.innerText = 'Lyrics will appear here';
                */
                
                const resizeHandle = document.createElement('div');
                resizeHandle.id = 'tm-lyrics-resize';
                Object.assign(resizeHandle.style, {
                    position: 'absolute',
                    right: '1px',
                    bottom: '.5px',
                    width: '18px',
                    height: '18px',
                    cursor: 'nwse-resize',
                    background: 'linear-gradient(135deg,transparent 60%,#888 60%)',
                    opacity: 1
                });
                panel.appendChild(header);
                
                // panel.appendChild(content);
                createCSPSafeElement(panel, 'div',
                    {
                        style: `
                    padding: '12px';
                    overflowY: 'auto';
                    scrollBehavior: 'smooth';
                    flex: '1 1 auto';
                    minHeight: '0';
                    `,
                        id: 'tm-lyrics-lines'
                        
                    }, `<em>Lyrics will appear here</em>`
                    
                )
                
                panel.appendChild(resizeHandle);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);
                
                applyTheme(panel);
                
                // Drag logic
                let dragX = 0,
                    dragY = 0;
                header.addEventListener('mousedown', e => {
                    if (dragLocked) return;
                    isDragging = true;
                    dragX = e.clientX - panel.offsetLeft;
                    dragY = e.clientY - panel.offsetTop;
                    document.body.style.userSelect = 'none';
                });
                document.addEventListener('mousemove',
                    e => {
                        if (!isDragging) return;
                        let x = e.clientX - dragX;
                        let y = e.clientY - dragY;
                        x = Math.min(Math.max(0, x), window.innerWidth - panel.offsetWidth);
                        y = Math.min(Math.max(0, y), window.innerHeight - panel.offsetHeight);
                        panel.style.left = x + 'px';
                        panel.style.top = y + 'px';
                    });
                document.addEventListener('mouseup',
                    () => {
                        if (!isDragging) return;
                        isDragging = false;
                        document.body.style.userSelect = '';
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            left: panel.style.left,
                            top: panel.style.top
                        }));
                    });
                
                // Touch drag
                header.addEventListener('touchstart',
                    e => {
                        if (dragLocked) return;
                        const t = e.touches[0];
                        isDragging = true;
                        dragX = t.clientX - panel.offsetLeft;
                        dragY = t.clientY - panel.offsetTop;
                        document.body.style.userSelect = 'none';
                    },
                    {
                        passive: false
                    });
                document.addEventListener('touchmove',
                    e => {
                        if (!isDragging) return;
                        const t = e.touches[0];
                        let x = t.clientX - dragX;
                        let y = t.clientY - dragY;
                        x = Math.min(Math.max(0, x), window.innerWidth - panel.offsetWidth);
                        y = Math.min(Math.max(0, y), window.innerHeight - panel.offsetHeight);
                        panel.style.left = x + 'px';
                        panel.style.top = y + 'px';
                    },
                    {
                        passive: false
                    });
                document.addEventListener('touchend',
                    () => {
                        if (!isDragging) return;
                        isDragging = false;
                        document.body.style.userSelect = '';
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            left: panel.style.left,
                            top: panel.style.top
                        }));
                    });
                
                // Resize logic
                let startW, startH, startX, startY;
                resizeHandle.addEventListener('mousedown',
                    e => {
                        isResizing = true;
                        startW = panel.offsetWidth;
                        startH = panel.offsetHeight;
                        startX = e.clientX;
                        startY = e.clientY;
                        e.preventDefault();
                        e.stopPropagation();
                    });
                document.addEventListener('mousemove',
                    e => {
                        if (!isResizing) return;
                        let w = Math.max(200, startW + e.clientX - startX);
                        let h = Math.max(120, startH + e.clientY - startY);
                        w = Math.min(w, window.innerWidth - panel.offsetLeft);
                        h = Math.min(h, window.innerHeight - panel.offsetTop);
                        panel.style.width = w + 'px';
                        panel.style.height = h + 'px';
                    });
                document.addEventListener('mouseup',
                    () => {
                        if (!isResizing) return;
                        isResizing = false;
                        localStorage.setItem(SIZE_KEY, JSON.stringify({
                            width: panel.style.width,
                            height: panel.style.height
                        }));
                    });
                resizeHandle.addEventListener('touchstart',
                    e => {
                        const t = e.touches[0];
                        isResizing = true;
                        startW = panel.offsetWidth;
                        startH = panel.offsetHeight;
                        startX = t.clientX;
                        startY = t.clientY;
                        e.preventDefault();
                        e.stopPropagation();
                    },
                    {
                        passive: false
                    });
                document.addEventListener('touchmove',
                    e => {
                        if (!isResizing) return;
                        const t = e.touches[0];
                        let w = Math.max(200, startW + t.clientX - startX);
                        let h = Math.max(120, startH + t.clientY - startY);
                        w = Math.min(w, window.innerWidth - panel.offsetLeft);
                        h = Math.min(h, window.innerHeight - panel.offsetTop);
                        panel.style.width = w + 'px';
                        panel.style.height = h + 'px';
                    },
                    {
                        passive: false
                    });
                document.addEventListener('touchend',
                    () => {
                        if (!isResizing) return;
                        isResizing = false;
                        localStorage.setItem(SIZE_KEY, JSON.stringify({
                            width: panel.style.width,
                            height: panel.style.height
                        }));
                    });
                
                debug('Lyrics panel successfully initialized.');
                
            } catch (e) {
                window.debug("[ERROR] createPanel error: ",
                    e.message);
            }
        }
        
        
        function applyTheme(panel) {
            const header = panel.querySelector('#tm-lyrics-header');
            if (currentTheme === 'light') {
                panel.style.background = `rgba(245, 245, 245, ${currentOpacity})`;
                panel.style.color = '#000';
                if (header) header.style.background = `rgba(220, 220, 220, ${currentOpacity})`;
            } else {
                panel.style.background = `rgba(0, 0, 0, ${currentOpacity})`;
                panel.style.color = '#fff';
                if (header) header.style.background = `rgba(33, 33, 33, ${currentOpacity})`;
            }
        }
        
        // Replaces previous gmFetch
        function gmFetch(url, headers = {}, signal = null) {
            // Helper to create a safe race for fetchViaBackground
            function fetchViaBgWithSignal(url, init = {}, signal) {
                if (!signal) return fetchViaBackground(url, init);
                // create a race between fetchViaBackground and the abort signal
                return new Promise((resolve, reject) => {
                    const onAbort = () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    };
                    signal.addEventListener('abort', onAbort, {
                        once: true
                    });
                    fetchViaBackground(url, init)
                        .then(res => {
                            signal.removeEventListener('abort', onAbort);
                            resolve(res);
                        })
                        .catch(err => {
                            signal.removeEventListener('abort', onAbort);
                            reject(err);
                        });
                });
            }
            
            if (typeof GM_xmlhttpRequest === 'function') {
                return new Promise((resolve, reject) => {
                    let resolved = false;
                    const req = GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        headers,
                        onload: res => {
                            if (resolved) return;
                            resolved = true;
                            resolve(res);
                        },
                        onerror: err => {
                            if (resolved) return;
                            resolved = true;
                            reject(err);
                        },
                        ontimeout: () => {
                            if (resolved) return;
                            resolved = true;
                            reject(new Error('Request timed out'));
                        }
                    });
                    
                    // If a signal is provided, abort the GM request when signaled
                    if (signal) {
                        if (signal.aborted) {
                            // already aborted
                            try {
                                if (req && typeof req.abort === 'function') req.abort();
                            } catch (_) {}
                            return reject(new DOMException('Aborted', 'AbortError'));
                        }
                        const onAbort = () => {
                            try {
                                if (req && typeof req.abort === 'function') req.abort();
                            } catch (_) {}
                            if (!resolved) {
                                resolved = true;
                                reject(new DOMException('Aborted', 'AbortError'));
                            }
                        };
                        signal.addEventListener('abort', onAbort, {
                            once: true
                        });
                    }
                });
            } else {
                // fetchViaBackground branch (wrap it so it respects the signal)
                return fetchViaBgWithSignal(url, {
                        headers
                    }, signal)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response;
                    })
                    .catch(error => {
                        if (error && error.name === 'AbortError') throw error;
                        throw new Error(`Custom fetch failed: ${error}`);
                    });
            }
        }
        
        function gmFetchPost(url,
            body = {},
            headers = {},
            signal = null) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
            
            if (typeof GM_xmlhttpRequest === 'function') {
                return new Promise((resolve, reject) => {
                    let resolved = false;
                    const req = GM_xmlhttpRequest({
                        method: 'POST',
                        url,
                        headers,
                        data: typeof body === 'string' ? body : JSON.stringify(body),
                        onload: res => {
                            if (resolved) return;
                            resolved = true;
                            resolve(res);
                        },
                        onerror: err => {
                            if (resolved) return;
                            resolved = true;
                            reject(err);
                        },
                        ontimeout: () => {
                            if (resolved) return;
                            resolved = true;
                            reject(new Error('Request timed out'));
                        }
                    });
                    
                    if (signal) {
                        if (signal.aborted) {
                            try {
                                if (req && typeof req.abort === 'function') req.abort();
                            } catch (_) {}
                            return reject(new DOMException('Aborted', 'AbortError'));
                        }
                        signal.addEventListener('abort', () => {
                            try {
                                if (req && typeof req.abort === 'function') req.abort();
                            } catch (_) {}
                            if (!resolved) {
                                resolved = true;
                                reject(new DOMException('Aborted', 'AbortError'));
                            }
                        },
                        {
                            once: true
                        });
                    }
                });
            } else {
                // fetchViaBackground fallback (wrap to respect signal)
                function fetchViaBgPost(url, init, signal) {
                    if (!signal) return fetchViaBackground(url, init);
                    return new Promise((resolve, reject) => {
                        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
                        signal.addEventListener('abort', onAbort, {
                            once: true
                        });
                        fetchViaBackground(url, init)
                            .then(res => {
                                signal.removeEventListener('abort', onAbort);
                                resolve(res);
                            })
                            .catch(err => {
                                signal.removeEventListener('abort', onAbort);
                                reject(err);
                            });
                    });
                }
                
                return fetchViaBgPost(url, {
                        method: 'POST',
                        headers,
                        body: typeof body === 'string' ? body : JSON.stringify(body)
                    }, signal)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response;
                    })
                    .catch(error => {
                        if (error && error.name === 'AbortError') throw error;
                        throw new Error(`Custom fetch failed: ${error}`);
                    });
            }
        }
        
        
        window.toggleLogVisibility = toggleLogVisibility;
        
        function toggleLogVisibility() {
            const logs = document.getElementById('tm-logs');
            if (!logs) return;
            logVisible = !logVisible;
            logs.style.display = logVisible ? 'block' : 'none';
        };
        
        /**
         * Attaches a long click detection to a DOM element.
         *
         * @param {HTMLElement} element The DOM element to attach the listener to.
         * @param {function} onLongClick Callback function to execute when a long click is detected.
         * @param {function} [onShortClick] Optional callback for a short click. If not provided,
         * only long clicks will trigger a callback.
         * @param {number} [longClickThreshold=500] The duration in milliseconds to consider a click "long".
         */
        function detectLongClick(element,
            onLongClick,
            onShortClick,
            longClickThreshold = 500) {
            let pressTimer;
            let isLongClickTriggered = false; // Flag to prevent short click after long click
            
            if (!element || typeof onLongClick !== 'function') {
                console.error("detectLongClick: Invalid element or onLongClick callback provided.");
                return;
            }
            
            const startTimer = () => {
                isLongClickTriggered = false; // Reset flag for new press
                pressTimer = setTimeout(() => {
                    isLongClickTriggered = true;
                    onLongClick();
                }, longClickThreshold);
            };
            
            const clearTimer = () => {
                clearTimeout(pressTimer);
            };
            
            // --- Mouse Events ---
            element.addEventListener('mousedown', (event) => {
                // Prevent right-click from triggering long-click for mouse events
                if (event.button === 2) {
                    return;
                }
                startTimer();
            });
            
            element.addEventListener('mouseup',
                () => {
                    clearTimer();
                    // Only trigger short click if long click wasn't triggered
                    if (!isLongClickTriggered && typeof onShortClick === 'function') {
                        onShortClick();
                    }
                });
            
            // If mouse leaves the element while pressed (important to clear timer)
            element.addEventListener('mouseleave',
                () => {
                    clearTimer();
                    // Reset long click flag if mouse leaves, preventing accidental short click if re-entered
                    isLongClickTriggered = false;
                });
            
            // --- Touch Events ---
            // Using passive: true for better scroll performance. If you need to prevent default
            // browser behavior (like scrolling/zooming on touch), set to false and handle `event.preventDefault()`.
            element.addEventListener('touchstart',
                (event) => {
                    // event.preventDefault(); // Uncomment if you need to prevent default touch behaviors
                    startTimer();
                },
                {
                    passive: true
                });
            
            element.addEventListener('touchend',
                () => {
                    clearTimer();
                    if (!isLongClickTriggered && typeof onShortClick === 'function') {
                        onShortClick();
                    }
                },
                {
                    passive: true
                });
            
            element.addEventListener('touchcancel',
                () => {
                    clearTimer();
                    isLongClickTriggered = false; // Reset if touch is interrupted (e.g., phone call)
                },
                {
                    passive: true
                });
        }
        
        async function fetchTranslations(lrcText, humanTr, title, artist, signal = null) {
            try {
                const response = await gmFetchPost(BACKEND_URL, {
                    lrcText,
                    geniusLyrics: humanTr,
                    title,
                    artist
                }, {
                    "Content-Type": "application/json"
                }, signal);
                if (response && !(response.status === 200 || response.ok)) {
                    const errorBody = response.responseText;
                    window.debug('[❗ERROR] Backend server returned an error:', response.status, errorBody);
                    return {
                        rom: "",
                        transl: ""
                    };
                }
                const dataText = response.responseText ?? (await response.text?.());
                const data = JSON.parse(dataText);
                window.debug('Received backend data:', data);
                return data;
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    window.debug('[fetchTranslations] Aborted');
                    throw error; // let caller handle abort specially
                }
                window.debug('[❗ERROR] Failed to fetch from backend server:', error);
                return {
                    rom: "",
                    transl: ""
                };
            }
        }
        
        function parseLRCToArray(lrc) {
            if (!lrc) return [];
            const lines = [];
            const regex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/g;
            for (const raw of lrc.split('\n')) {
                let matches,
                    l = raw;
                while ((matches = regex.exec(l)) !== null) {
                    const time = parseInt(matches[1], 10) * 60000 + parseInt(matches[2], 10) * 1000 + (matches[3] ? parseInt(matches[3].padEnd(3, '0'), 10) : 0);
                    lines.push({
                        time,
                        text: l.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim()
                    });
                }
                regex.lastIndex = 0;
            }
            lines.sort((a, b) => a.time - b.time);
            if (lines.length && lines[0].time !== 0) {
                lines.unshift({
                    time: 0,
                    text: ''
                });
            }
            return lines;
        }
        
        function mergeLRC(origArr, romArr, transArr) {
            const romMap = new Map(romArr.map(r => [r.time, r.text]));
            const transMap = new Map(transArr.map(t => [t.time, t.text]));
            return origArr.map(o => ({
                time: o.time,
                text: o.text,
                roman: romMap.get(o.time) || '',
                trans: transMap.get(o.time) || ''
            }));
        }
        
        function parseLRC(lrc, romLrc, translLrc) {
            return mergeLRC(parseLRCToArray(lrc), parseLRCToArray(romLrc), parseLRCToArray(translLrc));
        }
        
        function addTimestamps(lyrics) {
            if (!lyrics || typeof lyrics !== 'string') return "";
            
            try {
                const timestampRegex = /^\[\d{2}:\d{2}\.\d{2,3}\]/m;
                
                // 1. Check for existing timestamps
                if (timestampRegex.test(lyrics)) return lyrics;
                
                // debug("info", "No timestamps detected. Proceeding with addTimestamps()...")
                // Your log here will fire correctly.
                
                // Split the input lyrics into lines
                let lines = lyrics.split('\n');
                
                // Define the header lines
                const header = ["PLAIN LRC MODE", ""];
                
                // 2. Create the complete list of lines using spread syntax
                // This is a clean, immutable way to combine the header and original lines.
                const linesWithHeader = [...header, ...lines];
                
                const startMs = 100;
                
                // 3. Map over the new array to add sequential timestamps
                const result = linesWithHeader.map((line, index) => {
                    const ms = startMs + index;
                    // Pad the millisecond number to exactly 3 digits
                    const timestamp = `[00:00.${String(ms).padStart(3, '0')}]`;
                    
                    return `${timestamp} ${line}`;
                });
                
                debug('info', 'Timestamps added. here\'s the result:\n\n', result.join('\n').trim());
                // This log will now execute successfully, showing the final output.
                
                return result.join('\n').trim();
            } catch (e) {
                debug('error', "An error occured while adding timestamps:", e.message, e);
                // Ensure you have defined your 'debug' function globally or passed it in,
                // as its internal behavior is crucial for your logging verification.
            }
        }
        
        
        async function loadLyrics(title, artist, album, duration, onTransReady, manual = {
            flag: false,
            query: ""
        }, signal = null) {
            if (!manual.flag) {
                window.debug('Searching for lyrics:', title, artist, album, duration);
                
                onTransReady([{
                    time: 0,
                    text: 'Searching for lyrics...',
                    roman: `Attempt 1 out of 2`,
                    trans: `${title}  ${artist}   ${album}\n` + `${(duration/60000|0)}`.padStart(2, '0') + ':' + `${(duration/1000)%60}`.padStart(2, '0') + ` (${duration/1000}s)`
                }]);
            } else {
                window.debug(`Manually searching lyrics: using user prompt "${manual.query}"...`);
                
                onTransReady([{
                    time: 0,
                    text: `Manually searching lyrics...`,
                    roman: ``,
                    trans: `query: "${manual.query}"`
                }]);
            }
            
            const trackKey = `${title}|${artist}`;
            let geniusLyrics = null;
            
            try {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                // --- 0) Attempt to get human-translated lyrics first ---
                /*
      if (!manual.flag) {
          geniusLyrics = await scrapeMxm(title, artist);
          if (geniusLyrics) { debug("Found translations. Proceeding with merging via the backend...") };
      }
      */
                
                // --- 1) Manual override check ---
                if (lyricsConfig[trackKey]?.manualLrc && !manual.flag) {
                    const {
                        manualLrc,
                        offset = 0
                    } = lyricsConfig[trackKey];
                    
                    onTransReady(parseLRC(addTimestamps(manualLrc), '', '').map(l => ({
                        ...l,
                        time: l.time + offset
                    })));
                    const {
                        rom,
                        transl
                    } = await fetchTranslations(manualLrc, geniusLyrics, title, artist, signal);
                    onTransReady(parseLRC(addTimestamps(manualLrc), rom, transl).map(l => ({
                        ...l,
                        time: l.time + offset
                    })));
                    const searchRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent([title, artist, album].join(' '))}`, LRCLIB_HEADERS, signal);
                    if (searchRes.status === 200 || searchRes.ok) lastCandidates = JSON.parse(searchRes.responseText);
                    lastCandidates.sort((a, b) => {
                        // Check if 'syncedLyrics' is missing or null for element 'a'
                        const aIsUnsynced = !a.syncedLyrics;
                        // Check if 'syncedLyrics' is missing or null for element 'b'
                        const bIsUnsynced = !b.syncedLyrics;
                        
                        // Case 1: 'a' has lyrics, and 'b' does not. 'a' should come first.
                        if (!aIsUnsynced && bIsUnsynced) {
                            return -1;
                        }
                        
                        // Case 2: 'a' does not have lyrics, and 'b' does. 'b' should come first.
                        if (aIsUnsynced && !bIsUnsynced) {
                            return 1;
                        }
                        
                        // Case 3: Both 'a' and 'b' are in the same group (both synced or both unsynced).
                        // Maintain original relative order by returning 0 (or you can use other properties for secondary sorting).
                        return 0;
                    });
                    
                    return;
                }
                
                // --- 2) Fetch from lrclib (with fallback) ---
                const primaryMetadata = manual.flag ? manual.query : [title,
                    artist,
                    album
                ].filter(Boolean).join(' ');
                let searchRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent(primaryMetadata)}`, LRCLIB_HEADERS, signal);
                if (!(searchRes.status === 200 || searchRes.ok)) throw new Error('lrclib search failed');
                let searchData = JSON.parse(searchRes.responseText);
                
                if (!Array.isArray(searchData) || !searchData.some(c => c.syncedLyrics)) {
                    if (!manual.flag) {
                        window.debug('Retrying lrclib search without album.');
                        
                        onTransReady([{
                            time: 0,
                            text: 'Searching for lyrics...',
                            roman: `Attempt 2 out of 2 (retrying search without album)`,
                            trans: `${title}   ${artist}   ${album}\n` + `${(duration/60000|0)}`.padStart(2, '0') + ':' + `${(duration/1000)%60}`.padStart(2, '0') + ` (${duration}s)`
                        }]);
                        
                        const fallbackRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent([title, artist].join(' '))}`, LRCLIB_HEADERS, signal);
                        if (fallbackRes.status === 200 || fallbackRes.ok) searchData = JSON.parse(fallbackRes.responseText);
                    }
                }
                lastCandidates = Array.isArray(searchData) ? searchData : [];
                lastCandidates.sort((a, b) => {
                    // Check if 'syncedLyrics' is missing or null for element 'a'
                    const aIsUnsynced = !a.syncedLyrics;
                    // Check if 'syncedLyrics' is missing or null for element 'b'
                    const bIsUnsynced = !b.syncedLyrics;
                    
                    // Case 1: 'a' has lyrics, and 'b' does not. 'a' should come first.
                    if (!aIsUnsynced && bIsUnsynced) {
                        return -1;
                    }
                    
                    // Case 2: 'a' does not have lyrics, and 'b' does. 'b' should come first.
                    if (aIsUnsynced && !bIsUnsynced) {
                        return 1;
                    }
                    
                    // Case 3: Both 'a' and 'b' are in the same group (both synced or both unsynced).
                    // Maintain original relative order by returning 0 (or you can use other properties for secondary sorting).
                    return 0;
                });
                
                // --- 3) Pick best candidate ---
                let candidate = null,
                    minDelta = Infinity;
                lastCandidates.filter(c => c.syncedLyrics).forEach(c => {
                    const delta = Math.abs(Number(c.duration) - duration);
                    if (delta < minDelta && delta < 8000) {
                        candidate = c;
                        minDelta = delta;
                    }
                });
                if (!candidate && lastCandidates.length > 0) candidate = lastCandidates[0];
                
                
                if (!candidate || (!candidate.syncedLyrics && !candidate.plainLyrics)) {
                    onTransReady([{
                        time: 0,
                        text: '× Failed to find any lyrics for this track.',
                        roman: '(not caused by a script error btw)',
                        trans: 'Maybe this is a new song or perhaps instrumental?'
                    }]);
                    
                    return;
                }
                
                
                // --- 4) Process candidate and get translations ---
                const rawLrc = candidate.syncedLyrics || addTimestamps(candidate.plainLyrics);
                onTransReady(parseLRC(rawLrc, '', '')); // Render original lyrics immediately
                
                const {
                    rom,
                    transl
                } = await fetchTranslations(rawLrc, geniusLyrics, title, artist, signal);
                onTransReady(parseLRC(rawLrc, rom, transl));
                
            } catch (e) {
                // alert(`Error while displaying lrc: ${e} \n\n\n Please report this to \n\nhttps://github.com/jayxdcode/src-backend/issues\n\nalongside with a screenshot of this alert.`);
                window.debug('[❗ERROR] [Lyrics] loadLyrics error:', `${e}`);
                if (e.name === 'AbortError') {
                    onTransReady([{
                        time: 0,
                        text: 'Aborted due to changing of tracks while data is being fetched)',
                        roman: '',
                        trans: ''
                    }]);
                    
                } else {
                    onTransReady([{
                        time: 0,
                        text: '× An error occurred while loading lyrics.',
                        roman: '',
                        trans: ''
                    }]);
                    
                }
            }
        }
        
        function parseTimeString(str) {
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : (parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 : 0);
        }
        
        function timeJump(ms) {
            try {
                // Sanitize timestamp
                ms = Number(ms);
                if (isNaN(ms)) return false;
                
                const vid = document.querySelector('video');
                if (vid) {
                    vid.currentTime = ms / 1000;
                    return;
                }
                
                debug('warn', '[Lyrics Panel] Could not seek - video not found');
                return true;
            } catch (e) {
                debug('[ERROR] timeJump attempt failed: ', e.message);
            }
        }
        
        function addTimeJumpListener() {
            try {
                const lyricLines = document.querySelectorAll('.handler');
                if (lyricLines[0].textContent.includes("PLAIN")) {
                    debug("[addTimeJumpListener] Cancelled time jump listener attachment. Plain lyrics present.")
                    return true;
                }
                lyricLines.forEach(line => {
                    // Remove previous listeners if needed
                    line.onclick = null;
                    // Add new listener
                    line.onclick = function() {
                        const ms = Number(line.getAttribute('data-timestamp'));
                        timeJump(ms);
                    };
                });
            } catch (e) {
                debug("[Lyrics Panel error] addTimeJumpListener failed:", e.message);
            }
        }
        
        // i want it to wait for a video tag inside the html to load its metadata before continuing. if it reaches the timeout, skip with a warning
        
        async function getTrackInfo() {
            const vid = document.querySelector('video');
            if (!vid) return null;
            const bar = queryFirst(SELECTORS.bar);
            const titleEl = queryFirst(SELECTORS.title);
            const artistEl = queryFirst(SELECTORS.artist);
            const albumEl = queryFirst(SELECTORS.album);
            const title = titleEl?.textContent.trim() || '';
            const artist = artistEl?.textContent.trim() || '';
            const album = (albumEl && /^\d+(\.\d+)?[MKBT]?\sviews$/i.test(albumEl.textContent.trim())) ? (albumEl.textContent.trim() || '') : '';
            const YTMPROG = queryFirst(SELECTORS.YTMPROG);
            let duration = vid?.duration * 1000 || Number(YTMPROG.getAttribute('aria-valuemax')) * 1000 || null;
            
            return {
                id: title + '|' + artist,
                title,
                artist,
                album,
                duration,
                bar,
                vid,
                debug: {
                    bar: !!bar,
                    titleEl: !!titleEl,
                    artistEl: !!artistEl,
                    albumEl: !!albumEl,
                    vid: !!vid,
                    YTMPROG: !!YTMPROG
                }
            };
        }
        
        GM_addStyle('.tm-lrc { min-height:1.6em; } .tm-lyric-line { opacity:.7; } .tm-lyric-line:not(.empty) { white-space: pre-wrap; color: #fff; margin: 20px 0; display: block; } .tm-lrc.plain, .tm-lyric-current { font-weight:bold; font-size:1.25em } .tm-lrc > div { font-size:.75em; color:#ccc; margin-top:2px; } .tm-lrc > div.romanization { font-style:italic !important }')
        
        function renderLyrics(currentIdx) {
            try {
                
                const YTMPROG = queryFirst(SELECTORS.YTMPROG);
                let t = Number(YTMPROG.getAttribute('aria-valuenow')) * 1000;
                
                //debug("[renderLyrics] Called with currentIdx:", currentIdx)
                const isPlain = lyricsData[0].text.includes('PLAIN');
                const linesDiv = document.getElementById('tm-lyrics-lines');
                if (!linesDiv) {
                    //debug("[renderLyrics] #tm-lyrics-lines not found, aborting.");
                    return;
                }
                
                if (!lyricsData || !Array.isArray(lyricsData)) {
                    //debug("[renderLyrics] lyricsData is invalid or not loaded:", lyricsData);
                    return;
                }
                
                if (prevLyricsData !== lyricsData && linesDiv.children) {
                    /*
                    prevLyricsData = lyricsData;
                    let html = '';
                    const color = currentTheme === 'light' ? '#000' : '#fff';
                    const subColor = currentTheme === 'light' ? '#555' : '#ccc';
                    const start = Math.max(0, currentIdx - 70);
                    const end = Math.min(lyricsData.length - 1, currentIdx + 70);

                    //debug("[renderLyrics] Rendering lines from", start, "to", end, "of", lyricsData.length);

                    for (let i = start; i <= end; i++) {
                        const ln = lyricsData[i];
                        if (!ln.text && !ln.roman && !ln.trans) {
                            html += `<div class="tm-lrc tm-lrc-${i} tm-lyric-line empty"></div>`;
                            continue;
                        }

                        const isCurrent = i === currentIdx;
                        const lineClass = isPlain ? `tm-lrc plain tm-lrc-${i}` : `tm-lrc tm-lrc-${i} tm-lyric-${isCurrent ? 'current': 'line'}`;
                        html += `<div class="handler ${lineClass}" data-timestamp="${ln.time}">${ln.text || ' '}`;

                        if (ln.roman && ln.text.trim() !== ln.roman.trim()) {
                            html += `<div class="romanization">${ln.roman}</div>`;
                        }
                        if (ln.trans && ln.text.trim() !== ln.trans.trim()) {
                            html += `<div class="translation">${ln.trans}</div>`;
                        }
                        html += `</div>`;

                        //if (isCurrent) debug("[renderLyrics] Current line index:", i, "time:", ln.time, "text:", ln.text);
                        // if (isCurrent) debug("[renderLyrics] {idx: ", currentIdx, "} {inline: ", ln.time, "} {progress: ", t, "}");
                    }

                    linesDiv.innerHTML = html;
                    */
                    
                    prevLyricsData = lyricsData;
                    
                    // === CSP-SAFE CONTAINER CLEARING ===
                    // Replaces linesDiv.innerHTML = '';
                    linesDiv.replaceChildren();
                    // ===================================
                    
                    const start = Math.max(0, currentIdx - 70);
                    const end = Math.min(lyricsData.length - 1, currentIdx + 70);
                    
                    for (let i = start; i <= end; i++) {
                        const ln = lyricsData[i];
                        
                        // Check for empty line
                        if (!ln.text && !ln.roman && !ln.trans) {
                            // Use GM_addElement to create the empty line div
                            createCSPSafeElement(linesDiv, 'div', {
                                className: `tm-lrc tm-lrc-${i} tm-lyric-line empty`
                            });
                            continue;
                        }
                        
                        const isCurrent = i === currentIdx;
                        const lineClass = isPlain ?
                            `tm-lrc plain tm-lrc-${i}` :
                            `tm-lrc tm-lrc-${i} tm-lyric-${isCurrent ? 'current': 'line'}`;
                        
                        // 1. Create and append the main handler div using GM_addElement
                        const handlerDiv = createCSPSafeElement(linesDiv, 'div', {
                            className: `handler ${lineClass}`,
                            'data-timestamp': ln.time,
                            // textContent is safe as it escapes all characters and avoids HTML parsing
                            textContent: ln.text || ' '
                        });
                        
                        // 2. Add romanization if present and different
                        if (ln.roman && ln.text.trim() !== ln.roman.trim()) {
                            createCSPSafeElement(handlerDiv, 'div', {
                                className: 'romanization',
                                textContent: ln.roman
                            });
                        }
                        
                        // 3. Add translation if present and different
                        if (ln.trans && ln.text.trim() !== ln.trans.trim()) {
                            createCSPSafeElement(handlerDiv, 'div', {
                                className: 'translation',
                                textContent: ln.trans
                            });
                        }
                    }
                    
                    // Exp C
                    //debug("[renderLyrics] Updated linesDiv.innerHTML");
                } else {
                    const lastEl = linesDiv.querySelector('.tm-lyric-current');
                    if (lastEl) {
                        lastEl.classList.remove('tm-lyric-current');
                        lastEl.classList.add('tm-lyric-line');
                    }
                    const newEl = linesDiv.querySelector(`.tm-lrc-${currentIdx}`);
                    if (newEl) {
                        newEl.classList.remove('tm-lyric-line');
                        newEl.classList.add('tm-lyric-current');
                    }
                }
                
                const currElem = linesDiv.querySelector('.tm-lyric-current');
                if (currElem && !isPlain) {
                    /* linesDiv.scrollTop =
                        currElem.offsetTop -
                        (linesDiv.clientHeight / 2) +
                        (currElem.offsetHeight / 2); */
                    currElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    //debug("[renderLyrics] Scrolled to current lyric at offsetTop:", currElem.offsetTop);
                } else {
                    //debug("[renderLyrics] .tm-lyric-current not found for index:", currentIdx);
                }
                
                addTimeJumpListener();
                //debug("[renderLyrics] addTimeJumpListener called");
                
                
            } catch (error) {
                debug("[renderLyrics] ERROR:", error.message, error);
            }
        }
        
        function syncLyrics(bar, durationMs, progVal = null) {
            try {
                //debug("[syncLyrics] Called with bar:", bar, "durationMs:", durationMs);
                
                // quick guards
                if (!lyricsData || lyricsData.length === 0) {
                    //debug("[syncLyrics] Aborting: missing lyricsData or empty.");
                    return;
                }
                
                // if only one lyric line, always render index 0 once
                if (lyricsData.length === 1) {
                    //debug("[syncLyrics] Only one lyric line.");
                    if (lastRenderedIdx !== 0) {
                        renderLyrics(0);
                        lastRenderedIdx = 0;
                        //debug("[syncLyrics] Rendered single lyric line at index 0.");
                    }
                    return;
                }
                
                // Get current time/progress only once, prefer progVal or provided bar
                let t;
                if (progVal != null) {
                    t = Number(progVal);
                } else if (bar && typeof bar.value !== "undefined") {
                    t = Number(bar.value);
                } else {
                    const YTMPROG = queryFirst(SELECTORS.YTMPROG);
                    t = Number(YTMPROG.getAttribute('aria-valuenow')) * 1000;
                }
                
                if (!Number.isFinite(t)) {
                    //debug("[syncLyrics] Invalid time value:", t);
                    return;
                }
                
                playbackPos = t;
                
                // Cache numeric times on the array to avoid remapping every call.
                // Attaching _times to the array is cheap and prevents repeated work.
                if (!lyricsData._times || lyricsData._times.length !== lyricsData.length) {
                    lyricsData._times = lyricsData.map(line => Number(line.time));
                    //debug("[syncLyrics] Built times cache:", lyricsData._times);
                }
                const times = lyricsData._times;
                
                // Binary search to find index i such that times[i] <= t < times[i+1]
                let idx = 0;
                let lo = 0;
                let hi = times.length - 1;
                
                if (t >= times[hi]) {
                    idx = hi;
                } else if (t <= times[0]) {
                    idx = 0;
                } else {
                    while (lo <= hi) {
                        const mid = (lo + hi) >> 1; // faster floor((lo+hi)/2)
                        const midT = times[mid];
                        const nextT = times[mid + 1];
                        
                        if (midT <= t && t < nextT) {
                            idx = mid;
                            break;
                        }
                        
                        if (t < midT) {
                            hi = mid - 1;
                        } else {
                            lo = mid + 1;
                        }
                    }
                }
                
                const isPlain = lyricsData[0].text.includes('PLAIN');
                
                // Only render when index changes
                //debug("[syncLyrics] Calculated lyric index:", idx, "lastRenderedIdx:", lastRenderedIdx);
                if (idx !== lastRenderedIdx) {
                    //debug("[syncLyrics] New lyric index detected:", idx, "Rendering...");
                    renderLyrics(idx);
                    lastRenderedIdx = idx;
                    
                    
                    (async function() {
                        if (prefs.devOps) {
                            if (!got) {
                                debug(lyricsData);
                                got = true;
                            }
                            
                            let content = document.querySelector(`.tm-lrc-${idx}`).outerHTML + "\n" + document.querySelector(`.tm-lrc-${idx+1}`).outerHTML + "\n" + document.querySelector(`.tm-lrc-${idx+2}`).outerHTML;
                            await fetch('http://localhost:1821/send', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                        idx: idx,
                                        content: content,
                                        a: document.querySelector(`.tm-lrc-${idx}`).outerHTML,
                                        b: document.querySelector(`.tm-lrc-${idx+1}`).outerHTML,
                                        c: document.querySelector(`.tm-lrc-${idx+2}`).outerHTML
                                    }),
                                })
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error(`HTTP error! status: ${response.status}`);
                                    }
                                    return response.text();
                                })
                                .catch((error) => {
                                    debug('error', 'Error:', error);
                                });
                            
                        }
                    })();
                    
                    
                    if (!isPlain && prefs.activeBeta.lrcNotif == true) {
                        function containsRussian(text) {
                            return /[\u0401\u0451\u0410-\u042F\u0430-\u044F]/.test(text);
                        }
                        
                        let c = lyricsData[idx];
                        let curr = {
                            ti: (c.roman && c.text.trim() !== c.roman.trim() && !(containsRussian(c.text))) ? c.roman : c.text,
                            tx: (c.trans && c.text.trim() !== c.trans.trim()) ? c.trans : "---"
                        };
                        
                        let sTag = prefs.lrcNotif.fallback ? "tm-lrcNtf_A" : "tm-lrcNtf_B";
                        
                        if (c.text.trim() != '') {
                            GM_notification({
                                text: curr.tx,
                                // title: (curr.rom == false) ? c.text : curr.rom,
                                title: curr.ti,
                                tag: (prefs.lrcNotif.singleMode == true) ? sTag : `tm-lrcNtf-${notifIdx}`,
                                silent: prefs.lrcNotif.silent,
                                timeout: 0,
                                ondone: function() {
                                    if (prefs.lrcNotif.singleMode) {
                                        prefs.lrcNotif.fallback = !(prefs.lrcNotif.fallback);
                                    }
                                },
                                onclick: (event) => {
                                    event.preventDefault();
                                },
                            });
                            
                            notifIdx = (notifIdx + 1) % prefs.lrcNotif.maxNotifs;
                        }
                    }
                } else {
                    //debug("[syncLyrics] Lyric index unchanged:", idx);
                }
            } catch (error) {
                debug("[syncLyrics] ERROR:", error.message, error);
            }
        }
        
        function setupProgressSync(bar, durationMs) {
            if (!bar) return;
            if (observer) observer.disconnect();
            if (syncIntervalId) clearInterval(syncIntervalId);
            const YTMPROG = queryFirst(SELECTORS.YTMPROG);
            const vid = document.querySelector('video');
            vid?.removeEventListener('timeupdate', () => {
                syncLyrics(bar, durationMs, vid.currentTime * 1000);
            })
            
            if (vid && vid.currentTime) {
                vid.addEventListener('timeupdate', () => {
                    syncLyrics(bar, durationMs, vid.currentTime * 1000);
                })
            } else if (YTMPROG) {
                observer = new MutationObserver(() => syncLyrics(bar, durationMs, Number(YTMPROG.value)));
                observer.observe(YTMPROG, {
                    attributes: true,
                    attributeFilter: ['style', 'aria-valuenow', 'value']
                });
            }
            syncIntervalId = setInterval(() => syncLyrics(bar, durationMs, vid.currentTime * 1000), 100);
        }
        
        async function poller() {
            try {
                const info = await getTrackInfo();
                // debug(info.debug);
                if (!info || !info.title || !info.artist) {
                    debug('[YTML Poller] Missing info:', info);
                    return;
                }
                // inside poller() when track changes:
                if (info.id !== currentTrackId) {
                    // cancel any inflight loads for previous track key(s)
                    abortFetch(currentTrackId);
                    
                    currentTrackId = info.id;
                    // debug("info", "currentTrackId:", info.id);
                    
                    currInf = info;
                    currentTrackDur = info.duration;
                    lyricsData = null;
                    lastRenderedIdx = -1;
                    dur = info.duration;
                    const lines = document.getElementById('tm-lyrics-lines');
                    if (lines) {
                        lines.replaceChildren();
                        createCSPSafeElement(lines, 'em', {}, 'Loading lyrics...');
                    }
                    
                    // create controller for this load (group under track id)
                    const controller = new AbortController();
                    addController(currentTrackId, controller);
                    
                    try {
                        if (prefs.devOps) startLyricsObserver();
                        
                        await loadLyrics(info.title, info.artist, info.album, info.duration, (parsed) => {
                            lyricsData = parsed;
                            renderLyrics(0);
                            setupProgressSync(info.bar, info.duration);
                        }, {
                            flag: false,
                            query: ""
                        }, controller.signal);
                    } catch (e) {
                        if (e.name === 'AbortError') {
                            debug('[loadLyrics] aborted by controller');
                        } else {
                            debug('[❗ERROR] loadLyrics:', e, e.message);
                            if (lines) createCSPSafeElement(lines, 'em', {}, 'There was a problem while loading the lyrics. Use Manual Lyrics instead.');
                        }
                    } finally {
                        // cleanup the controller for this key
                        removeController(currentTrackId, controller);
                    }
                }
            } catch (e) {
                window.debug('[❗ERROR] [Poller Error]', e.message);
            }
        }
        
        /**
         * Creates and appends a hidden <div> to the page to serve as a log container.
         * This is called once during the script's initialization.
         */
        function setupLogElement() {
            // Create the main container for logs
            const logs = document.createElement('div');
            logs.id = 'tm-logs';
            
            // Style it to be hidden by default but available for inspection
            Object.assign(logs.style, {
                position: 'fixed',
                bottom: '10px',
                right: '10px',
                width: '400px',
                height: '300px',
                background: 'rgba(0, 0, 0, 0.8)',
                color: '#0f0',
                fontFamily: 'monospace',
                fontSize: '12px',
                zIndex: '10001',
                overflowY: 'scroll',
                padding: '10px',
                border: '1px solid #333',
                borderRadius: '5px',
                display: 'none' // Hidden by default
            });
            
            // Add it to the page
            document.body.appendChild(logs);
            
            console.log('[Lyrics] Log element created. To view it, run this in the console:');
            console.log("document.getElementById('tm-logs').style.display = 'block';");
        }
        
        // Example of how to call it when your script starts:
        // setupLogElement();
        
        /**
         * Logs messages to the console and a dedicated <div> for on-page debugging.
         * @param {...any} args - The values to log.
         */
        function debug(...args) {
            // Detect logging mode based on args content
            let mode = 'log'; // default
            const modeMap = {
                error: 'error',
                warn: 'warn',
                info: 'info'
            };
            const modesArr = ['error', 'warn', 'info'];
            
            // Check if any arg is a string and matches one of the modes
            for (const arg of args) {
                if (typeof arg === 'string') {
                    const lower = arg.toLowerCase();
                    if (modeMap[lower]) {
                        mode = modeMap[lower];
                        break;
                    }
                }
            }
            
            // Also log to the standard developer console (or Eruda)
            if (compWindow.eruda) {
                compWindow.eruda.get('console')[mode]('[Lyrics]', ...args);
            } else {
                console[mode]('[Lyrics]', ...args);
            }
            
            // Find the log container element on the page
            const logs = document.body.querySelector('#tm-logs');
            if (logs) {
                // Format arguments for HTML display
                const message = args
                    .filter(arg => !modesArr.includes(arg))
                    .map(arg => {
                        if (typeof arg === 'object' && typeof arg.message !== 'undefined') {
                            return arg.message;
                        }
                        if (typeof arg === 'object') {
                            try {
                                return JSON.stringify(arg);
                            } catch {
                                return '[object ]';
                            }
                        }
                        return String(arg);
                    })
                    .join(' ')
                
                // Add class/color styling for mode
                const colorMap = {
                    error: 'red',
                    warn: 'orange',
                    info: 'white',
                    log: 'inherit'
                };
                // logs.innerHTML += `<div style="margin:.75em;color:${colorMap[mode]}">${message}</div>`;
                createCSPSafeElement(
                    logs,
                    'div', { style: `margin:.75em;color:${colorMap[mode]}` },
                    message
                );
                // Exp C
                logs.scrollTop = logs.scrollHeight;
            }
        }
        window.debug = debug;
        
        function init() {
            setupLogElement();
            
            debug(`Welcome! This is YouTube Music Floating Lyrics (YTMFL) version ${YTML_VERSION}. Debug logs active!`);
            debug('Initializing Lyrics Panel');
            createPanel();
            handleViewportChange(); // immediately run
            window.addEventListener('resize', debounce(handleViewportChange, 250));
            setInterval(poller, POLL_INTERVAL);
            //debug(SELECTORS);
        }
        
        // Global state variables for the observer
        let statObserver = null;
        let targetNode = null;
        const config = {
            childList: true,
            subtree: false,
        };
        
        
        
        // Wait for the main UI to be available before initializing
        /*
        const readyObserver = new MutationObserver((mutations, obs) => {
            if (document.querySelector(SELECTORS.bar)) {
                obs.disconnect();
                init();
                if (prefs.devOps) startLyricsObserver();
            }
        });
        readyObserver.observe(document.body,
                              {
            childList: true,
            subtree: true
        });
        */
        // --- UPDATED ENTRY POINT ---
        function safeInit() {
            // Prevent double init
            if (window.hasInitializedYTML) return;
            window.hasInitializedYTML = true;
            init();
        }
        
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            safeInit();
        } else {
            window.addEventListener('load', safeInit);
        }
        // ---------------------------
        
    } catch (e) {
        GM_notification({ text: `${e.message}: \n ${e}`, title: 'Fatal Userscript Error', timeout: 30000, onclick: () => { console.log('Notification clicked!'); }, ondone: (wasClicked) => { console.log(`Notification closed. Clicked: ${wasClicked}`); } });
    }
    // -- end --
})();