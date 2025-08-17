import os from "os";

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

export default async function handler(req, res) {
  const memory = process.memoryUsage();
  res.json({
    status: "ok",
    uptime: formatUptime(process.uptime()),
    memory: {
      rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    },
    platform: {
      cpuLoad: os.loadavg(),
      freeMemory: `${(os.freemem() / 1024 / 1024).toFixed(2)} MB`,
    },
  });
}