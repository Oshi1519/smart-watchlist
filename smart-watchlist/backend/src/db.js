import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "watchlist.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id TEXT NOT NULL,
    symbol  TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS baseline (
    user_id TEXT NOT NULL,
    symbol  TEXT NOT NULL,
    price   REAL NOT NULL,
    ts      INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );
`);

// One row per (user, symbol) each -- last write wins, which is the right
// call here: a baseline is "what did the price look like the last time this
// user looked", so a newer snapshot always supersedes an older one, and a
// watchlist add/remove is idempotent per user regardless of which device
// issued it. This keeps cross-device sync trivial: every device reads and
// writes the same row keyed by user_id, no merge logic required.

export function getWatchlist(userId) {
  return db
    .prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at ASC")
    .all(userId)
    .map((r) => r.symbol);
}

export function addToWatchlist(userId, symbol) {
  db.prepare(
    "INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?, ?, ?)"
  ).run(userId, symbol, Date.now());
}

export function removeFromWatchlist(userId, symbol) {
  db.prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?").run(userId, symbol);
  db.prepare("DELETE FROM baseline WHERE user_id = ? AND symbol = ?").run(userId, symbol);
}

export function getBaselines(userId) {
  const rows = db.prepare("SELECT symbol, price, ts FROM baseline WHERE user_id = ?").all(userId);
  const map = {};
  rows.forEach((r) => { map[r.symbol] = { price: r.price, ts: r.ts }; });
  return map;
}

export function setBaseline(userId, symbol, price, ts) {
  db.prepare(
    `INSERT INTO baseline (user_id, symbol, price, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET price = excluded.price, ts = excluded.ts`
  ).run(userId, symbol, price, ts);
}

export function setBaselinesForAll(userId, symbolPriceMap, ts) {
  const stmt = db.prepare(
    `INSERT INTO baseline (user_id, symbol, price, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET price = excluded.price, ts = excluded.ts`
  );
  const tx = db.transaction((entries) => {
    for (const [symbol, price] of entries) stmt.run(userId, symbol, price, ts);
  });
  tx(Object.entries(symbolPriceMap));
}

export default db;
