import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';

/**
 * Hook genérico para CRUD de catálogos.
 *
 * @param {object} config
 * @param {string} config.endpoint - ej: '/api/categorias'
 * @param {Function} [config.toForm] - transforma item del backend a valores del form
 * @param {Function} [config.toBody] - transforma valores del form al body del backend
 * @param {Function} [config.mapRow] - transforma item para mostrarlo (opcional)
 * @param {Function} [config.validate] - valida el form, devuelve string de error o null
 */
export function useCatalog({
  endpoint,
  toForm = (x) => x,
  toBody = (x) => x,
  mapRow = (x) => x,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(endpoint);
      setItems(Array.isArray(data) ? data.map(mapRow) : []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, mapRow]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const create = useCallback(async (values) => {
    const body = toBody(values);
    const { data } = await api.post(endpoint, body);
    await fetchAll();
    return data;
  }, [endpoint, toBody, fetchAll]);

  const update = useCallback(async (id, values) => {
    const body = toBody(values);
    const { data } = await api.patch(`${endpoint}/${id}`, body);
    await fetchAll();
    return data;
  }, [endpoint, toBody, fetchAll]);

  return {
    items, loading, error,
    toForm, mapRow,
    fetchAll, create, update,
  };
}
