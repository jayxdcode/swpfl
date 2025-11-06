// ==UserScript==
// @name         [BETA] Spotify Web Player Floating Lyrics
// @namespace    http://tampermonkey.net/
// @version      2.9.2
// @description  Synced lyrics with translation/romanization resizable/draggable panel, themed, opacity control. Translations are provided by Gemini 2.0 Flash and 1.5 Flash via the Google AI Studio API (Accessed via a remote server).
// @author       jayxdcode
// @match        https://open.spotify.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      lrclib.net
// @connect      src-backend.onrender.com
// @connect      swpfl-lrc.onrender.com
// @connect      genius.com
// @connect      google.com
// @connect      musicbrainz.org
// @connect      sv443.net
// @copyright    2025, jayxdcode
// @sandbox      JavaScript
// @require      http://192.168.8.10:8080/socket.io/socket.io.js
// @downloadURL  https://raw.githubusercontent.com/jayxdcode/swpfl/main/monkey/swpfl.user.js?dl=true
// @updateURL    https://raw.githubusercontent.com/jayxdcode/swpfl/main/monkey/swpfl.user.js?dl=true
// ==/UserScript==

(function() {
  'use strict';

  // -- begin --
  const SWPFL_VERSION = '2.9.2';
  const SWPFL_USER_AGENT = `SWPFL (user.js release) v${SWPFL_VERSION} (https://github.com/jayxdcode/swpfl)`;

  const LRCLIB_HEADERS = {
    'User-Agent': SWPFL_USER_AGENT,
    'Accept': "application/json"
  };

  const mobileDebug = true; // only set to true if you have eruda.
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

    ws: true, // toggle
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
      UPDATE v2.9.2: added all querySelectors in one area for easier patches when site changes querySelectors. (Also for reusing code for other sites like YTM)
    */
  const SELECTORS = {
    "lastUpd": "2025-11-06T11:31:02Z", // ISO 8601
    "parseAl": {
      "titleText": "title"
    },
    "timeJump": {
      "input": "[data-testid='playback-progressbar'] input[type='range']",
      "slider": "div[role='slider'][aria-valuenow]"
    },
    "getTracInfo": {
      "bar": "[data-testid='now-playing-bar'], [data-testid='main-view-player-bar'], [data-testid='bottom-bar'], footer",

      "titleEl": "[data-testid='context-item-info-title'] [data-testid='context-item-link'], [data-testid='nowplaying-track-link'], [data-testid='now-playing-widget-title'] a, .track-info__name a",
      "artistEl": "[data-testid='context-item-info-artist'], [data-testid='nowplaying-artist'], [data-testid='now-playing-widget-artist'] a, .track-info__artists a",
      "progressInput": "input[type='range']"
    },
    "renderLyrics": {
      "progressInput": "[data-testid='playback-progressbar'] input[type='range']",
      "t": "div[data-test-position]",
      "tAttr": "data-test-position"
    },
    "synceLyrics": {
      "progressInput": "[data-testid='playback-progressbar'] input[type='range']",
      "t": "div[data-test-position]",
      "tAttr": "data-test-position"
    },
    "setupProgressSync": {
      "pbar": "[data-test-position]"
    },
    "__readyObserver": "[data-testid='now-playing-bar'], [data-testid='main-view-player-bar']"
  }

  const BACKEND_URL = "https://src-backend.onrender.com/api/translate";

  const POLL_INTERVAL = 1000;
  const STORAGE_KEY = 'tm-lyrics-panel-position';
  const SIZE_KEY = 'tm-lyrics-panel-size';
  const THEME_KEY = 'tm-lyrics-theme';
  const OPACITY_KEY = 'tm-lyrics-opacity';
  const CONFIG_KEY = 'tm-lyrics-config';

  const compWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow: window;
  let lyricsConfig = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  let lastCandidates = [];
  let currentTrackId = null;
  let currentTrackDur = null;
  let currInf = null;
  let syncIntervalId = null;
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

  const fallbackSync = true;

  let notifExists = false;
  let notifIdx = 0;

  const delayTune = 1100; // How much delay do you observe? (in ms)

  const WEBSOCKET_URL = 'http://192.168.8.10:8080';
  let socket = null;
  const RECONNECT_INTERVAL = 5000; // 5 seconds in milliseconds

  const ms2mmss = (ms) => {
    return new Date(ms).toISOString().slice(14, 19);
  };

  function connectWebSocket() {
    socket = new io(WEBSOCKET_URL);

    socket.onopen = () => {
      debug('[WS open] Connection established.');
      // You can send a message here, like an "I'm back" message
    };

    socket.onmessage = (event) => {
      debug(`[WS message] Data received: ${event.data}`);
      // Handle incoming data
    };

    socket.onclose = (event) => {
      debug('[WS close] Connection closed. Attempting to reconnect...');
      // Only attempt to reconnect if the close wasn't intentional
      if (!event.wasClean) {
        setTimeout(connectWebSocket, RECONNECT_INTERVAL);
      }
    };

    socket.onerror = (error) => {
      debug(`[WS error] WebSocket error: ${error.message}`);
      // The 'close' event will usually follow an 'error' event, triggering the reconnect logic there.
    };
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

  /**
  * Abort everything
  */
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
        left: panel.style.left, top: panel.style.top
      }));
      localStorage.setItem(SIZE_KEY, JSON.stringify({
        width: panel.style.width, height: panel.style.height
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
            flag: true, query: manualQuery
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
        padding: '12px 16px', fontWeight: 'bold', borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      });
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      Object.assign(closeBtn.style, {
        background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer'
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
        flex: '1', overflowY: 'auto', padding: '8px'
      });
      menu.appendChild(list);

      function create(isSynced, idx, lrc, tr = null) {

        const panel = document.createElement('div');
        Object.assign(panel.style, {
          background: '#333', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden'
        });

        // Summary row
        const summary = document.createElement('div');
        Object.assign(summary.style, {
          padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
        });
        summary.innerHTML = `<span>Candidate ${idx + 1} <input type="button" id="toggle-${idx}" style="margin-left: 1em; size: .75em;" ${isSynced ? 'value="SYNCED"': 'value="PLAIN only" disabled'} /></span><span style="font-size:12px; opacity:.7;">▼</span>`;

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
        preview.textContent = lrc.split("\n").slice(0, 3).join('\n');
        Object.assign(preview.style, {
          margin: '0 12px 8px', padding: '0', fontSize: '12px', lineHeight: '1.2', color: '#ccc'
        });
        panel.appendChild(preview);

        // Body (hidden full lyrics)
        const body = document.createElement('pre');

        body.id = `item${idx}`;
        if (tr) body.setAttribute('data-tr', tr);
        body.textContent = lrc;
        Object.assign(body.style, {
          margin: 0, padding: '8px 12px', fontSize: '13px', lineHeight: '1.4', whiteSpace: 'pre-wrap', display: 'none', background: '#2b2b2b'
        });
        panel.appendChild(body);

        // Toggle on click
        summary.onclick = () => {
          const isOpen = body.style.display === 'block';
          body.style.display = isOpen ? 'none': 'block';
          summary.querySelector('span:last-child').textContent = isOpen ? '▼': '▲';
          updateUseBtnState();
        };

        // Only add click handler if synced
        if (isSynced) {
          let toggleEl = summary.querySelector(`#toggle-${idx}`);
          toggleEl.addEventListener("click", function(event) {
            event.stopPropagation()
            if (event.target.textContent.startsWith("SYNCED")) {
              let content = lrc.trim();
              event.target.textContent = "PLAIN";
              document.querySelector(`#item${idx}`).textContent = content;
              document.querySelector(`#prev${idx}`).textContent = content
              .trim()
              .split("\n")
              .slice(0, 3)
              .join("\n");
            } else {
              let content = ttp(lrc);
              event.target.textContent = "SYNCED";
              document.querySelector(`#line${idx}`).textContent = content;
              document.querySelector(`#prev${idx}`).textContent = content
              .trim()
              .split("\n")
              .slice(0, 3)
              .join("\n");
            }
          });
        }

        list.appendChild(panel);
      }

      lastCandidates.forEach((c, idx) => {
        const tr = c.tr
        // note: tr only works on manual query (to be fixed)

        if (c.syncedLyrics) {
          let lrc = c.syncedLyrics.trim();
          create(true, idx, lrc, tr);
        } else if (!c.syncedLyrics && c.plainLyrics) {
          let lrc = c.plainLyrics.trim();
          create(false, idx, lrc, tr);
        } else {
          return;
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
            artist] = currentTrackId.split('|');
          loadLyrics(title, artist, '', currentTrackDur, (parsed) => {
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
        const inlineTrEl = openBodies[0].querySelector('pre[data-tr]');
        const inlineTr = inlineTrEl ? inlineTrEl.getAttribute('data-tr'): null;

        const [t,
          a] = trackKey.split('|');

        (async function() {
          // ensure config object exists
          if (!lyricsConfig[trackKey] || typeof lyricsConfig[trackKey] !== 'object') {
            lyricsConfig[trackKey] = {};
          }

          // confirm only if already v2configured (protects against undefined)
          if (!lyricsConfig[trackKey].v2configured || confirm("Existing configs found. Proceed?")) {
            // fetch translations from backend; backend returns { rom, transl }
            const {
              rom = "",
              transl = ""
            } = await fetchTranslations(rawLrc, inlineTr, t, a);

            lyricsConfig[trackKey].manualLrc = addTimestamps(rawLrc);
            lyricsConfig[trackKey].romanization = rom || "";
            lyricsConfig[trackKey].translation = transl || "";
            lyricsConfig[trackKey].offset = offset;
            lyricsConfig[trackKey].v2configured = true; // mark it so subsequent logic knows it's configured

            localStorage.setItem(CONFIG_KEY, JSON.stringify(lyricsConfig));
          }
        })();

        overlay.remove();
        menu.remove();

        // reload—use normal loadLyrics so UI flow remains same
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
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', zIndex: 9998, pointerEvents: 'none'
      });
      const panel = document.createElement('div');
      panel.id = 'tm-lyrics-panel';
      Object.assign(panel.style, {
        position: 'fixed', width: '470px', height: '390px', minWidth: '470px', minHeight: '390px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', borderRadius: '10px', fontSize: '25px', lineHeight: '1.6', padding: '0', overflow: 'hidden', pointerEvents: 'auto', userSelect: 'none', zIndex: 9999, border: '2px solid #333', display: 'flex', flexDirection: 'column'
      });
      const defaultPos = {
        left: '100px',
        top: '100px'
      };
      const savedPos = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      panel.style.left = (savedPos && savedPos.left) ? savedPos.left: defaultPos.left;
      panel.style.top = (savedPos && savedPos.top) ? savedPos.top: defaultPos.top;
      const savedSize = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
      if (savedSize && savedSize.width && savedSize.height) {
        panel.style.width = savedSize.width;
        panel.style.height = savedSize.height;
      }
      const header = document.createElement('div');
      header.id = 'tm-lyrics-header';
      Object.assign(header.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 14px', cursor: 'move', userSelect: 'none', borderTopLeftRadius: '10px', borderTopRightRadius: '10px', flexShrink: 0
      });
      const title = document.createElement('span');
      title.id = 'tm-header-title';
      title.innerHTML = dragLocked ? '<b>Lyrics (Locked)</b>': '<b>Lyrics</b>';
      header.appendChild(title);

      detectLongClick(title, toggleLogVisibility, null, 1000);

      const controls = document.createElement('div');
      Object.assign(controls.style, {
        display: 'flex', gap: '8px', alignItems: 'center'
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
      const ghIcon = document.createElement('div');
      Object.assign(ghIcon.style, {
        display: 'flex', alignItems: 'center', paddingTop: '5px', fontSize: '14px'
      });
      ghIcon.innerHTML = `<a href="https://github.com/jayxdcode" target="_blank" title="View on GitHub" style="opacity:0.8; color:white"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg></a>`;
      controls.append(manualBtn, opDown, opUp, ghIcon);
      header.appendChild(controls);
      controls.querySelectorAll('button').forEach(btn => Object.assign(btn.style, {
        background: 'transparent', color: '#fff', border: '2px solid #333', borderRadius: '4px', padding: '6px 10px', fontSize: '14px', cursor: 'pointer', transition: 'opacity 0.2s'
      }));
      const content = document.createElement('div');
      content.id = 'tm-lyrics-lines';
      Object.assign(content.style, {
        padding: '12px', overflowY: 'auto', scrollBehavior: 'smooth', flex: '1 1 auto', minHeight: '0'
      });
      content.innerHTML = '<em>Lyrics will appear here</em>';
      const resizeHandle = document.createElement('div');
      resizeHandle.id = 'tm-lyrics-resize';
      Object.assign(resizeHandle.style, {
        position: 'absolute', right: '1px', bottom: '.5px', width: '18px', height: '18px', cursor: 'nwse-resize', background: 'linear-gradient(135deg,transparent 60%,#888 60%)', opacity: 1
      });
      panel.appendChild(header);
      panel.appendChild(content);
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
            left: panel.style.left, top: panel.style.top
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
            left: panel.style.left, top: panel.style.top
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
            width: panel.style.width, height: panel.style.height
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
            width: panel.style.width, height: panel.style.height
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
        const req = GM_xmlhttpRequest( {
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
        const req = GM_xmlhttpRequest( {
          method: 'POST',
          url,
          headers,
          data: typeof body === 'string' ? body: JSON.stringify(body),
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
        method: 'POST', headers, body: typeof body === 'string' ? body: JSON.stringify(body)
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


  function toggleLogVisibility() {
    const logs = document.getElementById('tm-logs');
    logs.style.display = logVisible ? 'block': 'none';
    logVisible = logVisible ? false: true;
  }

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



  async function parseAl(url = null) {
    try {
      if (!url) return '';
      const res = await gmFetch(url);
      const html = res.responseText ?? (await res.text?.()) ?? '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const titleText = doc.querySelector(SELECTORS.parseAl
        titleText)?.textContent;
      if (titleText) {
        const match = titleText.match(/^(.*?) - Album by .*? \| Spotify$/); if (match && match.length > 1) return match[1];
      }
    } catch (e) {
      window.debug('parseAl error:', e.message);
    }
    return '';
  }

  async function fetchTranslations(lrcText, humanTr, title, artist, signal = null) {
    try {
      const response = await gmFetchPost(BACKEND_URL, {
        lrcText, geniusLyrics: humanTr, title, artist
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
        const time = parseInt(matches[1], 10) * 60000 + parseInt(matches[2], 10) * 1000 + (matches[3] ? parseInt(matches[3].padEnd(3, '0'), 10): 0);
        lines.push({
          time, text: l.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim()
        });
      }
      regex.lastIndex = 0;
    }
    lines.sort((a, b) => a.time - b.time);
    if (lines.length && lines[0].time !== 0) lines.unshift({
      time: 0, text: ''
    });
    return lines;
  }

  function mergeLRC(origArr, romArr, transArr) {
    const romMap = new Map(romArr.map(r => [r.time, r.text]));
    const transMap = new Map(transArr.map(t => [t.time, t.text]));
    return origArr.map(o => ({
      time: o.time, text: o.text, roman: romMap.get(o.time) || '', trans: transMap.get(o.time) || ''
    }));
  }

  function parseLRC(lrc, romLrc, translLrc) {
    return mergeLRC(parseLRCToArray(lrc), parseLRCToArray(romLrc), parseLRCToArray(translLrc));
  }

  function addTimestamps(lyrics) {
    const timestampRegex = /^\[\d{2}:\d{2}\.\d{2,3}\]/m;
    if (timestampRegex.test(lyrics)) return lyrics;

    debug("info", "No timestamps detected. Proceeding with addTimestamps()...")

    let lines = lyrics.split('\n');
    lines = lines.splice(0, 0, "[00:00.101] PLAIN LRC MODE", "[00:00.102] "); // <- assign result
    const startMs = 103;
    const result = lines.map((line, index) => {
      const ms = startMs + index;
      const timestamp = `[00:00.${String(ms).padStart(3, '0')}]`;
      return `${timestamp} ${line}`;
    });
    return result.join('\n');
  }

  async function loadLyrics(title, artist, album, duration, onTransReady, manual = {
    flag: false, query: ""
  }, signal = null) {
    if (!manual.flag) window.debug('Searching for lyrics:', title, artist, album, duration);
    else window.debug(`Manually searching lyrics: using user prompt "${manual.query}"...`);

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
          ...l, time: l.time + offset
        })));
        const {
          rom,
          transl
        } = await fetchTranslations(manualLrc, geniusLyrics, title, artist, signal);
        onTransReady(parseLRC(addTimestamps(manualLrc), rom, transl).map(l => ({
          ...l, time: l.time + offset
        })));
        const searchRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent([title, artist, album].join(' '))}`, LRCLIB_HEADERS, signal);
        if (searchRes.status === 200 || searchRes.ok) lastCandidates = JSON.parse(searchRes.responseText);

        return;
      }

      // --- 2) Fetch from lrclib (with fallback) ---
      const primaryMetadata = manual.flag ? manual.query: [title,
        artist,
        album].filter(Boolean).join(' ');
      let searchRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent(primaryMetadata)}`, LRCLIB_HEADERS, signal);
      if (!(searchRes.status === 200 || searchRes.ok)) throw new Error('lrclib search failed');
      let searchData = JSON.parse(searchRes.responseText);

      if (!Array.isArray(searchData) || !searchData.some(c => c.syncedLyrics)) {
        if (!manual.flag && album) {
          window.debug('Retrying lrclib search without album.');
          const fallbackRes = await gmFetch(`https://lrclib.net/api/search?q=${encodeURIComponent([title, artist].join(' '))}`, LRCLIB_HEADERS, signal);
          if (fallbackRes.status === 200 || fallbackRes.ok) searchData = JSON.parse(fallbackRes.responseText);
        }
      }
      lastCandidates = Array.isArray(searchData) ? searchData: [];

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
          time: 0, text: '× Failed to find any lyrics for this track.', roman: '', trans: ''
        }]);
        sendImpEvents('Failed to find any lyrics for this track.');
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
      if (e.name === 'AbortError')
        onTransReady([{
        time: 0, text: 'Aborted due to changing of tracks while data is being fetched)', roman: '', trans: ''
      }]);
      sendImpEvents('Aborted due to changing of tracks while data is being fetched)');
    } else {
      onTransReady([{
        time: 0, text: '× An error occurred while loading lyrics.', roman: '', trans: ''
      }]);
      sendImpEvents('An error occured while loading lyrics.');
    }
  }

  function parseTimeString(str) {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000: (parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000: 0);
  }

  function timeJump(ms) {
    try {
      // Sanitize timestamp
      ms = Number(ms);
      if (isNaN(ms)) return false;

      const input = document.querySelector(SELECTORS.timeJump.input);
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

      const slider = document.querySelector(SELECTORS.timeJump.slider);
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

  async function getTrackInfo() {
    const bar = document.querySelector(SELECTORS.getTrackInfo.bar);
    if (!bar) return null;
    const titleEl = bar.querySelector(SELECTORS.getTrackInfo.titleEl));
  const artistEl = bar.querySelector(SELECTORS.getTrackInfo.artistEl);
  const title = titleEl?.textContent.trim() || '';
  const artist = artistEl?.textContent.trim() || '';
  const album = titleEl?.href ? await parseAl(titleEl.href): '';
  const progressInput = bar.querySelector(SELECTORS.getTrackInfo.progressInput);
  const duration = progressInput ? progressInput.max: null;
  return {
    id: title + '|' + artist, title, artist, album, duration, bar
  };
}

  function renderLyrics(currentIdx) {
    try {
      const progressInput = document.querySelector(SELECTORS.renderLyrics.progressInput);
      let t = fallbackSync ? document.querySelector(SELECTORS.renderLyrics.t).getAttribute(SELECTORS.renderLyrics.tAttr): progressInput.value;

      //debug("[renderLyrics] Called with currentIdx:", currentIdx)

      const linesDiv = document.getElementById('tm-lyrics-lines');
      if (!linesDiv) {
        //debug("[renderLyrics] #tm-lyrics-lines not found, aborting.");
        return;
      }

      if (!lyricsData || !Array.isArray(lyricsData)) {
        //debug("[renderLyrics] lyricsData is invalid or not loaded:", lyricsData);
        return;
      }

      let html = '';
      const color = currentTheme === 'light' ? '#000': '#fff';
      const subColor = currentTheme === 'light' ? '#555': '#ccc';
      const start = Math.max(0, currentIdx - 70);
      const end = Math.min(lyricsData.length - 1, currentIdx + 70);

      //debug("[renderLyrics] Rendering lines from", start, "to", end, "of", lyricsData.length);

      const isPlain = lyricsData[0].text.includes('PLAIN');

      for (let i = start; i <= end; i++) {
        const ln = lyricsData[i];
        if (!ln.text && !ln.roman && !ln.trans) {
          html += `<div class="tm-lyric-line" style="min-height:1.6em;"></div>`;
          continue;
        }

        const isCurrent = i === currentIdx;
        const lineClass = `tm-lrc-${i} tm-lyric-${isCurrent ? 'current': 'line'}`;
        const lineStyle = `
        white-space: pre-wrap;
        color: ${color};
        margin: 20px 0;
        min-height: 1.6em;
        display: block;
        ${isCurrent || isPlain
        ? 'font-weight:bold; font-size:1.25em;': 'opacity:.7;'}`.trim();

        html += `<div class="handler ${lineClass}" style="${lineStyle}" data-timestamp="${ln.time}">${ln.text || ' '}`;

        if (ln.roman && ln.text.trim() !== ln.roman.trim()) {
          html += `<div style="font-size:.75em; color:${subColor}; margin-top:2px; font-style: italic !important;">${ln.roman}</div>`;
        }
        if (ln.trans && ln.text.trim() !== ln.trans.trim()) {
          html += `<div style="font-size:.75em; color:${subColor}; margin-top:2px;">${ln.trans}</div>`;
        }
        html += `</div>`;

        //if (isCurrent) debug("[renderLyrics] Current line index:", i, "time:", ln.time, "text:", ln.text);
        // if (isCurrent) debug("[renderLyrics] {idx: ", currentIdx, "} {inline: ", ln.time, "} {progress: ", t, "}");
      }

      linesDiv.innerHTML = html;
      //debug("[renderLyrics] Updated linesDiv.innerHTML");

      const currElem = linesDiv.querySelector('.tm-lyric-current');
      if (currElem && !isPlain) {
        linesDiv.scrollTop =
        currElem.offsetTop -
        (linesDiv.clientHeight / 2) +
        (currElem.offsetHeight / 2);
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
        const progressInput = document.querySelector(SELECTORS.syncLyrics.progressInput);
        //debug("[syncLyrics] progressInput:", progressInput);
        if (!progressInput || fallbackSync === true) {
          //debug("[syncLyrics] progressInput not found.");
          t = Number(document.querySelector(SELECTORS.syncLyrics.t).getAttribute(SELECTORS.syncLyrics.tAttr)) + delayTune;
        } else {
          t = Number(progressInput.value);
        }
      }

      if (!Number.isFinite(t)) {
        //debug("[syncLyrics] Invalid time value:", t);
        return;
      }

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

      if (prefs.ws === true && (Math.floor(t/1000) !== prefs.wsLastSent || idx !== lastRenderedIdx)) {
        prefs.wsLastSent = Math.floor(t/1000);

        let lrc = [];
        lyricsData.forEach(line => {
          const obj = {
            o: line.text,
            r: (line.roman && line.roman.trim() !== "" && line.roman.trim() !== line.text.trim()) ? line.roman.trim(): "",
            t: (line.trans && line.trans.trim() !== "" && line.trans.trim() !== line.text.trim()) ? line.trans.trim(): ""
          }

          lrc.push(obj);
        });
        const data = {
          version: 2,
          ts: Number(t),
          tsf: ms2mmss(t),
          d: Number(currentTrackDur),
          df: ms2mmss(Number(currentTrackDur)),
          ti: currInf.title,
          ar: currInf.artist,
          al: currInf.album,
          idx: idx,
          lrc: lrc
        }


        // debug("data:", JSON.stringify(data));
        try {
          socket.send(JSON.stringify(data));
        } catch(e) {
          debug('error', 'failed to send to socket', e)
        }
      }

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
            ti: (c.roman && c.text.trim() !== c.roman.trim() && !(containsRussian(c.text))) ? c.roman: c.text,
            tx: (c.trans && c.text.trim() !== c.trans.trim()) ? c.trans: "---"
          };

          let sTag = prefs.lrcNotif.fallback ? "tm-lrcNtf_A": "tm-lrcNtf_B";

          if (c.text.trim() != '') {
            GM_notification( {
              text: curr.tx,
              // title: (curr.rom == false) ? c.text : curr.rom,
              title: curr.ti,
              tag: (prefs.lrcNotif.singleMode == true) ? sTag: `tm-lrcNtf-${notifIdx}`,
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
    const pbar = bar.querySelector(SELECTORS.setupProgressSync.pbar);
    if (pbar) {
      observer = new MutationObserver(() => syncLyrics(bar, durationMs));
      observer.observe(pbar, {
        attributes: true, attributeFilter: ['style', 'aria-valuenow', 'data-test-position']
      });
    }
    syncIntervalId = setInterval(() => syncLyrics(bar, durationMs), 1);
  }

  // [DEV-ONLY] Utility for sending important logs to local WebSocket
  function sendImpEvents(msgStr) {
    if (prefs.ws === true && (Math.floor(t/1000) !== prefs.wsLastSent || idx !== lastRenderedIdx)) return;
    prefs.wsLastSent = Math.floor(t/1000);
    const fmtMsg = `<code>${msgStr}</code>`
    const lrc = [{
      o: fmtMsg
    }];

    const data = {
      version: 2,
      ts: Number(t),
      tsf: ms2mmss(t),
      d: Number(currentTrackDur),
      df: ms2mmss(Number(currentTrackDur)),
      ti: currInf.title,
      ar: currInf.artist,
      al: currInf.album,
      idx: idx,
      lrc: lrc
    }

    // debug("data:", JSON.stringify(data));
    try {
      socket.send(JSON.stringify(data));
    } catch(e) {
      debug('error', 'failed to send to socket', e)
    }
  }

  async function poller() {
    try {
      const info = await getTrackInfo();
      if (!info || !info.title || !info.artist) return;
      // inside poller() when track changes:
      if (info.id !== currentTrackId) {
        // cancel any inflight loads for previous track key(s)
        abortFetch(currentTrackId);

        currentTrackId = info.id;
        currInf = info;
        currentTrackDur = info.duration;
        lyricsData = null;
        lastRenderedIdx = -1;
        dur = info.duration;
        const lines = document.getElementById('tm-lyrics-lines');
        if (lines) lines.innerHTML = '<em>Loading lyrics...</em>';

        sendImpEvents('Loading lyrics...')

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
            flag: false, query: ""
          }, controller.signal);
        } catch (e) {
          if (e.name === 'AbortError') {
            debug('[loadLyrics] aborted by controller');
          } else {
            debug('[❗ERROR] loadLyrics:', e, e.message);
            if (lines) lines.innerHTML = '<em>There was a problem while loading the lyrics. Use Manual Lyrics instead.</em>';
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
      const message = args.map(arg => {
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
      }).join(' ');

      // Add class/color styling for mode
      const colorMap = {
        error: 'red',
        warn: 'orange',
        info: 'blue',
        log: 'inherit'
      };
      logs.innerHTML += `<div style="margin:.75em;color:${colorMap[mode]}">${message}</div>`;
      logs.scrollTop = logs.scrollHeight;
    }
  }
  window.debug = debug;

  function init() {
    setupLogElement();

    connectWebSocket();

    window.debug('Initializing Lyrics Panel');
    createPanel();
    window.addEventListener('resize',
      debounce(handleViewportChange, 250));
    setInterval(poller,
      POLL_INTERVAL);
  }

  // Global state variables for the observer
  let statObserver = null;
  let targetNode = null;
  const config = {
    childList: true,
    subtree: false,
  };

  async function sendLyricsContent(lyricsContainer) {
    if (prefs.devOps) {
      if (!got) {
        debug('Initial Content', lyricsContainer.innerHTML.substring(0, 150) + '...');
        got = true;
      }

      fetch('http://localhost:1821/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          a: lyricsContainer.children[0]?.innerHTML ?? null,
          b: lyricsContainer.children[1]?.innerHTML ?? "-",
          source: 'tm-lyrics-lines-observer-update'
        }),
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        debug('Success', `Data sent for container with ${lyricsContainer.children.length} child(ren).`);
        return response.text();
      })
      .catch((error) => {
        debug('Error', 'Fetch failed:', error);
      });
    }
  }

  function startLyricsObserver() {
    targetNode = document.getElementById('tm-lyrics-lines');

    if (!targetNode) {
      debug('Error', 'Target element #tm-lyrics-lines not found. Observer setup aborted.');
      return;
    }

    const observerCallback = function(mutationsList) {
      // Only check on child list mutations
      if (mutationsList.some(m => m.type === 'childList')) {
        const currentChildrenCount = targetNode.children.length;

        if (currentChildrenCount === 1) {
          // Condition: Only one 1st degree child (SEND DATA)
          debug('Condition Met', `Only 1 child found. Sending data.`);
          (async function() {
            await sendLyricsContent(targetNode);
          })();
        } else if (currentChildrenCount > 1) {
          // Condition: More than one 1st degree child (DISCONNECT OBSERVER)
          if (statObserver) {
            (async function() {
              await sendLyricsContent(targetNode);
            })();

            statObserver.disconnect();
            debug('Observer Stopped', `Children count: ${currentChildrenCount}. Observer disconnected.`);
          }
        } else {
          debug('Condition Not Met', `${currentChildrenCount} children found. Skipping data send.`);
        }
      }
    };

    if (!statObserver) {
      statObserver = new MutationObserver(observerCallback);
    }

    // Start observing
    statObserver.observe(targetNode, config);

    console.log('MutationObserver for #tm-lyrics-lines is now active.');
  }

  // Wait for the main UI to be available before initializing
  const readyObserver = new MutationObserver((mutations, obs) => {
    if (document.querySelector(SELECTORS['__readyObserver'])) {
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
  // -- end --
})();