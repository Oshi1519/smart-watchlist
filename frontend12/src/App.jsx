import React, { useState, useEffect, useMemo, useCallback } from "react";

const API = "/api";

const T = {
  bg: "#12141C", surface: "#181B26", surfaceRaised: "#1F2330", line: "#2A2E3D",
  text: "#E9E7DF", textDim: "#9498A8", textFaint: "#5B5F70",
  amber: "#E8A33D", amberDim: "#4A3A1E", up: "#57B080", down: "#DD6C57", stale: "#7C6BAE",
};
const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const FONT_BODY = "'IBM Plex Sans', system-ui, sans-serif";

// A stable per-browser identity stands in for real auth in this demo. Every
// request carries it as x-user-id; the backend keys all persistence off that
// same id, so this is also literally the cross-device sync mechanism — sign
// the same id in on another device (e.g. via a real login) and its watchlist
// and "last checked" baselines are already there.
function getUserId() {
  let id = localStorage.getItem("swl_user_id");
  if (!id) {
    id = "user-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("swl_user_id", id);
  }
  return id;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-user-id": getUserId(), ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const timeAgo = (ts) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

function Sparkline({ history, up }) {
  const w = 72, h = 24;
  if (!history || history.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...history), max = Math.max(...history);
  const range = max - min || 1;
  const pts = history.map((v, i) => `${((i / (history.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={up ? T.up : T.down} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function FreshnessDot({ freshness, lastTickAt }) {
  const color = freshness === "delayed" ? T.stale : freshness === "stale" ? T.textFaint : T.up;
  const label = freshness === "delayed" ? "Feed delayed" : freshness === "stale" ? "Stale" : "Live";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: T.textDim, fontFamily: FONT_BODY }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: label === "Live" ? `0 0 6px ${color}` : "none" }} />
      {label} · {timeAgo(lastTickAt)}
    </span>
  );
}

function TierBadge({ tier }) {
  const map = {
    major: { c: T.amber, bg: T.amberDim, label: "Major" },
    notable: { c: T.textDim, bg: T.surfaceRaised, label: "Notable" },
    quiet: { c: T.textFaint, bg: "transparent", label: "Quiet" },
  };
  const s = map[tier];
  return (
    <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, color: s.c, background: s.bg, padding: "3px 8px", borderRadius: 4, border: `1px solid ${tier === "major" ? T.amber : T.line}`, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [symbolsMeta, setSymbolsMeta] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [justCaughtUp, setJustCaughtUp] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/view");
      setRows(data.rows);
      setError(null);
    } catch (e) {
      setError("Can't reach the backend — is it running on port 4000?");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    api("/symbols").then(setSymbolsMeta).catch(() => {});
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh]);

  const addSymbol = async (sym) => {
    await api("/watchlist", { method: "POST", body: JSON.stringify({ symbol: sym }) });
    setQuery("");
    refresh();
  };
  const removeSymbol = async (sym) => {
    await api(`/watchlist/${sym}`, { method: "DELETE" });
    if (selected === sym) setSelected(null);
    refresh();
  };
  const markCaughtUp = async () => {
    await api("/catch-up", { method: "POST" });
    setJustCaughtUp(true);
    setTimeout(() => setJustCaughtUp(false), 2200);
    refresh();
  };

  const digest = useMemo(() => rows.filter((r) => r.tier !== "quiet"), [rows]);
  const watchlistSymbols = useMemo(() => new Set(rows.map((r) => r.sym)), [rows]);
  const availableToAdd = symbolsMeta.filter(
    (u) => !watchlistSymbols.has(u.sym) && (u.sym.toLowerCase().includes(query.toLowerCase()) || u.name.toLowerCase().includes(query.toLowerCase()))
  );
  const selectedRow = rows.find((r) => r.sym === selected);

  if (!loaded) {
    return <div style={{ background: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: T.textDim, fontFamily: FONT_BODY }}>Loading your watchlist…</div>;
  }

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: FONT_BODY, color: T.text, padding: "28px 20px 60px" }}>
      <style>{`
        @media (max-width: 560px) {
          .swl-row { flex-wrap: wrap; row-gap: 8px; }
          .swl-row-spark { display: none; }
          .swl-row-fresh { width: 100%; order: 3; }
          .swl-row-meta { width: auto !important; }
          .swl-row-price { margin-left: auto; }
        }
      `}</style>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Watchlist</h1>
          <button onClick={() => setShowAdd((s) => !s)} style={{ background: T.surfaceRaised, color: T.text, border: `1px solid ${T.line}`, borderRadius: 6, padding: "7px 12px", fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>
            {showAdd ? "Close" : "+ Add symbol"}
          </button>
        </div>

        {error && <div style={{ background: "#332420", border: `1px solid ${T.down}`, color: T.down, borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <div style={{ color: T.textDim, fontSize: 13.5, marginBottom: 22 }}>
          {digest.length > 0
            ? `${digest.length} of ${rows.length} names have moved outside their normal range since you last checked.`
            : `Nothing outside the ordinary since you last checked${rows.length ? " — quiet session." : "."}`}
        </div>

        {showAdd && (
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 14, marginBottom: 24 }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by symbol or name…"
              style={{ width: "100%", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 6, color: T.text, padding: "8px 10px", fontFamily: FONT_BODY, fontSize: 13.5, outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto" }}>
              {availableToAdd.length === 0 && <div style={{ color: T.textFaint, fontSize: 13, padding: "6px 2px" }}>No matches, or already on your list.</div>}
              {availableToAdd.map((u) => (
                <button key={u.sym} onClick={() => addSymbol(u.sym)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", borderRadius: 6, padding: "8px 8px", cursor: "pointer", color: T.text, textAlign: "left" }}>
                  <span><span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600 }}>{u.sym}</span><span style={{ color: T.textDim, marginLeft: 8, fontSize: 12.5 }}>{u.name}</span></span>
                  <span style={{ color: T.textFaint, fontSize: 11.5 }}>{u.sector}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {digest.length > 0 && (
          <div style={{ marginBottom: 30 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, color: T.amber }}>Since you last checked</div>
              <button onClick={markCaughtUp} style={{ background: "transparent", border: `1px solid ${T.line}`, color: T.textDim, borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY }}>
                {justCaughtUp ? "Baseline reset ✓" : "Mark all as caught up"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {digest.map((r) => {
                const up = r.sinceReturn >= 0;
                return (
                  <div key={r.sym} onClick={() => setSelected(r.sym)}
                    style={{ background: T.surface, border: `1px solid ${r.tier === "major" ? "#4A3E28" : T.line}`, borderLeft: `3px solid ${r.tier === "major" ? T.amber : T.textFaint}`, borderRadius: 7, padding: "12px 14px", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>{r.sym}</span>
                          <TierBadge tier={r.tier} />
                        </div>
                        <div style={{ color: T.textDim, fontSize: 12.5 }}>{r.reasons.join(" · ")}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 600 }}>${fmt(r.price)}</div>
                        <div style={{ color: up ? T.up : T.down, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{fmtPct(r.sinceReturn)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, color: T.textDim, marginBottom: 10 }}>Full list</div>
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
          {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: T.textFaint, fontSize: 13.5 }}>Nothing on your watchlist yet — add a symbol to start tracking it.</div>}
          {rows.map((r, i) => {
            const up = r.sinceReturn >= 0;
            return (
              <div key={r.sym} onClick={() => setSelected(r.sym)} className="swl-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${T.line}`, background: T.surface }}>
                <div className="swl-row-meta" style={{ width: 70, flexShrink: 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14 }}>{r.sym}</div>
                  <div style={{ color: T.textFaint, fontSize: 11 }}>{r.sector}</div>
                </div>
                <div className="swl-row-fresh" style={{ flex: 1, minWidth: 0 }}><FreshnessDot freshness={r.freshness} lastTickAt={r.lastTickAt} /></div>
                <div className="swl-row-spark"><Sparkline history={r.history} up={up} /></div>
                <div style={{ width: 34, textAlign: "right", flexShrink: 0, color: T.amber, fontFamily: FONT_DISPLAY, fontSize: 12.5 }} title="Attention score">{r.attention}</div>
                <div className="swl-row-price" style={{ width: 90, textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontVariantNumeric: "tabular-nums", fontSize: 14 }}>${fmt(r.price)}</div>
                  <div style={{ color: up ? T.up : T.down, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{fmtPct(r.sinceReturn)}</div>
                </div>
                <div style={{ width: 66, textAlign: "right", flexShrink: 0 }}><TierBadge tier={r.tier} /></div>
                <button onClick={(e) => { e.stopPropagation(); removeSymbol(r.sym); }} style={{ background: "transparent", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 15, padding: "0 2px", flexShrink: 0 }} title="Remove">×</button>
              </div>
            );
          })}
        </div>

        {selectedRow && (
          <div style={{ marginTop: 26, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700 }}>{selectedRow.sym}</div>
                <div style={{ color: T.textDim, fontSize: 13 }}>{selectedRow.name} · {selectedRow.sector}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: T.textFaint, cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
              <div><div style={{ color: T.textFaint, fontSize: 11 }}>Price</div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 20 }}>${fmt(selectedRow.price)}</div></div>
              <div><div style={{ color: T.textFaint, fontSize: 11 }}>Since last checked</div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: selectedRow.sinceReturn >= 0 ? T.up : T.down }}>{fmtPct(selectedRow.sinceReturn)}</div></div>
              <div><div style={{ color: T.textFaint, fontSize: 11 }}>Attention score</div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: T.amber }}>{selectedRow.attention}/100</div></div>
              <div><div style={{ color: T.textFaint, fontSize: 11 }}>Session range</div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, marginTop: 3 }}>${fmt(selectedRow.sessionLow)} – ${fmt(selectedRow.sessionHigh)}</div></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ color: T.textFaint, fontSize: 11, marginBottom: 6 }}>Why this is flagged</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>{selectedRow.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
            <div style={{ marginTop: 16 }}><FreshnessDot freshness={selectedRow.freshness} lastTickAt={selectedRow.lastTickAt} /></div>
          </div>
        )}

        <div style={{ marginTop: 30, color: T.textFaint, fontSize: 11.5, lineHeight: 1.6, borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
          Live data from the local backend, polled every 2.5s. Scoring, persistence, and staleness detection all run server-side.
        </div>
      </div>
    </div>
  );
}