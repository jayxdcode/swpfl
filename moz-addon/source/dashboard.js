async function getLatestTag(owner, repo) {
  const CACHE_KEY = 'swpfl:latest-ver';
  const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

  // 1. Try to serve from cache
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const { tag_name, lastCheck } = JSON.parse(cached);
      const isCacheValid = Date.now() - lastCheck < CACHE_DURATION_MS;

      if (isCacheValid) {
        return tag_name;
      }
      console.log("Cache expired. Proceeding with refetch to GitHub...");
    } catch (e) {
      console.warn("A problem occurred while parsing the cache:", e);
      console.log("Proceeding with refetch to GitHub...");
    }
  } else {
    console.log("Latest version cache miss. Proceeding with refetch to GitHub...");
  }

  // 2. Fetch fresh data from GitHub API
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/vnd.github+json" }
    });

    const data = await res.json();
    const tag = Number(data.status) === 404 ? "unknown" : data.tag_name;

    // 3. Update the cache
    const cachePayload = {
      tag_name: tag,
      lastCheck: Date.now()
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));
      console.log("Saved latest version on localStorage.");
    } catch (e) {
      console.warn("Unable to set latest version cache:", e);
    }

    console.log("Latest release tag:", tag);
    return tag;

  } catch (err) {
    console.error("Failed to get latest release:", err);
    return "?";
  }
}


function getCurrentTime(timezone = 'utc') {
    const now = new Date();
    let year, month, day, hours, minutes;
    
    if (timezone === 'utc') {
        year = now.getUTCFullYear();
        month = String(now.getUTCMonth() + 1).padStart(2, '0');
        day = String(now.getUTCDate()).padStart(2, '0');
        hours = String(now.getUTCHours()).padStart(2, '0');
        minutes = String(now.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
    } else if (timezone === 'local') {
        year = now.getFullYear();
        month = String(now.getMonth() + 1).padStart(2, '0');
        day = String(now.getDate()).padStart(2, '0');
        hours = String(now.getHours()).padStart(2, '0');
        minutes = String(now.getMinutes()).padStart(2, '0');
        // For local time, you might want to append the timezone offset or name.
        // Getting the full timezone name is complex in browsers without external libraries.
        // A common approach is to show the offset.
        const offset = now.getTimezoneOffset(); // returns offset in minutes
        const offsetHours = Math.floor(Math.abs(offset) / 60);
        const offsetMinutes = Math.abs(offset) % 60;
        const offsetSign = offset > 0 ? '-' : '+'; // UTC is ahead of local if offset is positive
        const formattedOffset = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
        
        return `${year}-${month}-${day} ${hours}:${minutes} ${formattedOffset}`;
    } else {
        console.error("Invalid timezone parameter. Please use 'utc' or 'local'.");
        return null;
    }
}

async function getData(url, timeout = 5000) { // default timeout of 5 seconds
    try {
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.open('GET', url, true);
            
            // Set the timeout property
            xhr.timeout = timeout;
            
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    const latency = Date.now() - startTime;
                    let responseJSON = null;
                    
                    try {
                        responseJSON = JSON.parse(xhr.responseText);
                    } catch (parseErr) {
                        console.error("Failed to parse JSON:", parseErr);
                    }
                    
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve({
                            success: true,
                            status: xhr.status,
                            latency: latency,
                            ...(responseJSON || {})
                        });
                    } else {
                        console.error(`Failed to ping ${url}. Status: ${xhr.status} (${xhr.statusText}), Error: ${xhr.responseText || 'No response text'}`);
                        resolve({
                            success: false,
                            status: xhr.status,
                            error: xhr.responseText || 'Unknown error'
                        });
                    }
                }
            };
            
            xhr.onerror = function() {
                const latency = Date.now() - startTime;
                console.error(`Network error occurred while pinging ${url}. Latency: ${latency}ms`);
                resolve({
                    success: false,
                    error: 'Network error or CORS issue'
                });
            };
            
            // Handle timeout specifically
            xhr.ontimeout = function() {
                const latency = Date.now() - startTime;
                console.error(`Request to ${url} timed out. Latency: ${latency}ms`);
                resolve({
                    success: false,
                    error: 'Request timed out'
                });
            };
            
            xhr.send();
        });
    } catch (error) {
        console.error(`An error occurred while setting up ping to ${url}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Converts seconds (float) to a simple "1d 2h 3m 4s" string.
 * @param {number} seconds 
 * @returns {string}
 */
function formatSecondsSimple(seconds) {
    if (!seconds || seconds < 0) return "0s";

    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    // Keeps up to 1 decimal place for seconds if it's a float
    const s = Math.round((seconds % 60) * 10) / 10; 

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);

    return parts.join(' ');
}

async function updateRemoteStatFromJSON(jsonData) {
    try {
        // Local elements
        const currVer = document.querySelector('.currVer');
        const latestVer = document.querySelector('.latestVer');
        
        // Backend elements
        const backStat = document.querySelector(".backStat");
        const backMs = document.querySelector(".backMs");
        const backUptime = document.querySelector(".upt");
        const backCPUL = document.querySelector(".cpuLoad");
        const backFreeRAM = document.querySelector(".freeMem");
        
        // Database elements
        const dbStat = document.querySelector(".dbStat");
        const dbProv = document.querySelector(".dbProv");
        const dbPingLatency = document.querySelector(".dbMs");
        
        // Update local version
        if (currVer) {
            try {
                const res = await fetch("./manifest.json");
                if (res.ok) {
                    const data = await res.json();
                    currVer.textContent = data.version || "?";
                } else {
                    currVer.textContent = "?";
                }
            } catch (err) {
                console.error("Error fetching current version:", err);
                currVer.textContent = "?";
            }
        }
        
        if (latestVer) {
            try {
                latestVer.textContent = await getLatestTag("jayxdcode", "swpfl");
            } catch (err) {
                console.error("Error fetching latest version:", err);
                latestVer.textContent = "?";
            }
        }
        
        // Update backend stats
        if (backStat) {
            backStat.innerHTML = `${jsonData?.status || "Unavailable"}<br><small>${getCurrentTime('local')}</small>`;
            backStat.classList.remove("online");
            backStat.classList.remove("offline");
            backStat.classList.remove("unavailable");
            
            switch (jsonData?.status?.toLowerCase()?.trim()) {
                case 'ok':
                case 'online':
                    backStat.classList.add('online');
                    break;
                default:
                    backStat.classList.add('offline');
            }
        }
        if (backMs) {
            if (jsonData?.latency) backMs.classList.remove("unavailable");
            backMs.textContent = jsonData?.latency + " ms" || "Unavailable";
        }
        if (backUptime) {
            if (jsonData?.uptime) backUptime.classList.remove("unavailable");
            backUptime.textContent = jsonData?.uptime ? formatSecondsSimple(jsonData.uptime) : "Unavailable";
        }
        if (backCPUL) {
            if (jsonData?.platform?.cpuLoad) backCPUL.classList.remove("unavailable");
            backCPUL.innerHTML = `<code>${JSON.stringify(jsonData?.platform?.cpuLoad) || "Unavailable"}</code>`;
        }
        if (backFreeRAM) {
            if (jsonData?.platform?.freeMemory) backFreeRAM.classList.remove("unavailable");
            backFreeRAM.textContent = jsonData?.platform?.freeMemory || "Unavailable";
        }
        
        
        // Update database stats
        if (dbStat) {
            dbStat.textContent = jsonData.database.status || "Unavailable";
            dbStat.classList.remove("online");
            dbStat.classList.remove("offline");
            dbStat.classList.remove("unavailable");
            
            switch (jsonData?.database?.status?.toLowerCase()) {
                case 'connected':
                case 'online':
                    dbStat.classList.add('online');
                    break;
                case 'disconnected':
                case 'offline':
                    dbStat.classList.add('offline');
                    break;
                default:
                    dbStat.classList.add('unavailable');
            }
        }
        if (dbProv) {
            if (jsonData?.database?.provider) dbProv.classList.remove("unavailable");
            dbProv.textContent = jsonData?.database?.provider || "Unavailable";
        }
        if (dbPingLatency) {
            if (jsonData?.database?.latency_ms) dbPingLatency.classList.remove("unavailable");
            dbPingLatency.textContent = jsonData?.database?.latency_ms || "Unavailable";
        }
    } catch (e) {
        console.error(e);
    }
}

// Function to set up the interval ping
function startPinging(url, intervalMilliseconds) {
    console.log(`Starting to ping ${url} every ${intervalMilliseconds / 1000}s...`);
    
    (async () => {
        console.log("[DEBUG] Getting data...")
        const data = await getData(url, 10000);
        console.log("[DEBUG] data: ", data);
        await updateRemoteStatFromJSON(data);
    })();
    
    const intervalId = setInterval(async () => {
        // The anonymous function passed to setInterval can be async!
        const data = await getData(url, 10000);
        await updateRemoteStatFromJSON(data);
        
    }, intervalMilliseconds);
    
    // Return the intervalId so you can stop it later if needed
    return intervalId;
}


const targetUrl = "https://lyrxl.onrender.com/status";
const pingInterval = 30 * 1000;

startPinging(targetUrl, pingInterval);