import api from './api';

export const catalogosService = {
  async getCategorias(signal) {
    const { data } = await api.get('/api/categorias', { signal });
    return data;
  },
  async getSubcategorias(signal, categoriaId) {
    const params = {};
    if (categoriaId) params.categoria = categoriaId;
    const { data } = await api.get('/api/subcategorias', { signal, params });
    return data;
  },
  async getMedidas(signal) {
    const { data } = await api.get('/api/medidas', { signal });
    return data;
  },
  async getBodegas(signal) {
    const { data } = await api.get('/api/bodegas', { signal });
    return data;
  },
  async getProveedores(signal) {
    const { data } = await api.get('/api/proveedores', { signal });
    return data;
  },
  async getMotivos(signal) {
    const { data } = await api.get('/api/motivos', { signal });
    return data;
  },
  async getMotivosJustificacion(signal) {
    const { data } = await api.get('/api/motivos-justificacion', { signal });
    return data;
  },
  async crearMotivoJustificacion(texto) {
    const { data } = await api.post('/api/motivos-justificacion', { texto });
    return data;
  },
  async actualizarMotivoJustificacion(id, texto) {
    const { data } = await api.put(`/api/motivos-justificacion/${id}`, { texto });
    return data;
  },
  async eliminarMotivoJustificacion(id) {
    const { data } = await api.delete(`/api/motivos-justificacion/${id}`);
    return data;
  },
  async restablecerMotivosJustificacion() {
    const { data } = await api.post('/api/motivos-justificacion/restablecer');
    return data;
  },
};

