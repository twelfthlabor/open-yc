import { useCallback, useEffect, useRef, useState } from "react";
import { Unauthorized } from "./api";

export interface Loaded<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch on mount and whenever `key` changes; an Unauthorized error is surfaced to the shell via onUnauthorized. */
export function useApi<T>(fn: () => Promise<T>, key: string, onUnauthorized?: () => void): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const unauthRef = useRef(onUnauthorized);
  unauthRef.current = onUnauthorized;
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => {
        if (!live) return;
        if (error instanceof Unauthorized) unauthRef.current?.();
        setState({ data: null, error, loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}
