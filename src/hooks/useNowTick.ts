import { useEffect, useState } from 'react';

/**
 * Re-render on a fixed interval so time-based derivations (e.g. "is this batch
 * past its estimated ready date?" or "is this harvest window active now?") update
 * on their own while a page is left open — no manual refresh needed.
 *
 * Returns a `Date` that advances every `intervalMs`. Reading the returned value
 * (or simply calling the hook) is enough to make a component recompute date math.
 *
 * @param intervalMs how often to tick, in milliseconds. Defaults to 60s — status
 *   changes are day/week-grained, so a per-minute tick is plenty and cheap.
 */
export function useNowTick(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
