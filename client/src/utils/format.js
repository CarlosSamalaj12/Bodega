/**
 * Formatea una fecha ISO (YYYY-MM-DD o ISO datetime) a DD-MM-YYYY.
 * Si el valor es nulo/vacío devuelve '—'.
 */
export function formatDate(val) {
  if (!val) return '—';
  
  if (typeof val === 'string' && val.length === 10 && val.includes('-') && !val.includes('T')) {
    const [y, m, d] = val.split('-');
    if (y && m && d) return `${d}-${m}-${y}`;
  }
  
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      const s = String(val).slice(0, 10);
      const [y, m, day] = s.split('-');
      if (y && m && day) return `${day}-${m}-${y}`;
      return String(val);
    }
    
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return String(val);
  }
}
