import api from './api';

export const existenciasService = {
  /**
   * Obtener existencias actuales (stock por producto/lote/bodega).
   * @param {object} opts - { q, warehouse, categoria, subcategoria, from, to, limit }
   */
  async list(opts = {}) {
    const { data } = await api.get('/api/reportes/existencias', {
      params: { limit: 100, ...opts },
    });
    // Returns { rows, total, page, limit, totalPages } from server
    return data;
  },

  /**
   * Obtener alertas de stock (productos próximos a vencer o con reglas de subcategoría).
   * @param {object} opts - { q, days, warehouse, categoria, subcategoria, from, to, limit }
   */
  async alertas(opts = {}) {
    const { data } = await api.get('/api/reportes/existencias/alertas', {
      params: { limit: 500, ...opts },
    });
    return Array.isArray(data) ? data : [];
  },

  /**
   * Obtener alertas de stock mínimo (productos por debajo del mínimo configurado).
   * @param {object} opts - { q, warehouse, categoria, subcategoria }
   */
  async stockMinimo(opts = {}) {
    const { data } = await api.get('/api/reportes/existencias/stock-minimo', {
      params: { limit: 500, ...opts },
    });
    return Array.isArray(data) ? data : [];
  },
};
