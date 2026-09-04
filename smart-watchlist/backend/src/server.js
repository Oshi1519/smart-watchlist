import express from "express";
import cors from "cors";
import { MarketEngine } from "./marketEngine.js";
import { scoreChange } from "./scoring.js";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getBaselines,
  setBaseline,
  setBaselinesForAll,
} from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const engine = new MarketEngine();
engine.start(2000);

// Demo auth: a stable per-browser id passed as a header takes the place of
// real accounts/sessions. Swapping in real auth only touches this one line —
// everything else already keys off `userId`, which is what makes cross-device
// sync work: two devices logged into the same account share the same rows.
function userIdFrom(req) {
  return req.header("x-user-id") || "demo-user";
}

// --- Symbol universe / search -------------------------------------------
app.get("/api/symbols", (req, res) => {
  res.json(engine.allSymbolsMeta());
});

// --- Watchlist CRUD -------------------------------------------------------
app.get("/api/watchlist", (req, res) => {
  res.json({ symbols: getWatchlist(userIdFrom(req)) });
});

app.post("/api/watchlist", (req, res) => {
  const userId = userIdFrom(req);
  const { symbol } = req.body;
  const quote = engine.getQuote(symbol);
  if (!quote) return res.status(404).json({ error: "Unknown symbol" });
  addToWatchlist(userId, symbol);
  // Baseline starts at "now" so a freshly added symbol doesn't immediately
  // read as a huge change against a baseline it never had.
  setBaseline(userId, symbol, quote.price, Date.now());
  res.status(201).json({ ok: true });
});

app.delete("/api/watchlist/:symbol", (req, res) => {
  removeFromWatchlist(userIdFrom(req), req.params.symbol);
  res.json({ ok: true });
});

// --- The core view: watchlist + live quotes + change scoring -------------
app.get("/api/view", (req, res) => {
  const userId = userIdFrom(req);
  const symbols = getWatchlist(userId);
  const baselines = getBaselines(userId);

  const rows = symbols.map((sym) => {
    const q = engine.getQuote(sym);
    const baseline = baselines[sym] || null;
    const score = scoreChange(q, baseline);
    return {
      sym,
      name: q.name,
      sector: q.sector,
      price: round2(q.price),
      sessionHigh: round2(q.sessionHigh),
      sessionLow: round2(q.sessionLow),
      history: q.history.map(round2),
      lastTickAt: q.lastTickAt,
      freshness: score.freshness,
      catalyst: q.catalyst,
      sinceReturn: score.sinceReturn,
      attention: score.attention,
      tier: score.tier,
      reasons: score.reasons,
    };
  });

  rows.sort((a, b) => b.attention - a.attention);
  res.json({ rows, serverTime: Date.now() });
});

// --- Reset baseline ("mark as caught up") ---------------------------------
app.post("/api/catch-up", (req, res) => {
  const userId = userIdFrom(req);
  const symbols = getWatchlist(userId);
  const now = Date.now();
  const priceMap = {};
  symbols.forEach((sym) => {
    const q = engine.getQuote(sym);
    if (q) priceMap[sym] = q.price;
  });
  setBaselinesForAll(userId, priceMap, now);
  res.json({ ok: true, at: now });
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Smart Watchlist API listening on http://localhost:${PORT}`);
});
