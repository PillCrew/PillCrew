// src/trendcache.js - the last trending read that actually worked.
//
// GeckoTerminal sits behind a CDN that answers 502/503 every so often, and a
// single blip used to turn a healthy feed into "Trending feed is unavailable
// right now" - the user saw exactly that while the API was fine a second later.
// Serving the last good list, clearly marked as a previous read, is more useful
// than a dead end; serving it as if it were live would be worse than both. Pure
// functions, so the rule is testable without booting Electron or the network.

// How old a stored read may be before it stops being worth showing.
const TRENDING_STALE_MAX = 30 * 60000;

// What to store after a fetch: only a real list is worth remembering.
// Returns { list, context, at } or null.
function trendingToStore(data, now = Date.now()) {
  if (!data || !Array.isArray(data.list) || !data.list.length) return null;
  return { list: data.list, context: String(data.context || ""), at: now };
}

/**
 * The payload to send when the live fetch returned nothing.
 * @param {{list: Array, context: string, at: number}|null} last stored good read
 * @param {{rateLimited?: boolean}|null} fresh whatever the failed fetch reported
 * @returns {{list: Array, context: string, stale: true, staleAt: number, rateLimited: boolean}|null}
 *          null when there is nothing honest left to show.
 */
function trendingFallback(last, fresh, now = Date.now(), maxAgeMs = TRENDING_STALE_MAX) {
  if (!last || !Array.isArray(last.list) || !last.list.length) return null;
  const age = now - Number(last.at);
  if (!isFinite(age) || age < 0 || age > maxAgeMs) return null;
  const when = new Date(last.at).toLocaleTimeString();
  // The numbers stay in the context: the rundown is still about real data, it just
  // has to say how old it is.
  return {
    list: last.list,
    context: `${last.context}\n(note: the live trending feed did not answer just now - these numbers are the last read, from ${when})`,
    stale: true,
    staleAt: last.at,
    rateLimited: !!(fresh && fresh.rateLimited),
  };
}

module.exports = { TRENDING_STALE_MAX, trendingToStore, trendingFallback };
