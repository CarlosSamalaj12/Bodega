import { useEffect, useState } from 'react';
import { productosService } from '@/services/productos.service';
import { useAuthStore } from '@/stores/auth.store';
import { useDebounce } from './useDebounce';

/**
 * Búsqueda en vivo de productos para selectores.
 * Devuelve { productos, loading, query, setQuery }.
 *
 * Filtra por la bodega del usuario actual: el endpoint del server
 * (`/api/productos/search`) usa la tabla `producto_bodegas_visibilidad`
 * para excluir los productos que NO están habilitados en la bodega
 * del usuario. Esto evita que en un selector aparezcan productos
 * que el usuario ni siquiera puede despachar/ingresar.
 *
 * Si el caller quiere sobreescribir la bodega (p.ej. un admin
 * revisando qué puede hacer OTRA bodega), puede pasar `warehouseId`
 * explícito — gana sobre la bodega del auth.
 */
export function useProductSearch({ limit = 8, minChars = 1, warehouseId } = {}) {
  const userWarehouse = useAuthStore((s) => s.user?.id_warehouse);
  // Prioridad: warehouseId explícito > bodega del usuario. Si no hay
  // ninguna, mandamos null (server mostrará todos, comportamiento
  // legacy que mantiene a los admins sin bodega asignada funcionando).
  const effectiveWarehouse = warehouseId !== undefined
    ? warehouseId
    : (userWarehouse != null ? Number(userWarehouse) : null);

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
      .search({ q: debounced, warehouse: effectiveWarehouse })
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
  }, [debounced, minChars, effectiveWarehouse]);

  return { productos, loading, query, setQuery };
}
