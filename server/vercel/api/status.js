import os from "os";
import { createClient } from "@libsql/client";

function formatUptime(seconds) {
  function pad(s) {
    return (s < 10 ? "0" : "") + s;
  }
  const days = Math.floor(seconds / (24 * 3600));
  seconds %= 24 * 3600;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(secs)}s`;
}

// Create a Turso client only if env vars are present
let db = null;
if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
  try {
    db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      migrations: { loadMode: "none" },
    });
  } catch (e) {
    // Fail silently here — we'll report DB as unavailable below
    console.error("Failed to create Turso client:", e?.message ?? e);
    db = null;
  }
}

export default async function handler(req, res) {
  // Only allow GET (optional)
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  let dbStatus = "disconnected";
  let dbLatency = -1;
  
  if (db) {
    try {
      const start = Date.now();
      // simple quick ping
      await db.execute({ sql: "SELECT 1" });
      const end = Date.now();
      dbStatus = "connected";
      dbLatency = end - start;
    } catch (err) {
      console.error("Health check DB ping failed:", err?.message ?? err);
      dbStatus = "error";
      dbLatency = -1;
    }
  } else {
    dbStatus = "not_configured";
  }
  
  const memoryUsage = process.memoryUsage();
  
  const status = {
    status: "ok",
    uptime: formatUptime(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      provider: "Turso",
      latency_ms: dbLatency > -1 ? dbLatency : "N/A",
    },
    memory: {
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    },
    platform: {
      cpuLoad: os.loadavg(), // [1m, 5m, 15m]
      freeMemory: `${(os.freemem() / 1024 / 1024).toFixed(2)} MB`,
    },
    storage: {
      note: "Primary data storage is on Turso. Ephemeral disk space is managed by Vercel."
    }
  };
  
  // Helpful caching header for Vercel (optional) — adjust as you like
  res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  res.status(200).json(status);
}