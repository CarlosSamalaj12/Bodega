import api from './api';

export const usuariosService = {
  /**
   * Listar usuarios.
   * @param {boolean} all - incluir inactivos
   */
  async list(all = false) {
    const { data } = await api.get('/api/usuarios', {
      params: { all: all ? '1' : '0' },
    });
    return Array.isArray(data) ? data : [];
  },

  /**
   * Crear usuario.
   */
  async create(payload) {
    const { data } = await api.post('/api/usuarios', payload);
    return data;
  },

  /**
   * Actualizar usuario.
   */
  async update(id, payload) {
    const { data } = await api.patch(`/api/usuarios/${id}`, payload);
    return data;
  },

  /**
   * Desactivar usuario.
   */
  async deactivate(id) {
    const { data } = await api.post(`/api/usuarios/${id}/deactivate`);
    return data;
  },

  /**
   * Resetear contraseña.
   */
  async resetPassword(id, password) {
    const { data } = await api.post(`/api/usuarios/${id}/reset-password`, { password });
    return data;
  },

  /**
   * Resetear PIN de pedidos.
   */
  async resetOrderPin(id, pin) {
    const { data } = await api.post(`/api/usuarios/${id}/reset-order-pin`, { pin });
    return data;
  },

  /**
   * Obtener roles disponibles.
   */
  async getRoles() {
    const { data } = await api.get('/api/roles');
    return Array.isArray(data) ? data : [];
  },

  /**
   * Obtener permisos de un usuario.
   */
  async getPermisos(id) {
    const { data } = await api.get(`/api/usuarios/${id}/permisos`);
    return data; // { id_usuario, permisos: {}, catalogo: [] }
  },

  /**
   * Actualizar permisos de un usuario.
   */
  async updatePermisos(id, permisos) {
    const { data } = await api.put(`/api/usuarios/${id}/permisos`, { permisos });
    return data;
  },

  /**
   * Obtener bodegas de acceso de un usuario.
   */
  async getBodegasAcceso(id) {
    const { data } = await api.get(`/api/usuarios/${id}/bodegas-acceso`);
    return data; // { id_usuario, ids: [1,2,3], all: bool }
  },

  /**
   * Actualizar bodegas de acceso de un usuario.
   */
  async updateBodegasAcceso(id, ids) {
    const { data } = await api.put(`/api/usuarios/${id}/bodegas-acceso`, { ids });
    return data;
  },

  /**
   * Copia permisos (y opcionalmente bodegas-acceso) desde un usuario origen.
   * @param {number} targetId - id del usuario destino
   * @param {number} sourceId - id del usuario origen
   * @param {{ copy_permisos?: boolean, copy_bodegas?: boolean }} options
   */
  async copyFrom(targetId, sourceId, options = {}) {
    const { data } = await api.post(`/api/usuarios/${targetId}/copy-from/${sourceId}`, {
      copy_permisos: options.copy_permisos !== false,
      copy_bodegas: options.copy_bodegas === true,
    });
    return data;
  },
};
