'use strict';

try {
    /* API CONFIGS */
    
    const goLocalMode = false; // keep this false if not in dev
    
    // My local dev server
    const customInstance = "http://192.168.8.10:3001";
    
    const publicInstance = "https://lyrxl.onrender.com";
    
    const BACKEND_ROOT = (customInstance && goLocalMode) ?
        customInstance :
        publicInstance;
    
    const BACKEND_URL = BACKEND_ROOT + "/api/translate";
    const BACKEND_API_KEY = "RdWpKEYb817770xEOF"; // YOUR API KEY
    const BACKEND_FETCH_HEADERS = {
        "Content-Type": "application/json",
        "x-api-key": `${BACKEND_API_KEY}` // you can also use `x-api-key` and pass the key without Bearer
    }
    
    const APP_VERSION = '2.5.5-CSP';
    const APP_USER_AGENT = `SWPFL (spotify.user.js variant) v${APP_VERSION} +https://github.com/jayxdcode/swpfl`;
    
    const LRCLIB_HEADERS = {
        'User-Agent': APP_USER_AGENT,
        'Accept': "application/json"
    };
    
    const mobileDebug = false; // only set to true if you have eruda.
    
    /*
    UPDATE v2.9.2 (from swpfl): added all querySelectors in one area for easier patches when site changes querySelectors. (Also for reusing code for other sites like YTM)
    */
    const defSel = {
        "lastUpd": "2025-11-30T22:55:03.000Z",
        "site": "open.spotify.com",
        "version": 2,
        
        // flat selectors (keep these for existing flat-style code)
        "input": "[data-testid='playback-progressbar'] input[type='range']",
        "slider": "div[role='slider'][aria-valuenow]",
        "title": "[data-testid='now-playing-bar'] [data-testid='context-item-info-title'] a[data-testid='context-item-link']",
        "artist": "[data-testid='now-playing-bar'] [data-testid='context-item-info-artist']",
        "bar": "[data-testid='now-playing-bar']",
        
        // --- nested shapes (compat for BETA / merged code) ---
        "parseAl": { "titleText": "title" },
        
        "timeJump": {
            "input": "[data-testid='playback-progressbar'] input[type='range']",
            "slider": "div[role='slider'][aria-valuenow]"
        },
        
        "getTrackInfo": {
            "bar": "[data-testid='now-playing-bar']",
            "titleEl": "[data-testid='now-playing-bar'] [data-testid='context-item-info-title'] a[data-testid='context-item-link']",
            "artistEl": "[data-testid='now-playing-bar'] [data-testid='context-item-info-artist']",
            "progressInput": "[data-testid='playback-progressbar'] input[type='range']"
        },
        
        "renderLyrics": {
            "progressInput": "[data-testid='playback-progressbar'] input[type='range']",
            "t": "div[data-test-position]",
            "tAttr": "data-test-position"
        },
        
        "syncLyrics": {
            "progressInput": "[data-testid='playback-progressbar'] input[type='range']",
            "t": "div[data-test-position]",
            "tAttr": "data-test-position"
        },
        
        "setupProgressSync": { "pbar": "[data-test-position]" },
        
        "__readyObserver": "[data-testid='now-playing-bar']"
    };
    
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
                debug('[queryFirst] invalid selector', s, e?.message || e);
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
    let prevLyricsData = null;
    let lyricsData = null;
    let observer = null;
    let isDragging = false;
    let dragLocked = false;
    let isResizing = false;
    let currentOpacity = parseFloat(localStorage.getItem(OPACITY_KEY)) || 0.85;
    let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';
    let lastRenderedIdx = -1;
    
    let rafId = null;
    
    function stopRAFSync() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }
    
    let logVisible = false
    
    let dur = 0;
    let playbackPos = 0;
    
    const fallbackSync = true;
    
    let notifExists = false;
    let notifIdx = 0;
    
    const delayTune = 0; // How much delay do you observe? (in ms)
    // if delay, use positive value. if advance, use negative
    
    function timedVexAlert(message, duration = 3000) {
        const instance = vex.dialog.alert({
            message: message,
            buttons: []
        });
        
        setTimeout(() => {
            vex.close(instance);
        }, duration);
    }
    
    const injectRemoteCSS = (url) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = url;
        document.head.appendChild(link);
    };
    
    // Usage for vex styles
    injectRemoteCSS('https://cdnjs.cloudflare.com/ajax/libs/vex-js/4.1.0/css/vex.min.css');
    
    function setupCSS() {
        // === Lyrics renderer styles
        injectCSS('.tm-lrc { min-height:1.6em; } .tm-lyric-line { opacity:.7; } .tm-lyric-line:not(.empty) { white-space: pre-wrap; color: #fff; display: block; } .tm-lrc.plain, .tm-lyric-current { font-weight:bold; font-size:1.25em } .tm-lrc > div { font-size:.75em; color:#ccc; margin-top:2px; } .tm-lrc > div.romanization { font-style:italic !important }');
        
        // === Icon style (Material Icons) ========
        injectCSS(`
/* fallback */
@font-face {
  font-family: 'Material Icons';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/materialicons/v145/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2) format('woff2');
}

.material-icons {
  font-family: 'Material Icons';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

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
        
        // === vex styles ============
        injectCSS(`
/* ==========================================================================
   Vex Modal Base & Overlay Layout
   ========================================================================== */
.vex-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10004;
    display: flex;
}

.vex {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10005;
    display: flex;
    justify-content: center; /* Horizontally centers the modal */
    align-items: flex-start; /* Aligns modal to the top */
    padding-top: 50px;       /* Keeps it exactly 50px away from top */
    overflow-y: auto;
}

/* Backdrop Overlay - Dark with slight blur */
.vex.vex-theme-dark-wireframe .vex-overlay {
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
}

/* ==========================================================================
   Main Modal Window
   ========================================================================== */
.vex.vex-theme-dark-wireframe .vex-content {
    background: #282828;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
    border: 2px solid #404040;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    
    /* Structured Layout */
    display: flex;
    flex-direction: column;
    
    /* Dimensions */
    width: 100%;
    max-width: 440px;
    min-height: 200px;
    max-height: calc(100vh - 100px); /* Prevents spilling off-screen */
    
    position: relative;
    box-sizing: border-box;
}

/* ==========================================================================
   Inner Content Elements
   ========================================================================== */

/* Message / Content text inside the modal */
.vex.vex-theme-dark-wireframe .vex-dialog-message {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 16px;
    color: #ffffff;
    line-height: 1.4;
}

/* Form Inputs (For prompts/inputs inside vex) */
.vex.vex-theme-dark-wireframe .vex-dialog-form {
    display: flex;
    flex-direction: column;
    flex-grow: 1; /* Makes the form fill space to help anchor buttons */
}

.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input {
    margin-bottom: 24px;
}

.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input textarea,
.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input input[type="text"],
.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input input[type="password"],
.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input input[type="number"],
.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input input[type="email"] {
    background: #1f1f1f;
    color: #ffffff;
    border: 1px solid #404040;
    border-radius: 4px;
    padding: 10px 12px;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    font-size: 14px;
    transition: border-color 0.1s ease;
}

.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input input:focus,
.vex.vex-theme-dark-wireframe .vex-dialog-form .vex-dialog-input textarea:focus {
    outline: none;
    border-color: #ffffff; /* Crisp stark wireframe focus outline */
}

/* ==========================================================================
   Buttons Area (Anchored to Bottom)
   ========================================================================== */
.vex.vex-theme-dark-wireframe .vex-dialog-buttons {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    margin-top: auto; /* Crucial: Pushes the button row to the absolute bottom */
    padding-top: 16px;
}

/* Base button defaults */
.vex.vex-theme-dark-wireframe .vex-dialog-button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s ease, border-color 0.1s ease;
    box-sizing: border-box;
}

/* Primary/Submit Button (Stark solid) */
.vex.vex-theme-dark-wireframe .vex-dialog-button.vex-dialog-button-primary {
    background: #e6e6e6;
    color: #000000;
    border: 1px solid transparent;
}

.vex.vex-theme-dark-wireframe .vex-dialog-button.vex-dialog-button-primary:hover {
    background: #ffffff;
}

/* Secondary/Cancel Button (Outlined/Wireframe) */
.vex.vex-theme-dark-wireframe .vex-dialog-button.vex-dialog-button-secondary {
    background: #333333;
    color: #ffffff;
    border: 1px solid #404040;
}

.vex.vex-theme-dark-wireframe .vex-dialog-button.vex-dialog-button-secondary:hover {
    background: #404040;
    border-color: #555555;
}

/* ==========================================================================
   Close Button [X]
   ========================================================================== */
.vex.vex-theme-dark-wireframe .vex-close {
    position: absolute;
    top: 16px;
    right: 16px;
    cursor: pointer;
    width: 20px;
    height: 20px;
}

.vex.vex-theme-dark-wireframe .vex-close:before {
    content: "\D7"; /* Multipication sign (X) standard mapping if missing */
    font-size: 22px;
    color: #a7a7a7;
    display: block;
    text-align: center;
    line-height: 20px;
}

.vex.vex-theme-dark-wireframe .vex-close:hover:before {
    color: #ffffff;
}
      `);
        
        
    }
    
    
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
        // Ensure DOMPurify is present (you already @require it, but check at runtime)
        if (typeof DOMPurify === 'undefined') {
            debug('error', 'DOMPurify is required for CSP-safe element creation using sanitization.');
            return null;
        }
        
        // Resolve parent
        let parentEl = parent;
        if (typeof parent === 'string') parentEl = document.querySelector(parent);
        
        // If parent is not found, attach to body but warn (prevents silent failure)
        if (!parentEl) {
            debug('warn', `createCSPSafeElement: parent "${parent}" not found — appending to document.body instead.`);
            parentEl = document.body;
        }
        
        const newElement = document.createElement(tagName);
        const isScript = tagName.toLowerCase() === 'script';
        
        // Apply attributes
        for (const key in attributes) {
            if (Object.prototype.hasOwnProperty.call(attributes, key)) {
                newElement.setAttribute(key, attributes[key]);
            }
        }
        
        // If content is empty, just append and return
        if (!content) {
            parentEl.appendChild(newElement);
            return newElement;
        }
        
        // Trusted Types + DOMPurify path (preferred)
        try {
            if (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
                const policy = trustedTypes.createPolicy('csp-safe-purify', {
                    createHTML: (html) => DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true }),
                    createScript: (s) => s,
                    createScriptURL: (url) => {
                        if (url.startsWith('https://cdnjs.cloudflare.com/') || url.startsWith('/')) return url;
                        debug('warn', `Blocked untrusted script URL: ${url}`);
                        return '';
                    }
                });
                
                if (isScript) {
                    // for script elements prefer src since inline scripts are often blocked
                    if (newElement.hasAttribute('src')) {
                        const trustedUrl = policy.createScriptURL(newElement.getAttribute('src'));
                        if (trustedUrl) newElement.setAttribute('src', trustedUrl);
                    } else {
                        // Avoid adding inline scripts if possible
                        debug('warn', 'createCSPSafeElement: inline scripts are discouraged under CSP/trustedTypes.');
                    }
                } else {
                    newElement.innerHTML = policy.createHTML(content);
                }
                
                parentEl.appendChild(newElement);
                return newElement;
            }
        } catch (e) {
            debug('warn', 'Trusted Types path failed, falling back to DOMPurify innerHTML', e);
        }
        
        // Fallback: use DOMPurify.sanitize -> innerHTML (safer than textContent for intended markup)
        try {
            newElement.innerHTML = DOMPurify.sanitize(content);
            parentEl.appendChild(newElement);
            return newElement;
        } catch (e) {
            debug('error', 'createCSPSafeElement fallback failed — using textContent as last resort', e);
            newElement.textContent = content;
            parentEl.appendChild(newElement);
            return newElement;
        }
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
        debug(`[Lyrics] Aborted fetches for key: ${key}`);
    }
    
    /*******************
     * Abort everything *
     ********************/
    function abortAllFetches() {
        for (const key of Array.from(gmFetchControllers.keys())) abortFetch(key);
        debug('[Lyrics] Aborted ALL fetches');
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
    
    // --- EXTENSION COMPATIBILITY HELPERS ---
    
    // cors bypass patch
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
                let serializedInit = {};
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
    
    // css injection
    // Custom CSS injector that checks for current environment
    async function injectCSS(code) {
        debug('[CSS INJ] injector called');
        try {
            // Direct injection — DOMPurify must NOT be used here,
            // it's for HTML sanitization, not CSS. textContent is safe.
            const style = document.createElement('style');
            style.textContent = code;
            document.head.appendChild(style);
            debug('info', '[CSS INJ] Direct <style> element injected');
        } catch (e) {
            debug('warn', '[CSS INJ] Direct injection via createElement failed.', e);
            
            try {
                debug('info', '[CSS INJ] Proceeding with fallback...')
                if (typeof GM.addStyle === 'function') {
                    await GM.addStyle(code);
                    debug('success', '[CSS INJ] GM.addStyle worked')
                } else if (typeof browser.tabs.insertCSS === 'function') {
                    browser.tabs.insertCSS({ code: code });
                    debug('success', '[CSS INJ] browser.tabs.insertCSS worked')
                } else {
                    debug('warn', '[CSS INJ] Unavailabe - No useable method found.');
                }
            } catch (e) {
                debug('error', '[CSS INJ] All attempts failed.', e.stack, e.message)
            }
        }
    }
    
    // ----------------------------
    
    // --- SITE-SPECIFIC HELPERS ---
    
    async function parseAl(url = null) {
        try {
            if (!url) return '';
            const res = await gmFetch(url);
            const html = res.responseText ?? (await res.text?.()) ?? '';
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const titleText = doc.querySelector("title")?.textContent;
            if (titleText) {
                const match = titleText.match(/^(.*?) - Album by .*? \| Spotify$/);
                if (match && match.length > 1) return match[1];
            }
        } catch (e) {
            debug('parseAl error:', e.message);
        }
        return '';
    }
    
    // timeJump function (only works on SPOTIFY)
    function timeJump(ms) {
        try {
            // Sanitize timestamp
            ms = Number(ms);
            if (isNaN(ms)) return false;
            
            const input = document.querySelector(SELECTORS.input);
            if (input) {
                input.value = ms;
                //input.dispatchEvent(new Event('click', { bubbles: true }));
                input.dispatchEvent(new Event('input', {
                    bubbles: true
                }));
                //input.dispatchEvent(new Event('change', { bubbles: true }));
                debug(`click registered. ms: ${ms}`)
                return;
            }
            
            const slider = document.querySelector(SELECTORS.slider);
            if (slider) {
                slider.setAttribute('aria-valuenow', String(ms));
                slider.dispatchEvent(new Event('input', {
                    bubbles: true
                }));
                slider.dispatchEvent(new Event('change', {
                    bubbles: true
                }));
                return;
            }
            
            console.warn('[Lyrics Panel] Could not seek - slider not found');
            return true;
        } catch (e) {
            debug('[ERROR] timeJump attempt failed: ', e.message);
        }
    }
    
    async function getTrackInfo() {
        const bar = queryFirst(SELECTORS.bar);
        /* Legacy config */
        // const titleEl = queryFirst(SELECTORS.title);
        // const artistEl = queryFirst(SELECTORS.artist);
        // const title = titleEl?.textContent.trim() || '';
        // const artist = artistEl?.textContent.trim() || '';
        // const album = (title && title.href) ? parseAl(title.href) : null;
        
        const title = navigator.mediaSession.metadata.title;
        const artist = navigator.mediaSession.metadata.artist;
        const album = navigator.mediaSession.metadata.album;
        const input = queryFirst(SELECTORS.input)
        let duration = input.max || null;
        return {
            id: title + '|' + artist,
            title,
            artist,
            album,
            duration,
            bar,
            debug: {
                bar: !!bar,
                titleEl: "No need. We use MediaSession API now.",
                artistEl: "No need. (2)",
                albumEl: "No need. (3)",
                input: !!input
            }
        };
    }
    
    function setupProgressSync(bar, durationMs) {
        if (!bar) return;
        if (observer) observer.disconnect();
        
        stopRAFSync();
        
        const t = bar.querySelector("[data-test-position]");
        if (!t) return;
        
        observer = new MutationObserver(() => {
            syncLyrics(bar, durationMs, t.getAttribute('data-test-position'));
        });
        observer.observe(t, {
            attributes: true,
            attributeFilter: ['style', 'aria-valuenow', 'data-test-position']
        });
        
        // rAF fallback — catches position changes the observer may miss (e.g. while paused)
        function tick() {
            syncLyrics(bar, durationMs, t.getAttribute('data-test-position'));
            rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
    }
    
    // ----------------------------
    
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
            debug('Panel is out of bounds or too large for viewport. Adjusting...');
            
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
                vex.dialog.prompt({
                    message: 'Enter manual search query (e.g. song title and artist):',
                    placeholder: 'propose natori',
                    callback: function(manualQuery) {
                        if (manualQuery && manualQuery.trim() !== '') {
                            loadLyrics({ dur: currentTrackDur }, (parsed) => {
                                lyricsData = parsed;
                                renderLyrics(0);
                                setupProgressSync(currInf.bar, currInf.duration);
                            }, {
                                flag: true,
                                query: manualQuery
                            });
                        }
                    }
                });
                
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
                zIndex: 10002
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
                zIndex: 10003,
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
            
            function create(idx, id, lrcS, lrcP) {
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
                createCSPSafeElement(mainSpan, 'text', {}, `Candidate ${idx + 1}`);
                const buttonValue = isSynced ? 'SYNCED' : 'PLAIN only';
                const buttonDisabled = isSynced ? false : true;
                createCSPSafeElement(mainSpan, 'input', {
                    type: 'button',
                    id: `toggle-${idx}`,
                    style: 'margin-left: 1em; font-size: .75em;',
                    value: buttonValue,
                    ...(!isSynced && { disabled: "true" })
                });
                createCSPSafeElement(summary, 'span', {
                    style: 'font-size:12px; opacity:.7;',
                }, '▼');
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
                body.dataset.lrclibId = id;
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
                        create(idx, c.id, lrcS, lrcP);
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
                vex.dialog.prompt({
                    message: 'Enter manual search query (e.g., song title and artist):',
                    placeholder: 'propose natori',
                    callback: function(manualQuery) {
                        if (manualQuery && manualQuery.trim() !== '') {
                            overlay.remove();
                            menu.remove();
                            const [title,
                                artist
                            ] = currentTrackId.split('|');
                            loadLyrics({ title, artist, dur: currentTrackDur }, (parsed) => {
                                lyricsData = parsed;
                                renderLyrics(0);
                                if (currInf) {
                                    setupProgressSync(currInf.bar, currInf.duration);
                                }
                            },
                            {
                                flag: true,
                                query: manualQuery
                            });
                        }
                    }
                });
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
                    debug("[RESET] trackKey to delete:",
                        trackKey);
                    debug("[RESET] keys before delete:",
                        Object.keys(config));
                    delete config[trackKey];
                    localStorage.setItem(CONFIG_KEY,
                        JSON.stringify(config));
                    debug("[RESET] keys after delete:",
                        Object.keys(config));
                    
                    // Close the manual panel
                    overlay.remove();
                    menu.remove();
                    
                    // Reload lyrics from normal source
                    const [t, a] = trackKey.split('|');
                    loadLyrics({
                            title: t,
                            artist: a,
                            duration: currentTrackDur
                        },
                        parsed => {
                            lyricsData = parsed;
                            renderLyrics(0);
                            if (currInf) setupProgressSync(currInf.bar, currInf.duration);
                        });
                } catch (error) {
                    debug("[RESET] Failed to reset pick:",
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
                    timedVexAlert("Please select exactly one candidate to use.");
                    return;
                }
                
                const selected = openBodies[0].querySelector('pre:last-of-type');
                
                const lrclib_id = Number(selected.dataset.lrclibId);
                const rawLrc = selected.textContent;
                
                const lines = rawLrc.trim().split('\n').map(l => l.trim());
                
                // Check if the line at index 7 exists and test it
                // why 7? educated guess on where the metadatas (if any) will be way beyond
                // If it doesn't have a timestamp, plain is true
                const targetLine = [...lines.filter(Boolean)][7];
                const synced = /^\[\d+:\d{2}(\.\d+)?\]/.test(targetLine);
                
                const offset = parseInt(offInput.value, 10) || 0;
                
                const [t, a] = trackKey.split('|');
                
                lyricsConfig[trackKey] = { lrclib_id, synced, manualLrc: addTimestamps(rawLrc), offset };
                localStorage.setItem(CONFIG_KEY, JSON.stringify(lyricsConfig));
                
                overlay.remove();
                menu.remove();
                
                // reload. use normal loadLyrics so UI flow remains same
                loadLyrics({
                        title: t,
                        artist: a,
                        duration: 0
                    },
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
            debug("[ERROR] showManualLyricsMenu error:", e.message);
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
                zIndex: 10000,
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
                zIndex: 10001,
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
            
            const headerTitle = createCSPSafeElement(header, 'span', { id: 'tm-header-title' }, dragLocked ? `<b>Lyrics (Locked)</b>` : `<b>Lyrics</b>`)
            
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
            refreshBtn.className = 'material-icons-button ';
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
            const ghLink = createCSPSafeElement(ghIcon, 'a', {
                href: 'https://github.com/jayxdcode',
                target: '_blank',
                title: 'View on GitHub',
                style: 'opacity:0.8; color:white'
            }, `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>`);
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
                    style: "padding: 12px;  overflow-y: auto; scroll-behavior: smooth; flex: 1 1 auto; min-height: 0;",
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
            debug("[ERROR] createPanel error: ",
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
            debug('error', "detectLongClick: Invalid element or onLongClick callback provided.");
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
    
    // ─── SSE helper ──────────────────────────────────────────────────────────────
    // Uses GM_xmlhttpRequest instead of native EventSource so the stream can bypass
    // CORS restrictions in userscripts.
    //
    // Works with Tampermonkey/Violentmonkey style APIs:
    // - GM_xmlhttpRequest(...)
    /// - GM.xmlHttpRequest(...)
    //
    // Expects the server to emit SSE frames like:
    // data: {"status":"queued"}
    //
    // data: {"status":"done","result":...}
    //
    // The AbortSignal closes the request early (e.g. when the user skips tracks).
    
    function waitForTranslation(stream_url, signal) {
        return new Promise((resolve, reject) => {
            const url = `${BACKEND_ROOT}/${stream_url.replace(/^\//, '')}`;
            
            const xhrApi =
                typeof GM_xmlhttpRequest === 'function' ?
                GM_xmlhttpRequest :
                (GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
            
            if (!xhrApi) {
                reject(new Error('GM_xmlhttpRequest is not available in this userscript environment.'));
                return;
            }
            
            let settled = false;
            let retries = 0;
            const maxRetries = 3;
            let lastEventId = '';
            let buffer = '';
            let processedLength = 0;
            let request = null;
            
            const settleResolve = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };
            
            const settleReject = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };
            
            const cleanup = () => {
                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
                
                if (request && typeof request.abort === 'function') {
                    try { request.abort(); } catch {}
                }
                
                request = null;
            };
            
            const onAbort = () => {
                settleReject(new DOMException('Aborted', 'AbortError'));
            };
            
            if (signal) {
                if (signal.aborted) {
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
            
            const parseEventBlock = (block) => {
                let eventName = 'message';
                let dataLines = [];
                let id = null;
                
                const lines = block.split(/\r?\n/);
                
                for (const line of lines) {
                    if (!line || line.startsWith(':')) continue;
                    
                    const colonIdx = line.indexOf(':');
                    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
                    let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
                    
                    if (value.startsWith(' ')) value = value.slice(1);
                    
                    if (field === 'event') {
                        eventName = value;
                    } else if (field === 'data') {
                        dataLines.push(value);
                    } else if (field === 'id') {
                        id = value;
                    }
                }
                
                if (id !== null) {
                    lastEventId = id;
                }
                
                const dataStr = dataLines.join('\n').trim();
                if (!dataStr) return;
                
                let data;
                try {
                    data = JSON.parse(dataStr);
                } catch {
                    return;
                }
                
                if (data.status === 'done') {
                    settleResolve(extractRomTransl(data.result));
                    return;
                }
                
                if (data.status === 'failed') {
                    settleReject(new Error(data.error || 'Translation job failed.'));
                    return;
                }
                
                if (data.status === 'timed_out') {
                    settleReject(new Error('Translation job timed out on the server.'));
                    return;
                }
                
                if (data.status === 'not_found') {
                    settleReject(new Error('Job not found on the server.'));
                    return;
                }
                
                // 'queued' / 'processing' statuses are informational — keep listening
            };
            
            const processBuffer = () => {
                if (settled) return;
                
                while (true) {
                    const nextBreak = buffer.search(/\r?\n\r?\n/);
                    if (nextBreak === -1) break;
                    
                    const block = buffer.slice(0, nextBreak);
                    const match = buffer.slice(nextBreak).match(/^\r?\n\r?\n/);
                    const breakLen = match ? match[0].length : 2;
                    
                    buffer = buffer.slice(nextBreak + breakLen);
                    
                    parseEventBlock(block);
                    if (settled) return;
                }
            };
            
            const startRequest = () => {
                if (settled) return;
                
                buffer = '';
                processedLength = 0;
                
                request = xhrApi({
                    method: 'GET',
                    url,
                    headers: {
                        'Accept': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {})
                    },
                    overrideMimeType: 'text/event-stream; charset=utf-8',
                    
                    onprogress: (res) => {
                        if (settled) return;
                        
                        const text = res.responseText || '';
                        if (text.length < processedLength) {
                            processedLength = 0;
                        }
                        
                        buffer += text.slice(processedLength);
                        processedLength = text.length;
                        
                        processBuffer();
                    },
                    
                    onload: (res) => {
                        if (settled) return;
                        
                        const text = res.responseText || '';
                        if (text.length > processedLength) {
                            buffer += text.slice(processedLength);
                            processedLength = text.length;
                            processBuffer();
                        }
                        
                        if (settled) return;
                        
                        if (retries < maxRetries) {
                            retries++;
                            debug(
                                `[SSE] Connection ended. Retrying attempt ${retries}/${maxRetries}...`
                            );
                            setTimeout(startRequest, 1000);
                            return;
                        }
                        
                        settleReject(
                            new Error('SSE connection failed or was closed unexpectedly after multiple attempts.')
                        );
                    },
                    
                    onerror: () => {
                        if (settled) return;
                        
                        if (retries < maxRetries) {
                            retries++;
                            debug(
                                `[SSE] Connection dropped. Retrying attempt ${retries}/${maxRetries}...`
                            );
                            setTimeout(startRequest, 1000);
                            return;
                        }
                        
                        settleReject(
                            new Error('SSE connection failed or was closed unexpectedly after multiple attempts.')
                        );
                    }
                });
            };
            
            startRequest();
        });
    }
    
    async function fetchTranslations(payload, signal = null) {
        debug('[INFO] initialized fetchTranslations');
        const defaultOut = { rom: '', transl: '' };
        
        if (!BACKEND_API_KEY) {
            debug('warn', '[WARN] No API Key has been set by the user. Returning empty response...')
            return defaultOut;
        }
        try {
            const response = await gmFetchPost(BACKEND_URL, payload, BACKEND_FETCH_HEADERS, signal);
            if (response && !(response.status === 200 || response.status === 202 || response.ok)) {
                const errorBody = response.responseText;
                debug('[❗ERROR] Backend server returned an error:', response.status, errorBody);
                return defaultOut;
            }
            
            // CASE 1: Immediate match (already in database)
            if (response?.status === 200) {
                const dataText = response.responseText ?? (await response.text?.());
                const data = JSON.parse(dataText);
                debug('[200] Received backend data:', data);
                
                const finalOutput = (payload.synced && data.isSynced) ? data.synced : data.plain;
                debug(finalOutput);
                
                return finalOutput;
            }
            
            // CASE 2: HTTP 202 => setup waitForTranslation(jobId, signal)
            if (response?.status === 202) {
                const dataText = response.responseText ?? (await response.text?.());
                const data = JSON.parse(dataText);
                debug('[202] Received backend data:', data);
                
                const stream_url = data?.stream_url;
                
                if (!stream_url) return defaultOut;
                
                const awaitedRes = await waitForTranslation(stream_url, signal);
                debug('[202] awaitedRes:', awaitedRes);
                
                const finalOutput = (payload.synced && awaitedRes?.isSynced) ? awaitedRes.synced : awaitedRes.plain;
                debug(finalOutput);
                
                return finalOutput;
            }
            
            
        } catch (error) {
            if (error && error.name === 'AbortError') {
                debug('[fetchTranslations] Aborted');
                throw error; // let caller handle abort specially
            }
            debug('[❗ERROR] Failed to fetch from backend server:', error);
            return defaultOut;
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
            transl: transMap.get(o.time) || ''
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
    
    async function loadLyrics(opts, onTransReady, manual = {
        flag: false,
        query: ""
    }, signal = null) {
        const { title, artist, album, duration } = opts;
        
        if (!manual.flag) {
            debug('Searching for lyrics:', title, artist, album, duration);
            
            onTransReady([{
                time: 0,
                text: 'Searching for lyrics...',
                roman: `Attempt 1 out of 2`,
                transl: `${title}  ${artist}   ${album ?? '???'}\n` + `${(duration/60000|0)}`.padStart(2, '0') + ':' + `${(duration/1000)%60}`.padStart(2, '0') + ` (${duration/1000}s)`
            }]);
        } else {
            debug(`Manually searching lyrics: using user prompt "${manual.query}"...`);
            
            onTransReady([{
                time: 0,
                text: `Manually searching lyrics...`,
                roman: ``,
                transl: `query: "${manual.query}"`
            }]);
        }
        
        const trackKey = `${title}|${artist}`;
        let humanTr = null;
        
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
                    lrclib_id,
                    synced,
                    manualLrc,
                    offset = 0
                } = lyricsConfig[trackKey];
                debug('[INFO] current lrclib_id:', lrclib_id);
                
                onTransReady(parseLRC(addTimestamps(manualLrc), '', '').map(l => ({
                    ...l,
                    time: l.time + offset
                })));
                
                const res = await fetchTranslations({ lrclib_id, synced, lrcText: manualLrc, humanTr, title, artist }, signal);
                
                
                if (!res) return;
                onTransReady(parseLRC(addTimestamps(manualLrc), res.rom, res.transl).map(l => ({
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
                    debug('Retrying lrclib search without album.');
                    
                    onTransReady([{
                        time: 0,
                        text: 'Searching for lyrics...',
                        roman: `Attempt 2 out of 2 (retrying search without album)`,
                        transl: `${title}   ${artist}   ${album ?? '???'}\n` + `${(duration/60000|0)}`.padStart(2, '0') + ':' + `${(duration/1000)%60}`.padStart(2, '0') + ` (${duration}s)`
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
                    roman: '(not caused by the script btw)',
                    transl: 'Maybe this is a new song, a cover, or perhaps instrumental?'
                }]);
                
                return;
            }
            
            
            // --- 4) Process candidate and get translations ---
            const lrclib_id = Number(candidate.id);
            debug('[INFO] current lrclib_id:', lrclib_id);
            
            const synced = !!candidate.syncedLyrics && !!candidate.plainLyrics;
            const rawLrc = candidate.syncedLyrics || addTimestamps(candidate.plainLyrics);
            onTransReady(parseLRC(rawLrc, '', '')); // Render original lyrics immediately
            
            const res = await fetchTranslations({ lrclib_id, synced, lrcText: rawLrc, humanTr, title, artist }, signal);
            
            
            if (!res) return;
            onTransReady(parseLRC(rawLrc, res.rom, res.transl));
            
        } catch (e) {
            // alert(`Error while displaying lrc: ${e} \n\n\n Please report this to \n\nhttps://github.com/jayxdcode/src-backend/issues\n\nalongside with a screenshot of this alert.`);
            debug('[❗ERROR] [Lyrics] loadLyrics error:', `${e}`);
            
            if (e.name === 'AbortError') {
                onTransReady([{
                    time: 0,
                    text: 'Aborted due to changing of tracks while data is being fetched',
                    roman: '',
                    transl: ''
                }]);
                
            } else {
                onTransReady([{
                    time: 0,
                    text: '× An error occurred while loading lyrics.',
                    roman: '',
                    transl: ''
                }]);
                
            }
        }
    }
    
    function parseTimeString(str) {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : (parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 : 0);
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
    
    function renderLyrics(currentIdx) {
        try {
            
            const progInput = document.querySelector(SELECTORS.input);
            let t = fallbackSync ? document.querySelector("div[data-test-position]").getAttribute("data-test-position") : progInput.value;
            
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
                debug('[renderer] change detected in the lyric contents. rebuilding elements...');
                
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
                    if (!ln.text && !ln.roman && !ln.transl) {
                        html += `<div class="tm-lrc tm-lrc-${i} tm-lyric-line empty"></div>`;
                        continue;
                    }

                    const isCurrent = i === currentIdx;
                    const lineClass = isPlain ? `tm-lrc plain tm-lrc-${i}` : `tm-lrc tm-lrc-${i} tm-lyric-${isCurrent ? 'current': 'line'}`;
                    html += `<div class="handler ${lineClass}" data-timestamp="${ln.time}">${ln.text || ' '}`;

                    if (ln.roman && ln.text.trim() !== ln.roman.trim()) {
                        html += `<div class="romanization">${ln.roman}</div>`;
                    }
                    if (ln.transl && ln.text.trim() !== ln.transl.trim()) {
                        html += `<div class="translation">${ln.transl}</div>`;
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
                    if (!ln.text && !ln.roman && !ln.transl) {
                        // create the empty line div
                        createCSPSafeElement(linesDiv, 'div', {
                            class: `tm-lrc tm-lrc-${i} tm-lyric-line empty`,
                            style: 'margin-bottom: 15px'
                        });
                        continue;
                    }
                    
                    const isCurrent = i === currentIdx;
                    const lineClass = isPlain ?
                        `tm-lrc plain tm-lrc-${i}` :
                        `tm-lrc tm-lrc-${i} tm-lyric-${isCurrent ? 'current': 'line'}`;
                    
                    // 1. Create and append the main handler div using GM.addElement
                    const handlerDiv = createCSPSafeElement(linesDiv, 'div', {
                        class: `handler ${lineClass}`,
                        style: Object.values(ln).filter(Boolean).length > 1 ? `margin-bottom: 35px;` : `margin-bottom: 10px;`,
                        'data-timestamp': ln.time
                    }, ln.text || ' ');
                    
                    // 2. Add romanization if present and different
                    if (ln.roman && ln.text.trim() !== ln.roman.trim()) {
                        createCSPSafeElement(handlerDiv, 'div', {
                            class: 'romanization'
                        }, ln.roman);
                    }
                    
                    // 3. Add translation if present and different
                    if (ln.transl && ln.text.trim() !== ln.transl.trim()) {
                        createCSPSafeElement(handlerDiv, 'div', { class: 'translation' }, ln.transl);
                    }
                }
                
                debug("[renderer] updated done");
                
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
                linesDiv.scrollTop =
                    currElem.offsetTop -
                    (linesDiv.clientHeight / 2) +
                    (currElem.offsetHeight / 2);
            } else {
                // currElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                const progInput = document.querySelector(SELECTORS.input);
                t = fallbackSync ? document.querySelector("div[data-test-position]").getAttribute("data-test-position") : progInput.value;
            }
            
            if (!Number.isFinite(t)) {
                //debug("[syncLyrics] Invalid time value:", t);
                return;
            }
            
            playbackPos = t + delayTune;
            
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
            } else {
                //debug("[syncLyrics] Lyric index unchanged:", idx);
            }
        } catch (error) {
            debug("[syncLyrics] ERROR:", error.message, error);
        }
    }
    
    async function poller() {
        try {
            const info = await getTrackInfo();
            // debug(info.debug);
            if (!info || !info.title || !info.artist) {
                debug('[Poller] Missing info:', info);
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
                    
                    const { bar, id, debug, ...meta } = info;
                    
                    await loadLyrics(meta, (parsed) => {
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
            debug('[❗ERROR] [Poller Error]', e.message);
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
        if (compWindow.eruda && compWindow.eruda.get) {
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
                info: 'lightblue',
                log: 'lightblue'
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
    
    
    function init() {
        setupLogElement();
        
        debug(`Welcome! SWPFL (spotify.user.js variant) version ${APP_VERSION}. Debug logs active!`);
        debug('Initializing Lyrics Panel');
        createPanel();
        handleViewportChange(); // immediately run
        window.addEventListener('resize', debounce(handleViewportChange, 250));
        
        function runPoller() {
            poller().finally(() => setTimeout(runPoller, POLL_INTERVAL));
        }
        runPoller();
        
        // Vex setup
        vex.defaultOptions.className = 'vex-theme-dark-wireframe';
        vex.dialog.defaultOptions.className = 'vex-theme-dark-wireframe';
        
        setupCSS(); // Moved setupCSS into init() to ensure it will run when all APIs are available
    }
    
    // Global state variables for the observer
    let statObserver = null;
    let targetNode = null;
    const config = {
        childList: true,
        subtree: false,
    };
    
    // --- UPDATED ENTRY POINT ---
    function safeInit() {
        // Prevent double init
        if (window.hasInitializedSWPFL) return;
        window.hasInitializedSWPFL = true;
        init();
    }
    
    /*
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            safeInit();
        } else {
            window.addEventListener('load', safeInit);
        }
        */
    // ---------------------------
    
    // Wait for the main UI to be available before initializing
    const readyObserver = new MutationObserver((mutations, obs) => {
        if (document.querySelector(SELECTORS.bar)) {
            obs.disconnect();
            safeInit();
        }
    });
    
    // Now document.body is guaranteed to be a valid object
    readyObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    
} catch (e) {
    if (typeof GM.notification === 'function') {
        GM.notification({ text: `${e.message}:\n\n${e}`, title: 'Fatal Userscript Error', timeout: 30000 });
    } else if (typeof browser.notifications.create === 'function') {
        browser.notifications.create("", {
            type: 'basic',
            title: 'Fatal Extension Error',
            message: `${e.message}:\n\n${e}`
        });
    }
}