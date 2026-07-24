import { useEffect, useState } from 'react';
import { productosService } from '@/services/productos.service';
import { useDebounce } from './useDebounce';

/**
 * Búsqueda en vivo de productos para selectores.
 * Devuelve { productos, loading, query, setQuery }.
 */
export function useProductSearch({ limit = 8, minChars = 1 } = {}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (debounced.length < minChars) {
      setProductos([]);
      return;
    }
    setLoading(true);
    productosService
      .search({ q: debounced })
      .then((data) => {
        if (!cancelled) setProductos(data || []);
      })
      .catch(() => {
        if (!cancelled) setProductos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [debounced, minChars]);

  return { productos, loading, query, setQuery };
}
