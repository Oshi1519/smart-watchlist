# Smart Watchlist

A watchlist that answers one question well: **"what actually deserves my
attention since I last looked?"** — not just "here are today's prices."

## Why this version, not the obvious one

The obvious watchlist is a table of tickers with a live price and a
red/green daily %. It has two problems: it treats every stock's volatility
the same way (a 2% move means something very different for a utility than
for a small-cap), and it frames everything against "today," which is the
wrong reference point for someone who checks in every few days, not every
minute.

This version reframes the product around a **diff, not a dashboard**: on
open, it shows you what changed *since your last visit*, ranked by how
unusual that change actually was for that specific stock — not a flat
threshold.

## What counts as a "meaningful change"

Implemented in [`backend/src/scoring.js`](backend/src/scoring.js). For each
symbol, the score combines:

1. **Move size, relative to the stock's own volatility (z-score).** The
   return since your last-seen price is divided by that symbol's realized
   volatility, scaled by how much time has passed. This is the core idea:
   "meaningful" is relative, not absolute.
2. **Volume anomaly.** Volume well above the symbol's own average is a
   signal something is happening, independent of price.
3. **Session-level breaks.** Crossing a session high/low that it hadn't
   crossed as of your last visit.
4. **Catalysts.** A stand-in for real news/filing/earnings events — in
   production this is where an actual news or filings feed would plug in.

These combine into a 0–100 **attention score**, bucketed into
`quiet` / `notable` / `major`, with a plain-language reason list so the
score is never a black box.

## What information is surfaced

- **"Since you last checked" digest** — the hero of the page. Only
  `notable`/`major` names appear here, sorted by attention score, each with
  a one-line reason.
- **Full list** — every watchlisted symbol, sparkline, price, freshness
  indicator, and tier badge, for people who want the complete picture.
- **Detail panel** — the full reasoning breakdown, attention score, and
  session range for one symbol at a time.
- **Freshness, always visible.** Every quote is labeled `Live`, `Delayed`,
  or `Stale` with a "last updated" timestamp — see below.

## How state persists across sessions/devices

Two backend tables (`backend/src/db.js`, SQLite):

- `watchlist(user_id, symbol)` — which symbols you track.
- `baseline(user_id, symbol, price, ts)` — the price the last time you
  "saw" that symbol. This is what makes the diff possible.

Everything is keyed by `user_id`. In this demo that's a random ID stored in
`localStorage` per browser (see `frontend/src/App.jsx`); swapping in real
auth only changes how `user_id` is derived — sign the same account in on a
second device and the watchlist and baselines are already there, because
both devices write to the same rows. `INSERT ... ON CONFLICT DO UPDATE`
(last-write-wins) is the right merge policy here: a baseline is "what did I
last see," so a newer write should always win, and there's no meaningful
case where a client needs to merge two baselines instead of taking the
latest.

The baseline is intentionally **not** reset just by opening the app — you
have to explicitly "mark as caught up" (or add a symbol, which seeds its
own baseline). Auto-resetting on every visit would mean the digest resets
before you've actually read it.

## Handling stale, delayed, or conflicting data

This was treated as a first-class design constraint, not an edge case:

- Every quote carries a `freshness` state (`live` / `delayed` / `stale`)
  computed from how long it's been since the feed last ticked for that
  specific symbol — feeds don't all update in lockstep, and the UI never
  hides that.
- A quote that hasn't ticked in >15s is shown as `Stale` rather than
  silently displayed as current — the interface never claims freshness it
  can't back up.
- The market engine (`backend/src/marketEngine.js`) simulates real feed
  behavior — per-symbol volatility, volume spikes, and a ~4%-per-tick
  chance of a stalled update — specifically so the freshness/staleness path
  is exercised, not just a live happy path.
- **Conflicting data** (e.g., two providers disagreeing): not simulated
  here since there's a single feed, but the scoring layer is written to
  take one canonical `quote` object per symbol — the natural extension is a
  reconciliation step upstream of `scoreChange()` that resolves multiple
  sources (e.g., median-of-sources with a wider disagreement flagged in
  `reasons`) before scoring runs, so scoring itself doesn't need to know
  about the mechanics of multi-source reconciliation.

## Why simulated market data, not a live API

Free-tier quote APIs are rate-limited to a handful of calls/minute, which
makes a multi-user live demo either flaky or effectively single-symbol.
The simulator in `marketEngine.js` models the *shape* of a real feed
(volatility, volume, catalysts, delayed ticks) closely enough that scoring
and staleness logic behave exactly as they would against a real one.
Swapping `tick()` for a real provider call is a contained change — nothing
in `scoring.js`, the API routes, or the frontend needs to know the
difference.

## How this scales

Current shape (single process, in-memory quotes, SQLite, polling) is
right-sized for a demo and for maybe thousands of users. The evolution path
if this needed to support many more users and larger watchlists:

- **Push, not poll.** Swap the frontend's 2.5s poll for a WebSocket/SSE
  channel per user, and have the market engine publish ticks to a
  pub/sub layer (Redis Streams / NATS) keyed by symbol. Clients subscribe
  only to the symbols on their watchlist instead of every client re-fetching
  every symbol on a timer.
- **Decouple ingestion from scoring from serving.** One set of workers polls
  upstream data providers and writes canonical quotes to a fast store
  (Redis); scoring runs as a stateless function over `(quote, baseline)` —
  already true in this codebase — so it can run anywhere, including at the
  edge; API nodes just serve reads and stay horizontally scalable.
- **Popular symbols, not per-user fetches.** Thousands of users watching the
  same 20 large-cap names should mean 20 upstream subscriptions, not
  thousands — fan the quote out to every subscribed user from one shared
  feed per symbol instead of per-user polling of the provider.
- **SQLite → Postgres** once write concurrency across many users matters;
  the schema is already normalized enough that this is a connection-string
  change, not a redesign.

## Where complexity was deliberately avoided

- No user accounts/auth system — a stable client-side ID stands in for it,
  since the interesting problem here is the scoring/diffing model, not
  auth.
- No real news/filings integration — `catalyst` is a stand-in with a clear
  seam (`marketEngine.js`) for where a real feed would plug in.
- REST polling instead of WebSockets for the demo — simpler to run and
  demo locally with zero extra infra, with the WebSocket path called out
  above as the concrete next step rather than built speculatively.

## Running it

Requires Node 18+.

```bash
# Terminal 1 — backend (API on :4000)
cd backend
npm install
npm start

# Terminal 2 — frontend (dev server on :5173, proxies /api to :4000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The watchlist starts empty — add a few symbols,
watch prices tick every ~2s, then use "Mark all as caught up" to reset your
baseline and see the digest empty out, simulating a return visit.

## Project structure

```
backend/
  src/
    marketEngine.js   simulated price feed, per-symbol volatility
    scoring.js         meaningful-change scoring (z-score, volume, breaks, catalysts)
    db.js               SQLite persistence (watchlist + baselines)
    server.js           Express API
frontend/
  src/
    App.jsx             UI: digest, full list, detail panel
```
