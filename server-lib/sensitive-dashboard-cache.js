// server-lib/sensitive-dashboard-cache.js  —  Dashboard cache reading
import { pool } from "./core.js";
import { ensureDashboardCacheTable } from "./tables.js";

async function readDashboardResumenCache(scope_key) {
  try {
    await ensureDashboardCacheTable();
    const [[row]] = await pool.query(`SELECT scope_key, payload_json, generado_en FROM dashboard_cache_resumen WHERE scope_key=:scope_key LIMIT 1`, { scope_key });
    if (row?.payload_json) return { ...JSON.parse(row.payload_json), _cache_hit: true, _cached_at: row.generado_en };
  } catch { /* ignore */ }
  return null;
}

export { readDashboardResumenCache };
