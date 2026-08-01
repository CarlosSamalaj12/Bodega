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
 * El backend agrega por día en SQL (antes se descargaban 2 reportes con
 * limit=2000 y se agregaban en JS, lo que ralentizaba la Home).
 * @param {number} days - Días a incluir (default 7)
 */
async trends(days = 7) {
  const { data } = await api.get('/api/reportes/trends', {
    params: { days: Math.max(1, Math.min(90, Number(days) || 7)) },
  });
  const rows = Array.isArray(data) ? data : [];

  const labels = lastDaysLabels(days);

  // El backend devuelve [{ fecha: 'YYYY-MM-DD', entradas, salidas }]; aquí se
  // convierten a los labels MM/DD que espera el gráfico.
  const byFecha = new Map(rows.map((r) => [String(r.fecha || '').slice(0, 10), r]));

  const trendData = labels.map((dia, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = byFecha.get(key) || {};
    return {
      dia,
      entradas: Number(row.entradas || 0),
      salidas: Number(row.salidas || 0),
    };
  });

  return trendData;
},
};
