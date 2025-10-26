import crypto from "crypto";
import os from "os";
import { createClient } from "@libsql/client";

// --- Custom Error ---
class NoProvidersAvailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NoProvidersAvailableError";
  }
}

// --- Database Setup (Turso) ---
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error("Turso database URL or auth token missing in environment variables.");
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  migrations: { loadMode: "none" },
});

// --- Helpers ---
const tryParse = (text) => {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed && parsed.rom && parsed.transl) return parsed;
    return null;
  } catch {
    return null;
  }
};

function generateHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// --- AI Providers ---
async function googleAI(combinedPrompt, apiKey, modelName) {
  if (!apiKey) throw new Error(`Google AI (${modelName}) key is missing`);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: combinedPrompt }] }] };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Google AI (${modelName}) error: ${response.status}`);
  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = tryParse(content);
  if (!parsed) throw new Error(`Google AI (${modelName}) parsing failed`);
  return parsed;
}

// --- Providers ---
const providersConfig = [
  { id: "google1_gemini2.0-flash", key: process.env.GOOGLE_API_KEY, model: "gemini-2.0-flash", fn: googleAI },
  { id: "google2_gemini2.0-flash", key: process.env.GOOGLE_API_KEY_2, model: "gemini-2.0-flash", fn: googleAI },
  { id: "google3_gemini2.0-flash", key: process.env.GOOGLE_API_KEY_3, model: "gemini-2.0-flash", fn: googleAI },
].filter((p) => p.key);

function getPrioritizedProviders() {
  return [...providersConfig];
}

// --- Main Handler ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  
  const { lrcText, geniusTr, title, artist } = req.body;
  if (!lrcText) return res.status(400).json({ error: "lrcText is required" });
  
  const lrcHash = generateHash(lrcText);
  
  try {
    const cacheResult = await db.execute({
      sql: "SELECT rom, transl FROM cache WHERE hash = ?",
      args: [lrcHash],
    });
    
    if (cacheResult.rows.length > 0) {
      const row = cacheResult.rows[0];
      return res.json({ rom: row.rom, transl: row.transl });
    }
  } catch (err) {
    console.error("DB error:", err);
  }
  
  const systemPrompt = `
You are an LRC romanizer and translator.
Return JSON { "rom": "...", "transl": "..." } only.
`;
  
  const userPrompt = `Song: ${title}\nArtist: ${artist}\nLyrics:\n${lrcText}`;
  const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
  
  const providers = getPrioritizedProviders();
  for (const provider of providers) {
    try {
      const result = await provider.fn(combinedPrompt, provider.key, provider.model);
      const finalResult = {
        rom: result.rom.replace(/\\n/g, "\n"),
        transl: result.transl.replace(/\\n/g, "\n"),
      };
      
      await db.execute({
        sql: "INSERT OR IGNORE INTO cache (hash, rom, transl) VALUES (?, ?, ?)",
        args: [lrcHash, finalResult.rom, finalResult.transl],
      });
      
      return res.json(finalResult);
    } catch (err) {
      console.error(`Provider ${provider.id} failed:`, err.message);
    }
  }
  
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  return res.status(503).json({ error: "All providers failed" });
}
