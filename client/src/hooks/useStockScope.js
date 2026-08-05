import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

/**
 * useStockScope
 * - Llama a /api/reportes/stock-scope para resolver qué bodegas puede ver
 *   el usuario actual en los reportes.
 * - Devuelve: { loading, scope, bodegas, canAllBodegas, defaultBodegaId, refresh }.
 * - `scope` es la respuesta completa del endpoint; `bodegas` es la lista
 *   que ya viene filtrada por el server.
 *
 * Cuándo usar:
 *  - En páginas de Reporte (Entradas/Salidas/Pedidos) para decidir si mostrar
 *    el selector de bodega (admin/report) o un label fijo (bodeguero).
 *  - En cualquier lugar donde necesites saber si el usuario tiene acceso a
 *    "todas las bodegas" o solo a su bodega asignada.
 */
export function useStockScope() {
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchScope = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/api/reportes/stock-scope');
      setScope(data);
    } catch (e) {
      setError(e?.response?.data?.error || 'No se pudo resolver el scope de bodega');
      setScope(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchScope(); }, [fetchScope]);

  return {
    loading,
    error,
    scope,
    bodegas: scope?.bodegas || [],
    defaultBodegaId: scope?.id_bodega_default || null,
    canAllBodegas: Boolean(scope?.can_all_bodegas),
    hasWarehouseRestrictions: Boolean(scope?.has_warehouse_restrictions),
    canViewExistencias: Boolean(scope?.can_view_existencias),
    refresh: fetchScope,
  };
}
