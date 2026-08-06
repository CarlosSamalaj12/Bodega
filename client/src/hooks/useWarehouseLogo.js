import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

/**
 * useWarehouseLogo
 * - Carga el logo de impresión (o app si no hay print) de una bodega específica.
 * - Devuelve: { loading, logoDataUri, warehouseName, refresh }.
 *
 * Cuándo usar:
 *  - En páginas de Reporte para pasar el logo al exportar a PDF.
 *  - Cualquier lugar donde necesites el logo en formato data URI listo para
 *    incrustar en un PDF/imagen.
 *
 * Notas:
 *  - `idBodega` falsy → no carga nada, devuelve loading=false.
 *  - El endpoint puede devolver 404/403 si la bodega no existe o el usuario
 *    no tiene acceso. En ese caso, el hook degrada a logoDataUri=null sin
 *    tirar error.
 *  - Prefiere `logo_print_data` (más limpio para PDF), cae a `logo_app_data`
 *    si no hay.
 */
export function useWarehouseLogo(idBodega, warehouseName = null) {
  const [logoDataUri, setLogoDataUri] = useState(null);
  const [loading, setLoading] = useState(Boolean(idBodega));

  const fetchLogo = useCallback(async () => {
    const id = Number(idBodega || 0);
    if (!id) {
      setLogoDataUri(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/api/bodegas/${id}/logo`);
      // Preferencia: logo de impresión (mejor calidad para PDF), fallback al
      // de la app, fallback null.
      const uri = data?.logo_print_data || data?.logo_app_data || null;
      setLogoDataUri(uri);
    } catch {
      // 404 (no existe logo) o 403 (sin permiso): degradamos silencioso.
      setLogoDataUri(null);
    } finally {
      setLoading(false);
    }
  }, [idBodega]);

  useEffect(() => {
    fetchLogo();
  }, [fetchLogo]);

  return {
    loading,
    logoDataUri,
    warehouseName,
    refresh: fetchLogo,
  };
}
