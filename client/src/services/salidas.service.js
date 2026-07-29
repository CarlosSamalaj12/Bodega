import api from './api';

/**
 * Agrupa líneas del reporte por id_movimiento y devuelve resúmenes.
 * Conserva el array de líneas para que el cliente pueda renderizarlas.
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
        hora: r.hora,
        nombre_bodega: r.nombre_bodega,
        nombre_motivo: r.nombre_motivo,
        no_documento: r.no_documento,
        usuario_creador: r.usuario_creador,
        observaciones: r.observaciones,
        estado: r.estado,
        anulado_por: r.anulado_por,
        anulado_en: r.anulado_en,
        anulado_por_usuario: r.anulado_por_usuario,
        tipo: r.tipo_salida || r.tipo_movimiento || 'SALIDA',
        lineas: [],
        total_lineas: 0,
        total_cantidad: 0,
        total_costo: 0,
      });
    }
    const m = map.get(id);
    m.lineas.push({
      id_detalle: r.id_detalle,
      id_producto: r.id_producto,
      nombre_producto: r.nombre_producto,
      sku: r.sku,
      nombre_categoria: r.nombre_categoria,
      nombre_subcategoria: r.nombre_subcategoria,
      lote: r.lote,
      fecha_vencimiento: r.fecha_vencimiento,
      cantidad: Number(r.cantidad || 0),
      costo_unitario: Number(r.costo_unitario || 0),
      total_linea: Number(r.total_linea || 0),
    });
    m.total_lineas += 1;
    m.total_cantidad += Number(r.cantidad || 0);
    m.total_costo += Number(r.total_linea || 0);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );
}

export const salidasService = {
  /**
   * Listar salidas como filas planas (una por línea de detalle).
   */
  async list(opts = {}) {
    const { data } = await api.get('/api/reportes/salidas', {
      params: { limit: 500, ...opts },
    });
    return Array.isArray(data) ? data : (data?.rows || []);
  },

  /**
   * Listar salidas agrupadas por movimiento (con líneas).
   */
  async listAgrupado(opts = {}) {
    const rows = await this.list(opts);
    return agruparMovimientos(rows);
  },

  /**
   * Obtener detalle completo de una salida (con líneas).
   */
  async getDetail(id) {
    const rows = await this.list({});
    const lines = (rows || []).filter((r) => Number(r.id_movimiento) === Number(id));
    if (!lines.length) {
      const grouped = agruparMovimientos(rows);
      return grouped.find((m) => m.id_movimiento === Number(id)) || null;
    }
    const first = lines[0];
    return {
      id_movimiento: Number(id),
      fecha: first.creado_en || first.fecha,
      tipo: first.tipo_salida || first.tipo_movimiento,
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
   * Crear una nueva salida con sus líneas.
   */
  async create(payload) {
    const { data } = await api.post('/api/salidas', payload);
    return data;
  },

  /**
   * Revertir una salida (crea movimiento inverso y anula el original).
   * Requiere PIN de supervisor.
   */
  async revert(id, supervisorPin) {
    const { data } = await api.post(`/api/movimientos/${Number(id)}/revert`, {
      supervisor_pin: supervisorPin,
    });
    return data;
  },
};
