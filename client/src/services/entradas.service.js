import api from './api';

export const entradasService = {
  /**
   * Crear una nueva entrada con sus líneas.
   * @param {object} payload - { id_motivo, id_proveedor, no_documento, observaciones, pagado, lines: [{ id_producto, cantidad, precio, lote?, caducidad? }] }
   */
  async create(payload) {
    const { data } = await api.post('/api/entradas', payload);
    return data;
  },

  /**
   * Verifica si ya existe un documento igual para el usuario/bodega actual hoy.
   * Usado para detectar doble-click o reintentos accidentales.
   */
  async existeDocumento(no_documento) {
    if (!no_documento) return { exists: false };
    try {
      const { data } = await api.get('/api/entradas/existe-documento', {
        params: { no_documento },
      });
      return data;
    } catch {
      return { exists: false };
    }
  },
};
