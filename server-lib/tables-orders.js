// server-lib/tables-orders.js  —  Order dispatch column creation functions
import { pool } from "./core.js";

async function ensureOrderDispatchColumns() {
  const [estadoRows] = await pool.query(`SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_encabezado' AND COLUMN_NAME='estado' LIMIT 1`);
  const estadoType = String(estadoRows?.[0]?.column_type || "").toLowerCase();
  if (estadoType.startsWith("enum(") && !estadoType.includes("completado_justificado")) {
    const values = []; estadoType.replace(/'([^']*)'/g, (_, v) => { values.push(String(v || "").toUpperCase()); return ""; });
    if (!values.length) values.push("PENDIENTE", "APROBADO", "PARCIAL", "COMPLETADO", "CANCELADO");
    if (!values.includes("COMPLETADO_JUSTIFICADO")) values.push("COMPLETADO_JUSTIFICADO");
    await pool.query(`ALTER TABLE pedido_encabezado MODIFY COLUMN estado ENUM(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}) NOT NULL DEFAULT 'PENDIENTE'`);
  }
  const [headRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_encabezado' AND COLUMN_NAME='justificacion_despacho'`);
  if (Number(headRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_encabezado ADD COLUMN justificacion_despacho TEXT NULL`);
  const [lineStateRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='estado_linea'`);
  if (Number(lineStateRows?.[0]?.c || 0) <= 0) { await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN estado_linea VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'`); await pool.query(`UPDATE pedido_detalle SET estado_linea = CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 'DESPACHADO' ELSE 'PENDIENTE' END`); }
  const [lineJustRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='justificacion_linea'`);
  if (Number(lineJustRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN justificacion_linea VARCHAR(255) NULL`);
  const [lineCancelByRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='anulado_por'`);
  if (Number(lineCancelByRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN anulado_por INT NULL`);
  const [lineCancelAtRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='anulado_en'`);
  if (Number(lineCancelAtRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN anulado_en DATETIME NULL`);
}

export { ensureOrderDispatchColumns };
