import { useCallback, useEffect, useRef, useState } from "react";
import { Unauthorized } from "./api";

export interface Loaded<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** The last reload failed, so `data` is from an earlier successful load. */
  stale: boolean;
  reload: () => void;
}

/** Fetch on mount and whenever `key` changes; an Unauthorized error is surfaced to the shell via onUnauthorized.
 *  A failed reload of the same key keeps the data already on screen (marked stale) instead of swapping in an error. */
export function useApi<T>(fn: () => Promise<T>, key: string, onUnauthorized?: () => void): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean; stale: boolean }>({ data: null, error: null, loading: true, stale: false });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const unauthRef = useRef(onUnauthorized);
  unauthRef.current = onUnauthorized;
  const keyRef = useRef(key);
  useEffect(() => {
    let live = true;
    const sameKey = keyRef.current === key;
    keyRef.current = key;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ data, error: null, loading: false, stale: false }),
      (error: Error) => {
        if (!live) return;
        if (error instanceof Unauthorized) {
          unauthRef.current?.();
          setState({ data: null, error, loading: false, stale: false });
          return;
        }
        setState((s) => (sameKey && s.data !== null ? { ...s, loading: false, stale: true } : { data: null, error, loading: false, stale: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}
