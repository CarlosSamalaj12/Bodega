import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook genérico para llamadas async con loading/error/data.
 * Cancela la request si el componente se desmonta o cambia `run`.
 */
export function useAsync(asyncFn, { immediate = true, deps = [] } = {}) {
  const [state, setState] = useState({ data: null, loading: immediate, error: null });
  const mounted = useRef(true);
  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;

  const run = useCallback(async (...args) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current(...args);
      if (mounted.current) setState({ data, loading: false, error: null });
      return data;
    } catch (e) {
      if (mounted.current) {
        setState({ data: null, loading: false, error: e });
      }
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (immediate) run().catch(() => {});
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, run, setState };
}
