import api from './api';

/**
 * Agrupa líneas del reporte por id_movimiento y devuelve resúmenes.
 */
function agruparMovimientos(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const id = Number(r.id_movimiento);
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, {
        id_movimiento: id,
        fecha: r.creado_en || r.fecha,
        tipo: r.tipo_entrada || 'ENTRADA',
        no_documento: r.no_documento || null,
        observaciones: r.observaciones || null,
        estado: r.estado || null,
        anulado_por: r.anulado_por || null,
        anulado_en: r.anulado_en || null,
        anulado_por_usuario: r.anulado_por_usuario || null,
        nombre_motivo: r.nombre_motivo || '—',
        id_motivo: r.id_motivo,
        usuario_creador: r.usuario_creador || '—',
        bodega: r.nombre_bodega || '—',
        total_lineas: 0,
        total_cantidad: 0,
        total_costo: 0,
      });
    }
    const m = map.get(id);
    m.total_lineas += 1;
    m.total_cantidad += Number(r.cantidad || 0);
    m.total_costo += Number(r.total_linea || 0);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );
}

export const entradasService = {
  /**
   * Listar entradas (resumen por movimiento).
   * @param {object} opts - { q, lote, documento, from, to, categoria, subcategoria, motivo, limit }
   */
  async list(opts = {}) {
    const { data } = await api.get('/api/reportes/entradas', {
      params: { limit: 100, ...opts },
    });
    return agruparMovimientos(data);
  },

  /**
   * Obtener detalle completo de una entrada (con líneas).
   * Carga el reporte y filtra por id_movimiento en cliente.
   */
  async getDetail(id) {
    const { data } = await api.get('/api/reportes/entradas', {
      params: { limit: 500 },
    });
    const lines = (data || []).filter((r) => Number(r.id_movimiento) === Number(id));
    if (!lines.length) {
      return agruparMovimientos(data).find((m) => m.id_movimiento === Number(id)) || null;
    }
    const first = lines[0];
    return {
      id_movimiento: Number(id),
      fecha: first.creado_en || first.fecha,
      tipo: first.tipo_entrada,
      no_documento: first.no_documento,
      observaciones: first.observaciones,
      estado: first.estado || null,
      anulado_por: first.anulado_por || null,
      anulado_en: first.anulado_en || null,
      anulado_por_usuario: first.anulado_por_usuario || null,
      nombre_motivo: first.nombre_motivo,
      id_motivo: first.id_motivo,
      usuario_creador: first.usuario_creador,
      bodega: first.nombre_bodega,
      lines,
    };
  },

  /**
   * Crear una nueva entrada con sus líneas.
   */
  async create(payload) {
    const { data } = await api.post('/api/entradas', payload);
    return data;
  },

  /**
   * Revertir una entrada (crea movimiento inverso y anula el original).
   */
  async revert(id) {
    const { data } = await api.post(`/api/movimientos/${Number(id)}/revert`);
    return data;
  },

  /**
   * Verifica si ya existe un documento igual.
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
