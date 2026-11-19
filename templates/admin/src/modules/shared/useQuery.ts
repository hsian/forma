import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryState<T> { data?: T; loading: boolean; error?: Error }
/** A loader may query data only; never submit a mutation from this effect. */
export function useQuery<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ loading: true });
  const [revision, setRevision] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const generation = ++latest.current;
    const controller = new AbortController();
    setState(previous => ({ data: previous.data, loading: true }));
    void Promise.resolve().then(() => load(controller.signal)).then(data => {
      if (!controller.signal.aborted && generation === latest.current) setState({ data, loading: false });
    }).catch(error => {
      if (!controller.signal.aborted && generation === latest.current) setState(previous => ({ data: previous.data, loading: false, error: error instanceof Error ? error : new Error(String(error)) }));
    });
    return () => { controller.abort(); };
  }, [load, revision]);
  return { ...state, reload: useCallback(() => setRevision(value => value + 1), []) };
}
