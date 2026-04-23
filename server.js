/**
 * Riftbound Guide Builder — Proxy Server
 * Uses api.riftcodex.com — free, no API key needed.
 *
 * SETUP:   npm install express node-fetch cors
 * RUN:     node server.js
 */

const express = require("express");
const cors = require("cors");

const PORT = 3001;
const RIFTCODEX = "https://api.riftcodex.com";

const app = express();
app.use(cors());

// Simple 1-hour cache
const cache = new Map();
function getCached(key) {
  const e = cache.get(key);
  if (!e || Date.now() - e.ts > 3600000) { cache.delete(key); return null; }
  return e.val;
}
function setCached(key, val) { cache.set(key, { val, ts: Date.now() }); }

let _fetch;
async function get(url) {
  if (!_fetch) _fetch = (await import("node-fetch")).default;
  const r = await _fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

// Parse a raw riftcodex card item into what the app needs
// Response shape:
// {
//   id, name, public_code,       e.g. "OGN-021/298"
//   collector_number,
//   set: { set_id, label },
//   classification: { type, supertype, rarity, domain[] },
//   attributes: { energy, might, power },
//   media: { image_url, artist, accessibility_text },
//   metadata: { clean_name, alternate_art, signature }
// }
function parseCard(raw) {
  return {
    id:         raw.id,
    name:       raw.name,
    cleanName:  raw.metadata?.clean_name || raw.name,
    publicCode: raw.public_code,                         // "OGN-021/298"
    setId:      raw.set?.set_id  || "",                  // "OGN"
    setLabel:   raw.set?.label   || "",
    type:       raw.classification?.type       || "",
    supertype:  raw.classification?.supertype  || null,
    rarity:     raw.classification?.rarity     || "",
    domain:     raw.classification?.domain     || [],
    energy:     raw.attributes?.energy  ?? null,
    might:      raw.attributes?.might   ?? null,
    power:      raw.attributes?.power   ?? null,
    imageUrl:   raw.media?.image_url    || null,         // absolute CDN URL — no proxy needed!
    artist:     raw.media?.artist       || "",
    altArt:     raw.metadata?.alternate_art || false,
    signature:  raw.metadata?.signature     || false,
  };
}

// GET /api/cards  — fetch all cards, paginating if needed
app.get("/api/cards", async (req, res) => {
  const cached = getCached("cards");
  if (cached) { console.log("[cache] cards"); return res.json(cached); }

  try {
    // First request — see how many total items exist
    const first = await get(`${RIFTCODEX}/cards?page=1&size=100`);

    // api.riftcodex.com returns { items: [...], total, page, size, pages }
    const { total = 0, pages = 1, items: firstItems = [] } = first;
    console.log(`[riftcodex] ${total} total cards across ${pages} pages`);

    let allItems = [...firstItems];

    // Fetch remaining pages in parallel
    if (pages > 1) {
      const pageNums = Array.from({ length: pages - 1 }, (_, i) => i + 2);
      const rest = await Promise.all(
        pageNums.map(p => get(`${RIFTCODEX}/cards?page=${p}&size=100`))
      );
      for (const r of rest) allItems = allItems.concat(r.items || []);
    }

    console.log(`[riftcodex] fetched ${allItems.length} cards total`);

    // Filter out alt-art/signature duplicates by default (keep cleanest version)
    const seen = new Map();
    for (const raw of allItems) {
      const key = raw.metadata?.clean_name?.toLowerCase() || raw.name?.toLowerCase();
      if (!key) continue;
      const existing = seen.get(key);
      // Prefer non-alt, non-signature, non-overnumbered cards
      if (!existing
        || (!raw.metadata?.alternate_art && existing.metadata?.alternate_art)
        || (!raw.metadata?.signature     && existing.metadata?.signature)
      ) {
        seen.set(key, raw);
      }
    }

    const cards = [...seen.values()].map(parseCard);
    console.log(`[parsed] ${cards.length} unique cards`);

    const result = { cards, total: cards.length };
    setCached("cards", result);
    res.json(result);
  } catch (err) {
    console.error("[error] /api/cards:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search?q=draven  — name search
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ cards: [] });
  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);
  try {
    const data = await get(`${RIFTCODEX}/cards/search?q=${encodeURIComponent(q)}`);
    const items = Array.isArray(data) ? data : data.items || [];
    const cards = items.map(parseCard);
    const result = { cards, total: cards.length };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/debug  — see raw response shape
app.get("/api/debug", async (req, res) => {
  try {
    const data = await get(`${RIFTCODEX}/cards?page=1&size=3`);
    res.json({
      topLevelKeys: Object.keys(data),
      total: data.total,
      pages: data.pages,
      sampleCardKeys: data.items?.[0] ? Object.keys(data.items[0]) : [],
      sampleCards: data.items?.slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/image", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing url");

    if (!_fetch) _fetch = (await import("node-fetch")).default;

    const r = await _fetch(url);
    if (!r.ok) return res.status(500).send("Failed to fetch image");

    const buffer = Buffer.from(await r.arrayBuffer());

    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");

    res.send(buffer);
  } catch (err) {
    console.error("[image proxy]", err);
    res.status(500).send("Image proxy error");
  }
});

app.listen(PORT, () => {
  console.log(`\n⚔️  Riftbound Proxy  →  http://localhost:${PORT}`);
  console.log(`   Cards:   http://localhost:${PORT}/api/cards`);
  console.log(`   Search:  http://localhost:${PORT}/api/search?q=draven`);
  console.log(`   Debug:   http://localhost:${PORT}/api/debug\n`);
});
