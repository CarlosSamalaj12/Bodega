import { useEffect, useState } from 'react';

/**
 * Devuelve un valor que se actualiza solo después de `delay` ms
 * sin cambios — útil para búsquedas en vivo.
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
