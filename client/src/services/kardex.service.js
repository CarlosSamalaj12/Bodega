import api from './api';

export const kardexService = {
  /**
   * Obtener movimientos de kardex (historial de producto).
   * @param {object} opts - { q, producto, tipo, from, to, categoria, subcategoria, lote, documento, warehouse, limit }
   */
  async list(opts = {}) {
    const { data } = await api.get('/api/reportes/kardex', {
      params: { limit: 100, ...opts },
    });
    // Returns { rows, total, page, limit, totalPages }
    return data;
  },
};
