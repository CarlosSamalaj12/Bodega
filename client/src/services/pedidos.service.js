import api from './api';

export const pedidosService = {
  /**
   * Listar pedidos.
   * @param scope 'mine' (los que pedí) o 'dispatch' (los que debo surtir)
   * @param status filtrar por estado
   */
  async list({ scope, status } = {}) {
    const { data } = await api.get('/api/orders', {
      params: { scope, status },
    });
    return data;
  },

  /**
   * Detalle de un pedido con sus líneas y stock disponible.
   */
  async getDetails(id) {
    const { data } = await api.get(`/api/orders/${id}/details`);
    return data;
  },

  /**
   * Crear un nuevo pedido.
   */
  async create(payload) {
    const { data } = await api.post('/api/orders', payload);
    return data;
  },

  /**
   * Despachar un pedido (parcial o total).
   * @param id id_pedido
   * @param payload { lines: [{ id_pedido_detalle, cantidad_surtida }], justificacion }
   */
  async fulfill(id, payload) {
    const { data } = await api.post(`/api/orders/${id}/fulfill`, payload);
    return data;
  },

  /**
   * Obtener el correlativo actual.
   */
  async getCorrelativo() {
    try {
      const { data } = await api.get('/api/pedidos/correlativo-actual');
      return data;
    } catch {
      return null;
    }
  },
};

