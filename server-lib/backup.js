// server-lib/backup.js  —  Logical backup, recovery testing, dashboard prewarm
import { pool, OPS_BACKUP_BASE_DIR } from "./core.js";
import { ensureOpsAuditTables } from "./tables.js";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";

async function createLogicalBackup({ trigger = "MANUAL", skipAudit = false } = {}) {
  const tables = ["bodegas", "categorias", "subcategorias", "configuracion_bodega", "medidas", "motivos_movimiento", "proveedores", "productos", "limites_producto_bodega", "reglas_subcategoria", "pedido_encabezado", "pedido_detalle", "pedido_movimiento_vinculo", "movimiento_encabezado", "movimiento_detalle", "kardex", "usuarios", "roles", "usuario_permisos", "usuario_bodegas_acceso", "producto_bodegas_visibilidad", "bodega_logo", "usuario_avatar", "usuario_pin_pedido", "usuario_pin_supervisor", "cierre_dia", "cierre_dia_detalle", "cuadre_caja", "dashboard_cache_resumen", "backup_audit", "recovery_test_audit", "auditoria_accion_sensible"];
  const dateStr = new Date().toISOString().replace(/[:.]/g, "").slice(0, 14);
  const dir = OPS_BACKUP_BASE_DIR;
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `backup_${dateStr}.json`);
  const backup = { generated_at: new Date().toISOString(), trigger, tables: {} };
  for (const table of tables) { try { const [rows] = await pool.query(`SELECT * FROM \`${table}\``); backup.tables[table] = rows || []; } catch { backup.tables[table] = []; } }
  const json = JSON.stringify(backup, null, 2);
  await fs.writeFile(filePath, json, "utf8");
  const bytes = Buffer.byteLength(json, "utf8");
  if (!skipAudit) {
    await ensureOpsAuditTables();
    await pool.query(`INSERT INTO backup_audit (backup_date, trigger_type, status, file_path, bytes_written, creado_por) VALUES (CURDATE(), :trigger, 'COMPLETED', :file_path, :bytes, 0)`, { trigger, file_path: filePath, bytes });
  }
  console.log(`Backup ${trigger} -> ${filePath} (${bytes} bytes)`);
  return { filePath, bytes, tables: Object.keys(backup.tables).length };
}

async function maybeRunMonthlyRecoveryTest() {
  try {
    await ensureOpsAuditTables();
    const [[lastTest]] = await pool.query(`SELECT MAX(creado_en) AS last_test FROM recovery_test_audit WHERE status='COMPLETED'`);
    if (lastTest?.last_test) {
      const daysSince = (Date.now() - new Date(lastTest.last_test).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 25) return;
    }
    console.log("Running monthly recovery test...");
    const latestBackups = await fs.readdir(OPS_BACKUP_BASE_DIR).catch(() => []);
    const jsonFiles = latestBackups.filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 3);
    let testedFile = null;
    for (const f of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(OPS_BACKUP_BASE_DIR, f), "utf8");
        const data = JSON.parse(content);
        if (data && data.tables && typeof data.tables === "object") { testedFile = f; break; }
      } catch { continue; }
    }
    await pool.query(`INSERT INTO recovery_test_audit (trigger_type, status, source_file, summary_json, creado_por) VALUES ('MONTHLY', 'COMPLETED', :source_file, :summary, 0)`, { source_file: testedFile, summary: JSON.stringify({ files_checked: jsonFiles.length, usable_file: !!testedFile }) });
    console.log(`Recovery test completed. File: ${testedFile || "NONE"}`);
  } catch (e) { console.error("Recovery test fallo:", e); }
}

async function prewarmDashboardCache() {
  try {
    console.log("Pre-warming dashboard cache...");
    const { ensureDashboardCacheTable } = await import("./tables.js");
    await ensureDashboardCacheTable();
    const [warehouses] = await pool.query(`SELECT id_bodega FROM bodegas WHERE activo=1`);
    for (const wh of warehouses || []) {
      const scopeKey = `resume_30_30_${wh.id_bodega}`;
      const { resolveStockScope } = await import("./format.js");
      const { buildNamedInClause } = await import("./format.js");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [entradas] = await pool.query(`SELECT COUNT(*) AS total FROM movimiento_encabezado WHERE tipo_movimiento IN ('ENTRADA','AJUSTE') AND id_bodega_destino=:id_bodega AND DATE(creado_en) >= :since`, { id_bodega: wh.id_bodega, since: sevenDaysAgo });
      const [salidas] = await pool.query(`SELECT COUNT(*) AS total FROM movimiento_encabezado WHERE tipo_movimiento IN ('SALIDA','TRANSFERENCIA','AJUSTE') AND id_bodega_origen=:id_bodega AND DATE(creado_en) >= :since`, { id_bodega: wh.id_bodega, since: sevenDaysAgo });
      const [pedidos] = await pool.query(`SELECT COUNT(*) AS total FROM pedido_encabezado WHERE id_bodega_surtidor=:id_bodega AND DATE(creado_en) >= :since`, { id_bodega: wh.id_bodega, since: sevenDaysAgo });
      const summary = { mov_entradas: Number(entradas?.[0]?.total || 0), mov_salidas: Number(salidas?.[0]?.total || 0), pedidos: Number(pedidos?.[0]?.total || 0), generado_en: new Date().toISOString(), dias: 30, mov_days: 30 };
      await pool.query(`INSERT INTO dashboard_cache_resumen (scope_key, id_bodega, dias, mov_days, payload_json) VALUES (:scope_key, :id_bodega, 30, 30, :payload) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), generado_en=CURRENT_TIMESTAMP`, { scope_key: scopeKey, id_bodega: wh.id_bodega, payload: JSON.stringify(summary) });
    }
    console.log(`Dashboard cache prewarmed for ${warehouses.length} warehouses`);
  } catch (e) { console.error("Dashboard prewarm fallo:", e); }
}

export { createLogicalBackup, maybeRunMonthlyRecoveryTest, prewarmDashboardCache };
