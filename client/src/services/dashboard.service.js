import api from './api';

/**
 * Generar arreglo con los últimos N días como labels.
 */
function lastDaysLabels(n) {
  const labels = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    labels.push(`${mm}/${dd}`);
  }
  return labels;
}

/**
 * Agrupa movimientos por día y cuenta entradas/salidas.
 */
function aggregateDaily(movements, days, tipo) {
  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    map[key] = 0;
  }
  for (const m of movements) {
    // Preferir `fecha` (DATE() calculado por MySQL en hora local) sobre
    // `creado_en` (datetime serializado a UTC: desfasa el día después de las 6pm).
    const raw = m.fecha || m.creado_en;
    if (!raw) continue;
    const key = String(raw).slice(0, 10);
    if (map[key] !== undefined) {
      map[key] += Number(m.cantidad || m.total_cantidad || 1);
    }
  }
  return map;
}

export const dashboardService = {
  /**
   * Obtener resumen del dashboard.
   * @param {object} opts - { days, mov_days, force }
   */
  async resumen(opts = {}) {
    const { data } = await api.get('/api/dashboard/resumen', {
      params: { days: 30, mov_days: 30, ...opts },
    });
    return data;
  },

  /**
   * Obtener tendencia diaria de entradas vs salidas (últimos N días).
   * @param {number} days - Días a incluir (default 7)
   */
  async trends(days = 7) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    const fmtFrom = from.toISOString().slice(0, 10);
    const fmtTo = now.toISOString().slice(0, 10);

    const params = { from: fmtFrom, to: fmtTo, limit: 2000 };

    const [entradasRes, salidasRes] = await Promise.all([
      api.get('/api/reportes/entradas', { params }),
      api.get('/api/reportes/salidas', { params }),
    ]);

    const entradas = Array.isArray(entradasRes.data) ? entradasRes.data : (entradasRes.data?.rows || []);
    const salidas = Array.isArray(salidasRes.data) ? salidasRes.data : (salidasRes.data?.rows || []);

    const entradasByDay = aggregateDaily(entradas, days, 'ENTRADA');
    const salidasByDay = aggregateDaily(salidas, days, 'SALIDA');

    const labels = lastDaysLabels(days);

    const trendData = labels.map((dia, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return {
        dia,
        entradas: entradasByDay[key] || 0,
        salidas: salidasByDay[key] || 0,
      };
    });

    return trendData;
  },
};
