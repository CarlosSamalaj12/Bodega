/**
 * Formatea una fecha ISO (YYYY-MM-DD o ISO datetime) a DD-MM-YYYY.
 * Si el valor es nulo/vacío devuelve '—'.
 */
export function formatDate(val) {
  if (!val) return '—';
  const s = String(val).slice(0, 10);
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}-${m}-${y}`;
}
