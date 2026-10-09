import { useEffect, useRef, useState } from 'react';

/** Clear stale data on scope changes and ignore late results from previous requests. */
export function useResource<T>(key: string, load: () => Promise<T>) {
  const loader = useRef(load); loader.current = load;
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{ key: string; value?: T; error?: string; loading: boolean }>({ key, loading: true });
  useEffect(() => {
    let active = true;
    setState({ key, loading: true });
    loader.current().then((value) => { if (active) setState({ key, value, loading: false }); })
      .catch((err: unknown) => { if (active) setState({ key, error: err instanceof Error ? err.message : 'Request failed', loading: false }); });
    return () => { active = false; };
  }, [key, revision]);
  return { ...(state.key === key ? state : { key, loading: true }), refresh: () => refresh((value) => value + 1) };
}
