import api from './api';

export const productosService = {
  async list({ q = '', all = false, limit = 200, signal } = {}) {
    const { data } = await api.get('/api/productos', {
      params: { q, all: all ? 1 : undefined, limit },
      signal,
    });
    return data;
  },

  async search({ q, warehouse, signal } = {}) {
    const { data } = await api.get('/api/productos/search', {
      params: { q, warehouse },
      signal,
    });
    return data;
  },

  async create(payload) {
    const { data } = await api.post('/api/productos', payload);
    return data;
  },

  async update(id, payload) {
    const { data } = await api.patch(`/api/productos/${id}`, payload);
    return data;
  },

  async getVisibilidad(id) {
    const { data } = await api.get(`/api/productos/${id}/bodegas-visibles`);
    return data;
  },

  async toggleVisibilidadMiBodega(id, visible) {
    const { data } = await api.post(
      `/api/productos/${id}/visibilidad-mi-bodega`,
      { visible: visible ? 1 : 0 }
    );
    return data;
  },
};
