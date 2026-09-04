// Meaningful-change scoring.
//
// Core idea: "meaningful" is relative to (a) how this specific symbol
// normally behaves, and (b) what the user has actually seen before —
// not a fixed % threshold and not "today's move" off the daily open.
//
// Inputs:
//   quote     - current server-side quote (see marketEngine.js)
//   baseline  - { price, ts } snapshot from the last time this user
//               looked at this symbol, or null if never seen
//
// Output: a score object the API and frontend both consume.

function stdevOfReturns(history) {
  if (!history || history.length < 3) return null;
  const rets = [];
  for (let i = 1; i < history.length; i++) rets.push(history[i] / history[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

// Volume ratio over the same trailing window the price history uses, not
// over a total accumulated since server start. Using a fixed-length rolling
// window (rather than "total volume / total time since boot") is what keeps
// this comparable across symbols added at different times and stable no
// matter how long the process has been running.
function computeVolumeRatio(q, barsElapsed) {
  if (!q.avgVolume || q.avgVolume <= 0) return 1;
  const series = q.volumeSeries && q.volumeSeries.length ? q.volumeSeries : null;
  if (!series) return 1;
  const windowTicks = Math.min(series.length, barsElapsed);
  const recentVolume = series.slice(-windowTicks).reduce((a, b) => a + b, 0);
  const expected = q.avgVolume * (windowTicks / 390);
  return expected > 0 ? recentVolume / expected : 1;
}

export function scoreChange(q, baseline) {
  const basePrice = baseline?.price ?? q.open;
  const sinceReturn = q.price / basePrice - 1;

  // How unusual is this move *for this symbol*, scaled by how long it's
  // been since the user last looked (more elapsed time -> wider expected
  // range, so we don't flag normal drift as an anomaly).
  const realizedVol = stdevOfReturns(q.history) || q.dailyVol / Math.sqrt(390);
  const barsElapsed = baseline ? Math.max(1, q.history.length) : 1;
  const expectedVol = realizedVol * Math.sqrt(barsElapsed);
  const zScore = expectedVol > 0 ? sinceReturn / expectedVol : 0;

  const volumeRatio = computeVolumeRatio(q, barsElapsed);
  const volumeAnomaly = Math.max(0, volumeRatio - 1.3);

  const brokeSessionHigh = q.price >= q.sessionHigh && (!baseline || baseline.price < q.sessionHigh);
  const brokeSessionLow = q.price <= q.sessionLow && (!baseline || baseline.price > q.sessionLow);

  // A catalyst only counts as "news" if it happened after the user's last
  // baseline -- otherwise a random event from server boot would follow a
  // symbol around forever, long after it stopped being relevant to "what
  // changed since you checked."
  const catalystIsRecent = q.catalyst && (!baseline || (q.catalystAt && q.catalystAt > baseline.ts));

  let attention =
    Math.min(Math.abs(zScore), 6) * 12 +
    Math.min(volumeAnomaly, 3) * 8 +
    (brokeSessionHigh || brokeSessionLow ? 15 : 0) +
    (catalystIsRecent ? 25 : 0);
  attention = Math.min(100, Math.round(attention));

  let tier = "quiet";
  if (attention >= 55) tier = "major";
  else if (attention >= 25) tier = "notable";

  const reasons = [];
  if (Math.abs(zScore) >= 1.5) {
    reasons.push(`Moved ${Math.abs(zScore).toFixed(1)}x its usual swing since you last checked`);
  }
  if (volumeAnomaly > 0.3) reasons.push(`Volume running ${volumeRatio.toFixed(1)}x normal`);
  if (brokeSessionHigh) reasons.push("Broke through session high");
  if (brokeSessionLow) reasons.push("Broke through session low");
  if (catalystIsRecent) reasons.push(q.catalyst);
  if (reasons.length === 0) reasons.push("Trading in line with its usual range");

  // Freshness / trust: never let a stale number pass as live.
  const staleMs = Date.now() - q.lastTickAt;
  let freshness = "live";
  if (q.delayed) freshness = "delayed";
  else if (staleMs > 15000) freshness = "stale";

  return { sinceReturn, zScore, attention, tier, reasons, volumeRatio, freshness };
}