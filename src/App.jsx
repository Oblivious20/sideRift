import { useState, useEffect, useMemo, useRef } from "react";
import { toPng } from "html-to-image";

const PROXY_BASE = "http://localhost:3001";

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const MATCHUP_TYPES = ["Good Matchup", "Even Matchup", "Tough Matchup"];
const MATCHUP_COLOR = {
  "Good Matchup": "#6effa8",
  "Even Matchup": "#ffd97b",
  "Tough Matchup": "#ff7b7b",
};
const DOMAIN_COLORS = {
  Fury: { bg: "#3a0000", border: "#c0392b", text: "#ff8888" },
  Calm: { bg: "#003a10", border: "#27ae60", text: "#7affa8" },
  Mind: { bg: "#00103a", border: "#2980b9", text: "#7ab8ff" },
  Body: { bg: "#2a1800", border: "#e67e22", text: "#ffb060" },
  Chaos: { bg: "#1a003a", border: "#8e44ad", text: "#cc88ff" },
  Order: { bg: "#2a2a00", border: "#f1c40f", text: "#ffe060" },
  Colorless: { bg: "#1a1a1a", border: "#888", text: "#ccc" },
};

// ── THEME SYSTEM ──────────────────────────────────────────────────────────
const DOMAIN_RAW = {
  Fury: { r: 192, g: 57, b: 43, dark: { r: 58, g: 0, b: 0 } },
  Calm: { r: 39, g: 174, b: 96, dark: { r: 0, g: 58, b: 16 } },
  Mind: { r: 41, g: 128, b: 185, dark: { r: 0, g: 16, b: 58 } },
  Body: { r: 230, g: 126, b: 34, dark: { r: 42, g: 24, b: 0 } },
  Chaos: { r: 142, g: 68, b: 173, dark: { r: 26, g: 0, b: 58 } },
  Order: { r: 241, g: 196, b: 15, dark: { r: 42, g: 42, b: 0 } },
  Colorless: { r: 136, g: 136, b: 136, dark: { r: 26, g: 26, b: 26 } },
};

function deriveTheme(runes) {
  if (!runes || runes.length === 0) {
    return {
      primary: "#c0392b",
      secondary: "#8b0000",
      accent: "#ff8060",
      bg: "#070000",
      bgCard: "#0e0202",
      bgPanel: "rgba(14,3,3,0.88)",
      border: "rgba(192,57,43,0.28)",
      borderBright: "rgba(255,100,60,0.45)",
      glow: "rgba(180,30,0,0.12)",
      gradient: "linear-gradient(135deg,#8b0000,#c0392b)",
      topbar: "linear-gradient(90deg,#070000,#120303,#070000)",
      backgroundGradient: "linear-gradient(135deg,#070000,#120303,#070000)",
      scrollThumb: "#280000",
    };
  }

  const expandedDomains = runes.flatMap((r) => {
    const domain = r.name.replace(/\s*rune\s*/i, "").trim();
    return Array(Math.max(1, r.count)).fill(domain);
  });

  const uniqueDomains = [...new Set(expandedDomains)];
  const firstDomain = uniqueDomains[0] || "Colorless";
  const secondDomain = uniqueDomains[1] || firstDomain;

  const first = DOMAIN_RAW[firstDomain] || DOMAIN_RAW.Colorless;
  const second = DOMAIN_RAW[secondDomain] || DOMAIN_RAW.Colorless;

  const toHex = (r, g, b) =>
    `#${[r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")}`;

  const primary = toHex(first.r, first.g, first.b);
  const secondary = toHex(second.r, second.g, second.b);

  const dark1 = toHex(first.dark.r, first.dark.g, first.dark.b);
  const dark2 = toHex(second.dark.r, second.dark.g, second.dark.b);

  const accent = toHex(
    Math.min(255, (first.r + second.r) / 2 * 1.25),
    Math.min(255, (first.g + second.g) / 2 * 1.25),
    Math.min(255, (first.b + second.b) / 2 * 1.25)
  );

  const border = `rgba(${Math.round((first.r + second.r) / 2)},${Math.round((first.g + second.g) / 2)},${Math.round(
    (first.b + second.b) / 2
  )},0.28)`;

  const borderBright = `rgba(${Math.round((first.r + second.r) / 2)},${Math.round((first.g + second.g) / 2)},${Math.round(
    (first.b + second.b) / 2
  )},0.5)`;

  const glow = `rgba(${Math.round((first.r + second.r) / 2)},${Math.round((first.g + second.g) / 2)},${Math.round(
    (first.b + second.b) / 2
  )},0.13)`;

  return {
    primary,
    secondary,
    accent,
    bg: dark1,
    bgCard: dark2,
    bgPanel: `linear-gradient(145deg, rgba(${first.dark.r},${first.dark.g},${first.dark.b},0.9), rgba(${second.dark.r},${second.dark.g},${second.dark.b},0.9))`,
    border,
    borderBright,
    glow,
    gradient: `linear-gradient(135deg, ${primary}, ${secondary})`,
    topbar: `linear-gradient(90deg, ${dark1}, ${dark2}, ${dark1})`,
    backgroundGradient: `linear-gradient(135deg, ${dark1}, ${dark2})`,
    scrollThumb: primary,
  };
}

// ── DECKLIST PARSER ────────────────────────────────────────────────────────
function parseDecklist(text) {
  const result = { legend: [], champion: [], mainDeck: [], battlefields: [], runes: [], sideboard: [] };
  let section = null;

  const MAP = {
    legend: "legend",
    champion: "champion",
    maindeck: "mainDeck",
    "main deck": "mainDeck",
    main: "mainDeck",
    battlefields: "battlefields",
    battlefield: "battlefields",
    runes: "runes",
    rune: "runes",
    sideboard: "sideboard",
    side: "sideboard",
    sidedeck: "sideboard",
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const hdr = line.match(/^([A-Za-z\s]+):?\s*$/);
    if (hdr) {
      const k = hdr[1].trim().toLowerCase();
      if (MAP[k]) {
        section = MAP[k];
        continue;
      }
    }

    if (!section) continue;

    const m = line.match(/^(\d+)\s+(.+)$/);
    if (m) result[section].push({ count: parseInt(m[1], 10), name: m[2].trim() });
  }

  return result;
}

function expandCards(cards) {
  return cards.flatMap((c) => Array(c.count).fill(c.name));
}

// ── GLOBAL CARD STORE ──────────────────────────────────────────────────────
let cardMap = null; // Map<lookupKey, card[]>
let legendsArr = [];
let loadPromise = null;

function addCardKey(map, key, card) {
  if (!key) return;
  const k = key.toLowerCase().trim();
  if (!k) return;

  const arr = map.get(k) || [];
  if (!arr.some((c) => c.id === card.id)) arr.push(card);
  map.set(k, arr);
}

async function loadCards() {
  if (cardMap) return;
  if (loadPromise) return loadPromise;

  loadPromise = fetch(`${PROXY_BASE}/api/cards`)
    .then((r) => r.json())
    .then(({ cards = [] }) => {
      cardMap = new Map();

      for (const c of cards) {
        const keys = [
          c.cleanName,
          c.name,
          c.name?.split(",")[0]?.trim(),
          c.cleanName?.split(",")[0]?.trim(),
          c.name?.replace(/[^a-z0-9]/gi, ""),
          c.cleanName?.replace(/[^a-z0-9]/gi, ""),
          c.name?.split(",")[0]?.replace(/[^a-z0-9]/gi, ""),
          c.cleanName?.split(",")[0]?.replace(/[^a-z0-9]/gi, ""),
        ].filter(Boolean);

        for (const key of keys) addCardKey(cardMap, key, c);
      }

      legendsArr = cards
        .filter((c) => c.type === "Legend")
        .sort((a, b) => (a.cleanName || a.name).localeCompare(b.cleanName || b.name));

      console.log(`[cards] ${cards.length} total, ${legendsArr.length} legends`);
    })
    .catch((err) => {
      console.error("[loadCards]", err);
      cardMap = new Map();
    });

  return loadPromise;
}

function normalizeName(name) {
  return name?.trim().toLowerCase() || "";
}

function dedupeCards(cards) {
  return [...new Map(cards.map((c) => [c.id, c])).values()];
}

function lookupCard(name, wantedType = null) {
  if (!cardMap || !name) return null;

  const raw = normalizeName(name);
  const first = raw.split(",")[0].trim();
  const compact = raw.replace(/[^a-z0-9]/gi, "");
  const compactFirst = first.replace(/[^a-z0-9]/gi, "");

  let candidates = [];

  for (const key of [raw, first, compact, compactFirst]) {
    const arr = cardMap.get(key);
    if (arr?.length) candidates.push(...arr);
  }

  if (!candidates.length && first.length > 2) {
    for (const [k, arr] of cardMap.entries()) {
      if (k.startsWith(first) || k.startsWith(compactFirst)) candidates.push(...arr);
    }
  }

  candidates = dedupeCards(candidates);

  if (!candidates.length) return null;

  if (wantedType) {
    const exactType = candidates.find((c) => c.type === wantedType);
    if (exactType) return exactType;
  }

  return candidates[0] || null;
}

function useCardStore() {
  const [ready, setReady] = useState(!!cardMap);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cardMap) {
      setReady(true);
      return;
    }
    loadCards()
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  return { ready, error, cardCount: cardMap?.size || 0, legendCount: legendsArr.length };
}

// ── CARD UI PRIMITIVES ─────────────────────────────────────────────────────
function Thumb({
  name,
  wantedType = null,
  w = 38,
  h = 53,
  radius = 4,
  border = "1px solid rgba(255,120,60,0.3)",
}) {
  const [fail, setFail] = useState(false);
  const card = lookupCard(name, wantedType);

  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        overflow: "hidden",
        flexShrink: 0,
        border,
        background: "#120404",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {card?.imageUrl && !fail ? (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(card.imageUrl)}`}
          alt={name}
          onError={() => setFail(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.max(7, w * 0.28),
            color: "#ff6030",
            fontFamily: "'Cinzel',serif",
            fontWeight: 900,
          }}
        >
          {(name || "?").charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function FullCard({ name, wantedType = null, w = 120, h = 168 }) {
  const [fail, setFail] = useState(false);
  const card = lookupCard(name, wantedType);

  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 8,
        overflow: "hidden",
        border: "2px solid rgba(255,160,60,0.45)",
        background: "#120404",
        boxShadow: "0 8px 28px rgba(0,0,0,0.65)",
        flexShrink: 0,
      }}
    >
      {card?.imageUrl && !fail ? (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(card.imageUrl)}`}
          alt={name}
          onError={() => setFail(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.round(w * 0.25),
            color: "#ff6030",
            fontFamily: "'Cinzel',serif",
            fontWeight: 900,
          }}
        >
          {(name || "?").charAt(0)}
        </div>
      )}
    </div>
  );
}

function BfCard({ name, note }) {
  const [fail, setFail] = useState(false);
  const card = lookupCard(name);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        border: "1.5px solid rgba(255,160,60,0.3)",
        height: 84,
        width: 230,
        background: "#0a0505",
      }}
    >
      {card?.imageUrl && !fail && (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(card.imageUrl)}`}
          alt={name}
          onError={() => setFail(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            opacity: 0.75,
            transform: "scale(1.5)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg,rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.15) 65%,rgba(0,0,0,0.45) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "9px 13px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            color: "#fff",
            fontSize: 12,
            fontFamily: "'Cinzel',serif",
            textShadow: "0 1px 4px rgba(0,0,0,0.9)",
          }}
        >
          {name || "Battlefield"}
        </div>
        {note && (
          <div
            style={{
              fontSize: 9.5,
              color: "#d4b080",
              fontFamily: "'Cinzel',serif",
              textShadow: "0 1px 4px rgba(0,0,0,0.9)",
            }}
          >
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ name, count, isOut }) {
  const [fail, setFail] = useState(false);
  const card = lookupCard(name);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: isOut ? "rgba(220,60,60,0.14)" : "rgba(60,200,120,0.14)",
        border: `1px solid ${isOut ? "#c0392b40" : "#27ae6040"}`,
        borderRadius: 5,
        padding: "2px 7px 2px 3px",
        color: isOut ? "#ff8888" : "#7affa8",
        fontSize: 10.5,
        fontFamily: "'Cinzel',serif",
        whiteSpace: "nowrap",
      }}
    >
      {card?.imageUrl && !fail ? (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(card.imageUrl)}`}
          alt={name}
          onError={() => setFail(true)}
          style={{ width: 16, height: 22, objectFit: "cover", objectPosition: "top", borderRadius: 2, flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 2,
            background: "rgba(255,80,30,0.1)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 7,
            color: "#ff8060",
            fontWeight: 900,
          }}
        >
          {(name || "?").charAt(0)}
        </span>
      )}
      <span style={{ fontWeight: 700, fontSize: 9.5 }}>{count}×</span>
      {(name || "").split(",")[0]}
    </span>
  );
}

function RunePip({ domain }) {
  const c = DOMAIN_COLORS[domain] || DOMAIN_COLORS.Colorless;
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        boxShadow: `0 0 5px ${c.border}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.border, opacity: 0.95 }} />
    </div>
  );
}

function RuneRow({ name, count }) {
  const domain = name.replace(/\s*rune\s*/i, "").trim();
  const c = DOMAIN_COLORS[domain] || DOMAIN_COLORS.Colorless;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {Array(Math.min(count, 12))
          .fill(0)
          .map((_, i) => (
            <RunePip key={i} domain={domain} />
          ))}
      </div>
      <span style={{ fontSize: 10.5, color: c.text, fontFamily: "'Cinzel',serif", fontWeight: 700 }}>
        {count}× {name}
      </span>
    </div>
  );
}

// ── LEGEND DROPDOWN ────────────────────────────────────────────────────────
function LegendDropdown({ value, onChange, placeholder = "Select legend..." }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [local, setLocal] = useState(legendsArr);
  const ref = useRef(null);

  useEffect(() => {
    if (legendsArr.length) {
      setLocal(legendsArr);
      return;
    }
    const t = setInterval(() => {
      if (legendsArr.length) {
        setLocal([...legendsArr]);
        clearInterval(t);
      }
    }, 400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = search
    ? local.filter((l) => (l.cleanName || l.name).toLowerCase().includes(search.toLowerCase()))
    : local;

  const selected = local.find((l) => l.id === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          background: "rgba(255,255,255,0.045)",
          border: `1px solid ${open ? "rgba(255,120,60,0.55)" : "rgba(255,255,255,0.09)"}`,
          borderRadius: 7,
          padding: "6px 10px",
          userSelect: "none",
          transition: "border-color 0.15s",
        }}
      >
        {selected ? (
          <>
            <div
              style={{
                width: 28,
                height: 39,
                borderRadius: 3,
                overflow: "hidden",
                flexShrink: 0,
                border: "1px solid rgba(255,120,60,0.35)",
              }}
            >
              {selected.imageUrl ? (
                <img
                  src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(selected.imageUrl)}`}
                  alt={selected.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "#1a0808",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "#ff6030",
                    fontWeight: 900,
                  }}
                >
                  {selected.name.charAt(0)}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#fff",
                  fontFamily: "'Cinzel',serif",
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {(selected.cleanName || selected.name).split(",")[0]}
              </div>
              <div style={{ fontSize: 9, color: "#888", fontFamily: "'Cinzel',serif", marginTop: 1 }}>
                {selected.domain?.join(" / ") || ""}
              </div>
            </div>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 12, color: "#444", fontFamily: "'Cinzel',serif" }}>{placeholder}</span>
        )}
        <span style={{ color: "#555", fontSize: 9, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "#0d0202",
            border: "1px solid rgba(255,120,60,0.28)",
            borderRadius: 8,
            boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
            maxHeight: 320,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search legends..."
              autoFocus
              onClick={(e) => e.stopPropagation()}
              style={{ ...IS, padding: "5px 9px", fontSize: 11 }}
            />
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            <div
              onClick={() => {
                onChange(null);
                setOpen(false);
                setSearch("");
              }}
              style={{
                padding: "7px 12px",
                cursor: "pointer",
                fontSize: 11,
                color: "#555",
                fontFamily: "'Cinzel',serif",
                fontStyle: "italic",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: "rgba(255,255,255,0.015)",
              }}
            >
              — No legend —
            </div>

            {filtered.length === 0 && (
              <div
                style={{
                  padding: "14px",
                  textAlign: "center",
                  fontSize: 11,
                  color: "#444",
                  fontFamily: "'Cinzel',serif",
                }}
              >
                No legends found
              </div>
            )}

            {filtered.map((leg) => {
              const isSel = selected?.id === leg.id;
              return (
                <div
                  key={leg.id}
                  onClick={() => {
                    onChange(leg.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 12px",
                    cursor: "pointer",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    background: isSel ? "rgba(255,80,30,0.11)" : "transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.048)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSel ? "rgba(255,80,30,0.11)" : "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 45,
                      borderRadius: 3,
                      overflow: "hidden",
                      flexShrink: 0,
                      border: "1px solid rgba(255,120,60,0.22)",
                      background: "#1a0808",
                    }}
                  >
                    {leg.imageUrl ? (
                      <img
                        src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(leg.imageUrl)}`}
                        alt={leg.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          color: "#ff6030",
                          fontWeight: 900,
                          fontFamily: "'Cinzel',serif",
                        }}
                      >
                        {leg.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#fff",
                        fontFamily: "'Cinzel',serif",
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {(leg.cleanName || leg.name).split(",")[0]}
                    </div>
                    {leg.name.includes(",") && (
                      <div style={{ fontSize: 8.5, color: "#666", fontFamily: "'Cinzel',serif" }}>
                        {leg.name.split(",").slice(1).join(",").trim()}
                      </div>
                    )}
                    <div style={{ fontSize: 8.5, color: "#888", fontFamily: "'Cinzel',serif", marginTop: 1 }}>
                      {leg.domain?.join(" · ") || ""}
                      {leg.rarity && <span style={{ marginLeft: 6, opacity: 0.6 }}>{leg.rarity}</span>}
                    </div>
                  </div>

                  {isSel && <span style={{ color: "#ff9060", fontSize: 13, flexShrink: 0 }}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CARD SELECTOR ──────────────────────────────────────────────────────────
function CardSelector({ cards, label, selected, onChange, theme }) {
  const counts = {};
  cards.forEach((c) => {
    counts[c] = (counts[c] || 0) + 1;
  });
  const unique = [...new Set(cards)];
  const isOut = label === "OUT";
  const activeCol = isOut ? "#ff8888" : "#7affa8";
  const activeBg = isOut ? "rgba(220,60,60,0.09)" : "rgba(60,200,120,0.09)";
  const activeBord = isOut ? "#c0392b40" : "#27ae6040";

  const toggle = (card, dir) => {
    const ex = selected.find((s) => s.name === card);
    const max = counts[card] || 3;
    if (dir === "up") {
      if (!ex) onChange([...selected, { name: card, count: 1 }]);
      else if (ex.count < max) onChange(selected.map((s) => (s.name === card ? { ...s, count: s.count + 1 } : s)));
    } else {
      if (!ex) return;
      if (ex.count <= 1) onChange(selected.filter((s) => s.name !== card));
      else onChange(selected.map((s) => (s.name === card ? { ...s, count: s.count - 1 } : s)));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div
          style={{
            fontSize: 9.5,
            color: activeCol,
            fontFamily: "'Cinzel',serif",
            textTransform: "uppercase",
            letterSpacing: 2,
            fontWeight: 700,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 8.5, color: "#555", fontFamily: "'Cinzel',serif" }}>
          {selected.reduce((s, c) => s + c.count, 0)} / {cards.length} selected
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {unique.map((card) => {
          const sel = selected.find((s) => s.name === card);
          const selCount = sel ? sel.count : 0;
          const deckCount = counts[card];
          const pct = deckCount > 0 ? selCount / deckCount : 0;

          return (
            <div
              key={card}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                position: "relative",
                overflow: "hidden",
                background: selCount > 0 ? activeBg : "rgba(255,255,255,0.022)",
                border: `1px solid ${selCount > 0 ? activeBord : "rgba(255,255,255,0.055)"}`,
                borderRadius: 7,
                padding: "4px 8px",
              }}
            >
              {selCount > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${pct * 100}%`,
                    background: isOut ? "rgba(220,60,60,0.06)" : "rgba(60,200,120,0.06)",
                    transition: "width 0.2s",
                    pointerEvents: "none",
                  }}
                />
              )}

              <Thumb name={card} w={26} h={36} />
              <span
                style={{
                  flex: 1,
                  fontFamily: "'Cinzel',serif",
                  fontSize: 10,
                  color: selCount > 0 ? "#fff" : "#666",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  position: "relative",
                }}
              >
                {card.split(",")[0]}
              </span>

              <span
                style={{
                  fontSize: 9,
                  color: "#888",
                  fontFamily: "'Cinzel',serif",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  flexShrink: 0,
                  position: "relative",
                }}
                title={`${deckCount} in deck`}
              >
                {deckCount} in deck
              </span>

              {selCount > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: activeCol,
                    fontWeight: 700,
                    minWidth: 18,
                    textAlign: "center",
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  {selCount}×
                </span>
              )}

              <div style={{ display: "flex", gap: 2, position: "relative" }}>
                <button onClick={() => toggle(card, "down")} style={{ ...MINIBTN, color: "#ff7b7b" }}>
                  −
                </button>
                <button
                  onClick={() => toggle(card, "up")}
                  style={{
                    ...MINIBTN,
                    color: "#6effa8",
                    opacity: selCount >= deckCount ? 0.3 : 1,
                    cursor: selCount >= deckCount ? "not-allowed" : "pointer",
                  }}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}

        {unique.length === 0 && (
          <div style={{ fontSize: 10, color: "#444", fontStyle: "italic", padding: "4px 0", fontFamily: "'Cinzel',serif" }}>
            No cards in this section
          </div>
        )}
      </div>
    </div>
  );
}

const MINIBTN = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  cursor: "pointer",
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  fontWeight: 700,
};

// ── MATCHUP EDITOR ─────────────────────────────────────────────────────────
function MatchupEditor({ mainDeck, sideboard, onSave, onCancel, initial, theme }) {
  const [deckName, setDeckName] = useState(initial?.deckName || "");
  const [legendId, setLegendId] = useState(initial?.legendId || null);
  const [type, setType] = useState(initial?.type || "Even Matchup");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [out, setOut] = useState(initial?.out || []);
  const [ins, setIns] = useState(initial?.in || []);

  const T = theme || {};
  const selLeg = legendsArr.find((l) => l.id === legendId);

  return (
    <div
      style={{
        background: T.bgPanel || "rgba(15,3,3,0.97)",
        border: `1px solid ${T.borderBright || "rgba(255,120,60,0.28)"}`,
        borderRadius: 12,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={LS}>Deck Name</label>
            <input
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="e.g. Classic Kai'Sa"
              style={{ ...IS, borderColor: T.border || "rgba(255,255,255,0.09)" }}
            />
          </div>
          <div>
            <label style={LS}>Opponent Legend</label>
            <LegendDropdown value={legendId} onChange={setLegendId} placeholder="Select opponent legend..." />
          </div>
          <div>
            <label style={LS}>Matchup Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ ...IS, borderColor: T.border || "rgba(255,255,255,0.09)" }}
            >
              {MATCHUP_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LS}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Key notes about this matchup..."
              style={{
                ...IS,
                resize: "vertical",
                fontFamily: "'Crimson Text',serif",
                lineHeight: 1.65,
                fontSize: 11,
                borderColor: T.border || "rgba(255,255,255,0.09)",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "rgba(0,0,0,0.22)",
            borderRadius: 8,
            border: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
            padding: 12,
          }}
        >
          {selLeg ? (
            <>
              <FullCard name={selLeg.name} wantedType="Legend" w={110} h={154} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#fff", fontFamily: "'Cinzel',serif", fontWeight: 700 }}>
                  {(selLeg.cleanName || selLeg.name).split(",")[0]}
                </div>
                {selLeg.name.includes(",") && (
                  <div style={{ fontSize: 8.5, color: "#888", fontFamily: "'Cinzel',serif", marginTop: 1 }}>
                    {selLeg.name.split(",").slice(1).join(",").trim()}
                  </div>
                )}
                <div style={{ fontSize: 8.5, color: T.accent || "#666", fontFamily: "'Cinzel',serif", marginTop: 2 }}>
                  {selLeg.domain?.join(" · ") || ""}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: "#2a2a2a" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🃏</div>
              <div style={{ fontSize: 10, fontFamily: "'Cinzel',serif", lineHeight: 1.5 }}>
                Select a legend to preview
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14, maxHeight: 400, overflowY: "auto" }}>
        <div>
          <div
            style={{
              fontSize: 8.5,
              color: "#666",
              marginBottom: 5,
              fontFamily: "'Cinzel',serif",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Take OUT (from Main Deck)
          </div>
          <CardSelector cards={expandCards(mainDeck)} label="OUT" selected={out} onChange={setOut} theme={T} />
        </div>
        <div>
          <div
            style={{
              fontSize: 8.5,
              color: "#666",
              marginBottom: 5,
              fontFamily: "'Cinzel',serif",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Bring IN (from Sideboard)
          </div>
          <CardSelector cards={expandCards(sideboard)} label="IN" selected={ins} onChange={setIns} theme={T} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{ ...BS, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave({ deckName, legendId, type, notes, out, in: ins })}
          style={{
            ...BS,
            background: T.gradient || "linear-gradient(135deg,#8b0000,#c0392b)",
            border: `1px solid ${T.borderBright || "#e74c3c55"}`,
          }}
        >
          Save Matchup
        </button>
      </div>
    </div>
  );
}

// ── MATCHUP ROW ────────────────────────────────────────────────────────────
function MatchupRow({ m, idx, onEdit, onDelete, theme }) {
  const [fail, setFail] = useState(false);
  const T = theme || {};
  const leg = legendsArr.find((l) => l.id === m.legendId);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr 1fr",
        borderBottom: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
        background: idx % 2 === 0 ? `${T.glow || "rgba(255,255,255,0.012)"}` : "transparent",
      }}
    >
      <div style={{ padding: "9px 11px", display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 33,
            height: 46,
            borderRadius: 4,
            overflow: "hidden",
            flexShrink: 0,
            border: `1px solid ${MATCHUP_COLOR[m.type]}44`,
            background: "#1a0808",
          }}
        >
          {leg?.imageUrl && !fail ? (
            <img
              src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(leg.imageUrl)}`}
              alt=""
              onError={() => setFail(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                color: MATCHUP_COLOR[m.type],
                fontWeight: 900,
                fontFamily: "'Cinzel',serif",
              }}
            >
              {(m.deckName || "?").charAt(0)}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              color: "#fff",
              fontFamily: "'Cinzel',serif",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {m.deckName || "Opponent"}
          </div>
          {leg && (
            <div style={{ fontSize: 8.5, color: "#999", fontFamily: "'Cinzel',serif", marginTop: 1 }}>
              {(leg.cleanName || leg.name).split(",")[0]}
            </div>
          )}
          <div style={{ fontSize: 9, color: MATCHUP_COLOR[m.type], marginTop: 1 }}>{m.type}</div>
        </div>
      </div>

      <div style={{ padding: "9px 8px", display: "flex", flexWrap: "wrap", gap: 3, alignContent: "flex-start" }}>
        {m.out?.map((c, i) => (
          <Badge key={i} name={c.name} count={c.count} isOut />
        ))}
      </div>

      <div
        style={{
          padding: "9px 8px",
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignContent: "flex-start",
          borderLeft: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
        }}
      >
        {m.in?.map((c, i) => (
          <Badge key={i} name={c.name} count={c.count} isOut={false} />
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3, alignSelf: "flex-start" }}>
          <button
            onClick={() => onEdit(idx)}
            style={{
              background: "rgba(52,152,219,0.14)",
              border: "1px solid #3498db33",
              borderRadius: 4,
              cursor: "pointer",
              padding: "2px 6px",
              fontSize: 10,
              color: "#7ac",
            }}
          >
            ✏️
          </button>
          <button
            onClick={() => onDelete(idx)}
            style={{
              background: "rgba(231,76,60,0.14)",
              border: "1px solid #e74c3c33",
              borderRadius: 4,
              cursor: "pointer",
              padding: "2px 6px",
              fontSize: 10,
              color: "#e88",
            }}
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}

// ── GUIDE PREVIEW ──────────────────────────────────────────────────────────
function PreviewMatchupRow({ m, idx, theme }) {
  const [fail, setFail] = useState(false);
  const T = theme || {};
  const leg = legendsArr.find((l) => l.id === m.legendId);
  const rowBg = idx % 2 === 0 ? `rgba(255,255,255,0.012)` : "transparent";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "210px 1fr 1fr",
        borderBottom: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
        background: rowBg,
        minHeight: 60,
      }}
    >
      <div style={{ padding: "8px 11px", display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 34,
            height: 48,
            borderRadius: 4,
            overflow: "hidden",
            flexShrink: 0,
            border: `1px solid ${MATCHUP_COLOR[m.type]}44`,
            background: "#1a0808",
          }}
        >
          {leg?.imageUrl && !fail ? (
            <img
              src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(leg.imageUrl)}`}
              alt=""
              onError={() => setFail(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                color: MATCHUP_COLOR[m.type],
                fontWeight: 900,
                fontFamily: "'Cinzel',serif",
              }}
            >
              {(m.deckName || "?").charAt(0)}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "#fff",
              fontFamily: "'Cinzel',serif",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {m.deckName || "Opponent"}
          </div>
          {leg && (
            <div style={{ fontSize: 8, color: "#aaa", fontFamily: "'Cinzel',serif", marginTop: 1 }}>
              {(leg.cleanName || leg.name).split(",")[0]}
            </div>
          )}
          <div style={{ fontSize: 9, color: MATCHUP_COLOR[m.type], marginTop: 1 }}>{m.type}</div>
          {m.notes && (
            <div style={{ fontSize: 8, color: "#888", fontFamily: "'Crimson Text',serif", marginTop: 2, lineHeight: 1.4 }}>
              {m.notes}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "7px 8px", display: "flex", flexWrap: "wrap", gap: 3, alignContent: "flex-start" }}>
        {m.out?.map((c, i) => (
          <Badge key={i} name={c.name} count={c.count} isOut />
        ))}
      </div>

      <div
        style={{
          padding: "7px 8px",
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignContent: "flex-start",
          borderLeft: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
        }}
      >
        {m.in?.map((c, i) => (
          <Badge key={i} name={c.name} count={c.count} isOut={false} />
        ))}
      </div>
    </div>
  );
}

function GuidePreview({ deckName, author, matchups, parsed, theme }) {
  const { legend, champion, battlefields, runes } = parsed;
  const T = theme || {};
  const legCard = legend[0];
  const cmpCard = champion[0];
  const bgCard = legCard ? lookupCard(legCard.name, "Legend") : null;

  return (
    <div
      style={{
        width: 940,
        minHeight: 580,
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Cinzel',serif",
        border: `1.5px solid ${T.borderBright || "rgba(255,80,30,0.18)"}`,
        borderRadius: 4,
      }}
    >
      {bgCard?.imageUrl && (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(bgCard.imageUrl)}`}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
            opacity: 0.16,
            filter: "blur(2px) saturate(1.5)",
            transform: "scale(1.06)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(155deg,${T.bg || "rgba(7,0,0,0.91)"} 0%,rgba(8,4,4,0.86) 50%,rgba(4,4,4,0.93) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -90,
          left: -90,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: `radial-gradient(circle,${T.glow || "rgba(160,25,0,0.11)"},transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: `radial-gradient(circle,${T.glow || "rgba(160,25,0,0.07)"},transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", padding: "15px 26px 5px" }}>
          {runes.length > 0 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 6 }}>
              {runes.map((r) => {
                const dom = r.name.replace(/\s*rune\s*/i, "").trim();
                const c = DOMAIN_COLORS[dom] || DOMAIN_COLORS.Colorless;
                return Array(Math.min(r.count, 12))
                  .fill(0)
                  .map((_, i) => (
                    <div
                      key={`${r.name}-${i}`}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: c.border,
                        boxShadow: `0 0 4px ${c.border}99`,
                        opacity: 0.8,
                      }}
                    />
                  ));
              })}
            </div>
          )}
          <h1
            style={{
              margin: "0 0 2px",
              fontSize: 27,
              fontWeight: 900,
              color: "#fff",
              letterSpacing: 2,
              textShadow: `0 0 28px ${T.glow || "rgba(255,100,50,0.38)"}`,
            }}
          >
            {deckName || "Deck Name"}
          </h1>
          <h2 style={{ margin: 0, fontSize: 11, fontWeight: 400, color: T.accent || "#b09070", letterSpacing: 4, opacity: 0.7 }}>
            Quick Guide
          </h2>
        </div>

        <div
          style={{
            height: 1,
            background: `linear-gradient(90deg,transparent,${T.primary || "rgba(255,100,50,0.28)"},transparent)`,
            margin: "7px 22px",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 252px" }}>
          <div style={{ borderRight: `1px solid ${T.border || "rgba(255,255,255,0.05)"}` }}>
            <div style={{ padding: "7px 13px 3px" }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, color: "#fff", letterSpacing: 1 }}>Sideboarding</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "210px 1fr 1fr",
                borderBottom: `1px solid ${T.borderBright || "rgba(255,80,30,0.18)"}`,
                background: T.glow,
              }}
            >
              <div />
              <div style={{ padding: "3px 8px", fontSize: 8.5, color: "#666", letterSpacing: 2 }}>OUT</div>
              <div
                style={{
                  padding: "3px 8px",
                  fontSize: 8.5,
                  color: "#6effa8",
                  letterSpacing: 2,
                  borderLeft: `1px solid ${T.border || "rgba(255,255,255,0.05)"}`,
                }}
              >
                IN
              </div>
            </div>

            {matchups.length === 0 ? (
              <div style={{ padding: 16, color: "#2a2a2a", fontSize: 10, fontStyle: "italic" }}>No matchups added.</div>
            ) : (
              matchups.map((m, i) => <PreviewMatchupRow key={i} m={m} idx={i} theme={T} />)
            )}
          </div>

          <div style={{ padding: "8px 11px", display: "flex", flexDirection: "column", gap: 10 }}>
            {(legCard || cmpCard) && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {legCard && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ fontSize: 7, color: T.accent || "#d4c090", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
                      Legend
                    </div>
                    <FullCard name={legCard.name} wantedType="Legend" w={100} h={140} />
                    <div style={{ fontSize: 8, color: "#fff", fontWeight: 700, textAlign: "center", maxWidth: 100 }}>
                      {legCard.name.split(",")[0]}
                    </div>
                  </div>
                )}

                {cmpCard && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ fontSize: 7, color: "#b0b0d4", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
                      Champion
                    </div>
                    <FullCard name={cmpCard.name} wantedType="Champion" w={100} h={140} />
                    <div style={{ fontSize: 8, color: "#fff", fontWeight: 700, textAlign: "center", maxWidth: 100 }}>
                      {cmpCard.name.split(",")[0]}
                    </div>
                  </div>
                )}
              </div>
            )}

            {battlefields.length > 0 && (
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 900, color: T.accent || "#fff", letterSpacing: 1, marginBottom: 4 }}>
                  Battlefields
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {battlefields.map((b, i) => (
                    <BfCard key={i} name={b.name} note={b.note} />
                  ))}
                </div>
              </div>
            )}

            {runes.length > 0 && (
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 900, color: T.accent || "#fff", letterSpacing: 1, marginBottom: 4 }}>
                  Runes
                </div>
                {runes.map((r, i) => (
                  <RuneRow key={i} name={r.name} count={r.count} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${T.border || "rgba(255,80,30,0.1)"}`,
            padding: "7px 22px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: T.glow,
          }}
        >
          {author && <div style={{ fontSize: 8, color: T.accent || "#555", opacity: 0.7 }}>{author}</div>}
        </div>
      </div>
    </div>
  );
}

// ── DECK PREVIEW ───────────────────────────────────────────────────────────
function DeckPreview({ parsed, theme }) {
  const { legend, champion, mainDeck, battlefields, runes, sideboard } = parsed;
  const T = theme || {};
  const ac = T.accent || "#c4a870";
  const SL = {
    fontSize: 9,
    marginBottom: 6,
    fontFamily: "'Cinzel',serif",
    textTransform: "uppercase",
    letterSpacing: 2,
    fontWeight: 700,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {legend.length > 0 && (
        <div>
          <div style={{ ...SL, color: ac }}>Legend</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {legend.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <Thumb name={c.name} wantedType="Legend" w={54} h={76} border={`1px solid ${T.borderBright || "rgba(255,120,60,0.3)"}`} />
                <div
                  style={{
                    fontSize: 7.5,
                    color: "#888",
                    fontFamily: "'Cinzel',serif",
                    textAlign: "center",
                    maxWidth: 64,
                    lineHeight: 1.2,
                  }}
                >
                  {c.name.split(",")[0].slice(0, 12)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {champion.length > 0 && (
        <div>
          <div style={{ ...SL, color: "#b0b0d4" }}>Champion</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {champion.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <Thumb
                  name={c.name}
                  wantedType="Champion"
                  w={54}
                  h={76}
                  border={`1px solid ${T.borderBright || "rgba(255,120,60,0.3)"}`}
                />
                <div
                  style={{
                    fontSize: 7.5,
                    color: "#888",
                    fontFamily: "'Cinzel',serif",
                    textAlign: "center",
                    maxWidth: 64,
                    lineHeight: 1.2,
                  }}
                >
                  {c.name.split(",")[0].slice(0, 12)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mainDeck.length > 0 && (
        <div>
          <div style={{ ...SL, color: "#aaa" }}>Main Deck ({mainDeck.reduce((s, c) => s + c.count, 0)} cards)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mainDeck.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Thumb name={c.name} w={40} h={56} border={`1px solid ${T.border || "rgba(255,120,60,0.2)"}`} />
                <div
                  style={{
                    fontSize: 7,
                    color: "#666",
                    fontFamily: "'Cinzel',serif",
                    textAlign: "center",
                    maxWidth: 50,
                    lineHeight: 1.2,
                  }}
                >
                  {c.name.split(",")[0].slice(0, 10)}
                </div>
                <div style={{ fontSize: 8, color: ac, fontFamily: "'Cinzel',serif", fontWeight: 700 }}>×{c.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {battlefields.length > 0 && (
        <div>
          <div style={{ ...SL, color: "#c08040" }}>Battlefields</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {battlefields.map((b, i) => (
              <BfCard key={i} name={b.name} note={b.note} />
            ))}
          </div>
        </div>
      )}

      {runes.length > 0 && (
        <div>
          <div style={{ ...SL, color: ac }}>Runes</div>
          {runes.map((r, i) => (
            <RuneRow key={i} name={r.name} count={r.count} />
          ))}
        </div>
      )}

      {sideboard.length > 0 && (
        <div>
          <div style={{ ...SL, color: "#6effa8" }}>Sideboard ({sideboard.reduce((s, c) => s + c.count, 0)} cards)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sideboard.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Thumb name={c.name} w={40} h={56} border={`1px solid ${T.border || "rgba(100,255,160,0.2)"}`} />
                <div
                  style={{
                    fontSize: 7,
                    color: "#666",
                    fontFamily: "'Cinzel',serif",
                    textAlign: "center",
                    maxWidth: 50,
                    lineHeight: 1.2,
                  }}
                >
                  {c.name.split(",")[0].slice(0, 10)}
                </div>
                <div style={{ fontSize: 8, color: "#6effa8", fontFamily: "'Cinzel',serif", fontWeight: 700 }}>×{c.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SHARED STYLES ──────────────────────────────────────────────────────────
const LS = {
  display: "block",
  fontSize: 9,
  color: "#888",
  marginBottom: 4,
  fontFamily: "'Cinzel',serif",
  textTransform: "uppercase",
  letterSpacing: 1.5,
};
const IS = {
  width: "100%",
  background: "rgba(255,255,255,0.045)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 7,
  padding: "7px 11px",
  color: "#fff",
  fontSize: 12,
  fontFamily: "'Cinzel',serif",
  outline: "none",
  boxSizing: "border-box",
};
const BS = {
  padding: "7px 16px",
  borderRadius: 7,
  cursor: "pointer",
  color: "#fff",
  fontSize: 11,
  fontFamily: "'Cinzel',serif",
  fontWeight: 700,
  border: "none",
};

function Box({ title, children, theme }) {
  const T = theme || {};
  return (
    <div
      style={{
        background: T.bgPanel || "rgba(13,2,2,0.88)",
        border: `1px solid ${T.border || "rgba(255,80,30,0.1)"}`,
        borderRadius: 11,
        padding: 14,
      }}
    >
      {title && (
        <h3
          style={{
            margin: "0 0 11px",
            fontSize: 8.5,
            fontWeight: 900,
            color: T.accent || "#c4a870",
            letterSpacing: 2.5,
            textTransform: "uppercase",
          }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

// ── SAMPLE ─────────────────────────────────────────────────────────────────
const SAMPLE = `Legend:
1 Irelia, Blade Dancer
Champion:
1 Irelia, Fervent
MainDeck:
1 Irelia, Fervent
3 Defy
2 Charm
3 En Garde
3 Defiant Dance
3 Lonely Poro
3 Tideturner
1 The Syren
3 Guardian Angel
1 Zhonya's Hourglass
3 Discipline
2 Flash
2 Ride the Wind
1 Hard Bargain
2 Not So Fast
2 Desert's Call
2 Boots of Swiftness
3 Stellacorn Herder
Battlefields:
1 Targon's Peak
1 Sunken Temple
1 Treasure Hoard
Runes:
6 Chaos Rune
6 Calm Rune
Sideboard:
2 Adaptatron
2 Vex, Cheerless
1 Rebuke
1 Hard Bargain
1 Zhonya's Hourglass
1 Charm`;

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const { ready, error, cardCount, legendCount } = useCardStore();
  const [tab, setTab] = useState("build");
  const [deckName, setDeckName] = useState("Kuvi's Irelia");
  const [author, setAuthor] = useState("Kuvi");
  const [deckText, setDeckText] = useState(SAMPLE);
  const [matchups, setMatchups] = useState([]);
  const [editing, setEditing] = useState(null);
  const [panel, setPanel] = useState("deck");
  const previewRef = useRef(null);

  const parsed = useMemo(() => parseDecklist(deckText), [deckText]);
  const theme = useMemo(() => deriveTheme(parsed.runes), [parsed.runes]);
  const legendCard = parsed.legend[0];
  const bgLegend = legendCard ? lookupCard(legendCard.name, "Legend") : null;

  const saveMatchup = (d) => {
    if (editing === "new") setMatchups((m) => [...m, d]);
    else setMatchups((m) => m.map((x, i) => (i === editing ? d : x)));
    setEditing(null);
  };

  const savePreviewAsPng = async () => {
    if (!previewRef.current) return;

    try {
      const dataUrl = await toPng(previewRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#0a0a0a",
      });

      const link = document.createElement("a");
      link.download = `${(deckName || "riftbound-guide").replace(/[^a-z0-9-_]/gi, "_").toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to save PNG:", err);
      alert("Could not save PNG.");
    }
  };

  const statusColor = error ? "#ff8888" : !ready ? "#ffd97b" : "#6effa8";
  const statusBg = error ? "rgba(220,60,60,0.15)" : !ready ? "rgba(255,200,80,0.1)" : "rgba(60,200,120,0.1)";
  const statusText = error ? "⚠ run: node server.js" : !ready ? "⏳ Loading cards..." : `✓ ${cardCount} keys · ${legendCount} legends`;

  return (
    <div style={{ minHeight:"100vh",  position: "relative", overflow: "hidden", background: theme.backgroundGradient || theme.bg, color:"#fff", fontFamily:"'Cinzel',serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        *{box-sizing:border-box}
        input,select,textarea{color:#fff!important}
        input::placeholder,textarea::placeholder{color:#333!important}
        select option{background:#140303;color:#fff}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${theme.bg}}
        ::-webkit-scrollbar-thumb{background:${theme.scrollThumb};border-radius:3px}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {bgLegend?.imageUrl && (
        <img
          src={`${PROXY_BASE}/api/image?url=${encodeURIComponent(bgLegend.imageUrl)}`}
          alt=""
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
            opacity: 0.08,
            filter: "blur(4px) saturate(1.3)",
            transform: "scale(1.1)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}

      <div
        style={{
          background: theme.topbar,
          borderBottom: `1px solid ${theme.border}`,
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: 3, color: "#d4c090" }}>⚔️ RIFTBOUND GUIDE BUILDER</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {parsed.runes.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {parsed.runes.map((r) => {
                const domain = r.name.replace(/\s*rune\s*/i, "").trim();
                const c = DOMAIN_COLORS[domain] || DOMAIN_COLORS.Colorless;
                return (
                  <div
                    key={r.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      background: `${c.bg}cc`,
                      border: `1px solid ${c.border}55`,
                      borderRadius: 12,
                      padding: "2px 7px",
                    }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.border, boxShadow: `0 0 4px ${c.border}` }} />
                    <span style={{ fontSize: 8.5, color: c.text, fontFamily: "'Cinzel',serif" }}>
                      {r.count} {domain}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <span
            style={{
              fontSize: 9,
              letterSpacing: 1,
              padding: "3px 10px",
              borderRadius: 20,
              background: statusBg,
              border: `1px solid ${statusColor}44`,
              color: statusColor,
            }}
          >
            {statusText}
          </span>

          <div style={{ display: "flex", gap: 6 }}>
            {["build", "preview"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  ...BS,
                  background: tab === t ? theme.gradient : "rgba(255,255,255,0.04)",
                  border: `1px solid ${tab === t ? theme.borderBright : "rgba(255,255,255,0.08)"}`,
                  textTransform: "capitalize",
                  letterSpacing: 1,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: `${theme.glow}`,
            borderBottom: `1px solid ${theme.border}`,
            padding: "7px 24px",
            fontSize: 11,
            color: "#ffb080",
            fontFamily: "'Courier New',monospace",
          }}
        >
          Start the proxy: <strong>npm install</strong> then <strong>node server.js</strong>
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 16px", position: "relative", zIndex: 1 }}>
        {tab === "build" && (
          <div style={{ display: "grid", gridTemplateColumns: "305px 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Box title="Guide Info" theme={theme}>
                <div style={{ marginBottom: 10 }}>
                  <label style={LS}>Deck Name</label>
                  <input
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    placeholder="e.g. Classic Draven"
                    style={{ ...IS, borderColor: theme.border }}
                  />
                </div>
                <div>
                  <label style={LS}>Author</label>
                  <input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="e.g. Nick's Deck"
                    style={{ ...IS, borderColor: theme.border }}
                  />
                </div>
              </Box>

              <Box title="Decklist" theme={theme}>
                <div style={{ fontSize: 8.5, color: "#555", marginBottom: 8, lineHeight: 1.8 }}>
                  <span style={{ color: "#d4c090" }}>Legend:</span>{" · "}
                  <span style={{ color: "#b0b0d4" }}>Champion:</span>{" · "}
                  <span style={{ color: "#aaa" }}>MainDeck:</span>
                  <br />
                  <span style={{ color: "#c08040" }}>Battlefields:</span>{" · "}
                  <span style={{ color: "#a080c0" }}>Runes:</span>{" · "}
                  <span style={{ color: "#6effa8" }}>Sideboard:</span>
                </div>
                <textarea
                  value={deckText}
                  onChange={(e) => setDeckText(e.target.value)}
                  rows={30}
                  style={{
                    ...IS,
                    resize: "vertical",
                    fontFamily: "'Courier New',monospace",
                    fontSize: 11,
                    lineHeight: 1.85,
                    borderColor: theme.border,
                  }}
                />
              </Box>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  ["deck", "Deck Preview"],
                  ["matchups", "Sideboard Matchups"],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => setPanel(k)}
                    style={{
                      ...BS,
                      fontSize: 10,
                      background: panel === k ? theme.gradient : "rgba(255,255,255,0.04)",
                      border: `1px solid ${panel === k ? theme.borderBright : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {panel === "deck" && (
                <Box theme={theme}>
                  <DeckPreview parsed={parsed} theme={theme} />
                </Box>
              )}

              {panel === "matchups" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 900, letterSpacing: 2, color: "#fff" }}>Sideboard Matchups</h2>
                    {editing === null && (
                      <button
                        onClick={() => setEditing("new")}
                        style={{ ...BS, background: theme.gradient, border: `1px solid ${theme.borderBright}` }}
                      >
                        + Add Matchup
                      </button>
                    )}
                  </div>

                  {(editing === "new" || typeof editing === "number") && (
                    <MatchupEditor
                      mainDeck={parsed.mainDeck}
                      sideboard={parsed.sideboard}
                      onSave={saveMatchup}
                      onCancel={() => setEditing(null)}
                      initial={typeof editing === "number" ? matchups[editing] : null}
                      theme={theme}
                    />
                  )}

                  {matchups.length === 0 && editing === null ? (
                    <div
                      style={{
                        background: "rgba(255,255,255,0.012)",
                        border: `1px dashed ${theme.border}`,
                        borderRadius: 11,
                        padding: 40,
                        textAlign: "center",
                        color: "#2a2a2a",
                      }}
                    >
                      <div style={{ fontSize: 26, marginBottom: 8 }}>⚔️</div>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: 11, letterSpacing: 1 }}>
                        Add your first matchup to get started
                      </div>
                    </div>
                  ) : matchups.length > 0 ? (
                    <div
                      style={{
                        background: theme.bgPanel,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 11,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "220px 1fr 1fr",
                          borderBottom: `1px solid ${theme.borderBright}`,
                          background: `${theme.glow}`,
                        }}
                      >
                        <div style={{ padding: "6px 11px", fontSize: 8.5, color: theme.accent, letterSpacing: 2 }}>MATCHUP</div>
                        <div style={{ padding: "6px 11px", fontSize: 8.5, color: "#888", letterSpacing: 2 }}>OUT</div>
                        <div
                          style={{
                            padding: "6px 11px",
                            fontSize: 8.5,
                            color: "#6effa8",
                            letterSpacing: 2,
                            borderLeft: `1px solid ${theme.border}`,
                          }}
                        >
                          IN
                        </div>
                      </div>

                      {matchups.map((m, i) => (
                        <MatchupRow
                          key={i}
                          m={m}
                          idx={i}
                          theme={theme}
                          onEdit={setEditing}
                          onDelete={(idx) => setMatchups((ms) => ms.filter((_, j) => j !== idx))}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "preview" && (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "7px 13px",
                  background: theme.glow,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 7,
                  fontSize: 10,
                  color: theme.accent,
                  display: "inline-block",
                }}
              >
                <strong style={{ color: "#fff" }}>Ctrl + P to Save as PDF</strong>
              </div>

              <button
                onClick={savePreviewAsPng}
                style={{
                  ...BS,
                  background: theme.gradient,
                  border: `1px solid ${theme.borderBright}`,
                }}
              >
                Save as PNG
              </button>
            </div>

            <div style={{ overflowX: "auto", paddingBottom: 20 }}>
              <div ref={previewRef} style={{ width: "fit-content" }}>
                <GuidePreview
                  deckName={deckName}
                  author={author}
                  matchups={matchups}
                  parsed={parsed}
                  theme={theme}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}