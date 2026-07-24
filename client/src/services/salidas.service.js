import api from './api';

export const salidasService = {
  /**
   * Crear una nueva salida con sus líneas.
   * @param {object} payload - { id_motivo, id_proveedor, no_documento, observaciones, lines: [{ id_producto, cantidad, precio, lote? }] }
   */
  async create(payload) {
    const { data } = await api.post('/api/salidas', payload);
    return data;
  },
};
