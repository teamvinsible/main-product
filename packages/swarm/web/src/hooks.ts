import { useEffect, useRef, useState } from "react";

// Poll an async fetcher on an interval, exposing the latest value. Re-runs when
// any key in `deps` changes (e.g. the selected project). Avoids setting state
// after unmount.
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await fetcherRef.current();
        if (alive) { setData(next); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
}
