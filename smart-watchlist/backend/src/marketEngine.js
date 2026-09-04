// Simulated market data engine.
//
// Why simulated: free-tier real quote APIs (Alpha Vantage, Finnhub, IEX) are
// rate-limited to a handful of requests/minute, which makes a live multi-user
// demo unreliable. The engine here models the same *shape* of problems a real
// feed has — per-symbol volatility, volume spikes, catalyst events, and
// occasional delayed/stale ticks — so the meaningful-change logic is exercised
// realistically. Swap `tick()` for a real provider call and everything
// downstream (scoring, digest, staleness handling) keeps working unchanged.

export const UNIVERSE = [
  { sym: "NVEX", name: "Nova Exponent Corp", sector: "Semiconductors", base: 412.3, dailyVol: 0.028 },
  { sym: "BRKF", name: "Brookfield Utilities", sector: "Utilities", base: 68.1, dailyVol: 0.006 },
  { sym: "QNTM", name: "Quantum Fold Inc", sector: "Deep Tech", base: 54.75, dailyVol: 0.045 },
  { sym: "HRZN", name: "Horizon Foods Co", sector: "Consumer Staples", base: 91.4, dailyVol: 0.008 },
  { sym: "PLTF", name: "Palette Financial", sector: "Financials", base: 138.6, dailyVol: 0.014 },
  { sym: "AERI", name: "Aeris Mobility", sector: "Automotive", base: 27.85, dailyVol: 0.032 },
  { sym: "SLCN", name: "Silicon Bridge", sector: "Semiconductors", base: 205.9, dailyVol: 0.021 },
  { sym: "MDLF", name: "Meridian Life Sci", sector: "Healthcare", base: 76.2, dailyVol: 0.018 },
];

const CATALYSTS = [
  "Guidance raised ahead of open",
  "Analyst downgrade on margin concerns",
  "Unconfirmed report of supply delay",
  "Beat on revenue, miss on EPS",
  "Regulatory filing flagged by desk",
  "Unusual options activity noted",
];

function makeInitialQuote(u) {
  return {
    sym: u.sym,
    name: u.name,
    sector: u.sector,
    dailyVol: u.dailyVol,
    price: u.base,
    open: u.base,
    sessionHigh: u.base,
    sessionLow: u.base,
    volume: 0,
    volumeSeries: [],
    avgVolume: 1_000_000 + Math.random() * 4_000_000,
    history: [u.base],
    lastTickAt: Date.now(),
    delayed: false,
    catalyst: null,
    catalystAt: null,
  };
}

function tick(q) {
  // Occasionally a symbol's feed stalls instead of updating — models a
  // real provider hiccup so the UI has something honest to show.
  if (Math.random() < 0.04) {
    return { ...q, delayed: true };
  }

  const stepVol = q.dailyVol / Math.sqrt(390);
  let shock = (Math.random() - 0.5) * 2 * stepVol;

  let catalyst = q.catalyst;
  let catalystAt = q.catalystAt;
  if (Math.random() < 0.02) {
    shock += (Math.random() < 0.5 ? -1 : 1) * stepVol * (6 + Math.random() * 10);
    catalyst = CATALYSTS[Math.floor(Math.random() * CATALYSTS.length)];
    catalystAt = Date.now();
  }

  const newPrice = Math.max(0.5, q.price * (1 + shock));
  const volumeThisTick = Math.max(
    0,
    (q.avgVolume / 390) * (0.4 + Math.random() * 1.6) * (catalyst ? 4 : 1)
  );

  // Rolling volume window (mirrors the price `history` window) instead of a
  // volume total accumulated since server boot. A monotonically-growing
  // total, compared against a capped-length expectation, drifts out of sync
  // the longer the process stays up -- every symbol would eventually read as
  // "high volume" regardless of what's actually happening. Keeping only the
  // same trailing N ticks that `history` keeps means the ratio stays honest
  // no matter how long the server has been running.
  const volumeSeries = [...q.volumeSeries.slice(-119), volumeThisTick];

  return {
    ...q,
    price: newPrice,
    sessionHigh: Math.max(q.sessionHigh, newPrice),
    sessionLow: Math.min(q.sessionLow, newPrice),
    volumeSeries,
    volume: q.volume + volumeThisTick, // cumulative session total, for display only
    history: [...q.history.slice(-119), newPrice],
    lastTickAt: Date.now(),
    delayed: false,
    catalyst,
    catalystAt,
  };
}

export class MarketEngine {
  constructor() {
    this.quotes = new Map();
    UNIVERSE.forEach((u) => this.quotes.set(u.sym, makeInitialQuote(u)));
    // fast-forward so there's real history/spread as soon as the server boots
    for (let i = 0; i < 60; i++) this._tickAll();
  }

  _tickAll() {
    for (const [sym, q] of this.quotes) this.quotes.set(sym, tick(q));
  }

  start(intervalMs = 2000) {
    this.timer = setInterval(() => this._tickAll(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  getQuote(sym) {
    return this.quotes.get(sym) || null;
  }

  getQuotes(symbols) {
    return symbols.map((s) => this.getQuote(s)).filter(Boolean);
  }

  allSymbolsMeta() {
    return UNIVERSE;
  }
}