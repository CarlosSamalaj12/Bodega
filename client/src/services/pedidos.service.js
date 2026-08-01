import api from './api';

export const pedidosService = {
  /**
   * Listar pedidos.
   * @param scope 'mine' (los que pedí) o 'dispatch' (los que debo surtir)
   * @param status filtrar por estado
   * @param from fecha desde (YYYY-MM-DD)
   * @param to fecha hasta (YYYY-MM-DD)
   * @param limit máximo de filas (por defecto el servidor usa 500)
   */
  async list({ scope, status, from, to, limit } = {}) {
    const { data } = await api.get('/api/orders', {
      params: { scope, status, from, to, limit },
    });
    return data;
  },

  /**
   * Contar pedidos pendientes de despacho (PENDIENTE/APROBADO/PARCIAL).
   * Más liviano que descargar la lista completa solo para contar.
   */
  async countPendientes() {
    const { data } = await api.get('/api/pedidos/count-pendientes');
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
   * @param payload { lines: [{ id_pedido_detalle, qty }], justificacion }
   */
  async fulfill(id, payload) {
    const { data } = await api.post(`/api/orders/${id}/fulfill`, payload);
    return data;
  },

  /**
   * Confirmar recepcion del pedido con el PIN del solicitante.
   * @param id id_pedido
   * @param payload { pin }
   */
  async confirmReceipt(id, payload) {
    const { data } = await api.post(`/api/orders/${id}/confirm-receipt`, payload);
    return data;
  },

  /**
   * Anular una línea de pedido.
   * @param id id_pedido
   * @param payload { id_pedido_detalle, justificacion }
   */
  async cancelLine(id, payload) {
    const { data } = await api.post(`/api/orders/${id}/cancel-line`, payload);
    return data;
  },

  /**
   * Revertir TODO el despacho de un pedido (solo movimientos de hoy).
   * @param id id_pedido
   * @param payload { supervisor_pin? }
   */
  async revert(id, payload = {}) {
    const { data } = await api.post(`/api/orders/${id}/revert`, payload);
    return data;
  },

  /**
   * Revertir una línea específica de un pedido (solo movimientos de hoy).
   * @param id id_pedido
   * @param payload { id_pedido_detalle, supervisor_pin? }
   */
  async revertLine(id, payload) {
    const { data } = await api.post(`/api/orders/${id}/revert-line`, payload);
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

