// server-lib/sensitive-daily-close.js  —  Daily close enforcement and creation
import { pool } from "./core.js";
import { ensureDailyCloseTables } from "./tables.js";
import { resolveStockScope } from "./format.js";

async function enforceDailyCloseBeforeMutations(req, res, next) {
  try {
    await ensureDailyCloseTables();
    const id_bodega = Number(req.user?.id_warehouse || 0);
    if (!id_bodega) return next();
    const fecha_hoy = new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(`SELECT 1 AS c FROM cierre_dia WHERE id_bodega=:id_bodega AND fecha_cierre=:fecha LIMIT 1`, { id_bodega, fecha: fecha_hoy });
    if (rows.length > 0) {
      const scope = await resolveStockScope(req.user);
      if (!scope.can_all_bodegas) return res.status(403).json({ error: "El dia ya ha sido cerrado. No se pueden realizar movimientos.", code: "DAY_CLOSED" });
    }
    next();
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
}

async function createDailyCloseForDate(conn, { id_bodega, fecha_cierre, creado_por, origen = "MANUAL", observaciones = null }) {
  const idBodega = Number(id_bodega || 0);
  if (!idBodega) throw new Error("Bodega invalida");
  if (!fecha_cierre) throw new Error("Fecha invalida");
  const [[existing]] = await conn.query(`SELECT id_cierre FROM cierre_dia WHERE id_bodega=:id_bodega AND fecha_cierre=:fecha_cierre LIMIT 1`, { id_bodega: idBodega, fecha_cierre });
  if (existing) return { already_exists: true, id_cierre: Number(existing.id_cierre || 0), fecha_cierre };
  const [rows] = await conn.query(`SELECT p.id_producto, p.nombre_producto, p.sku, COALESCE(SUM(CASE WHEN k.creado_en < :fecha_cierre THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_inicial, COALESCE(SUM(CASE WHEN k.creado_en >= :fecha_cierre AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_dia, COALESCE(SUM(CASE WHEN k.creado_en >= :fecha_cierre AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_dia, COALESCE(SUM(k.delta_cantidad), 0) AS existencia_cierre FROM productos p LEFT JOIN (SELECT k.* FROM kardex k JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento AND me.estado<>'ANULADO' AND me.id_bodega_destino=:id_bodega) k ON k.id_producto=p.id_producto AND k.id_bodega=:id_bodega WHERE p.activo=1 GROUP BY p.id_producto, p.nombre_producto, p.sku HAVING ABS(existencia_inicial) > 0 OR ABS(entradas_dia) > 0 OR ABS(salidas_dia) > 0 OR ABS(existencia_cierre) > 0 ORDER BY p.nombre_producto ASC`, { id_bodega: idBodega, fecha_cierre });
  const [ch] = await conn.query(`INSERT INTO cierre_dia (id_bodega, fecha_cierre, total_entradas, total_salidas, total_existencia_cierre, creado_por, origen, observaciones) VALUES (:id_bodega, :fecha_cierre, :total_entradas, :total_salidas, :total_existencia_cierre, :creado_por, :origen, :observaciones)`, { id_bodega: idBodega, fecha_cierre, total_entradas: 0, total_salidas: 0, total_existencia_cierre: 0, creado_por: creado_por || null, origen, observaciones: observaciones || null });
  const id_cierre = ch.insertId;
  let total_entradas = 0, total_salidas = 0, total_existencia_cierre = 0;
  for (const r of rows || []) {
    await conn.query(`INSERT INTO cierre_dia_detalle (id_cierre, id_producto, sku, nombre_producto, existencia_inicial, entradas_dia, salidas_dia, existencia_cierre) VALUES (:id_cierre, :id_producto, :sku, :nombre_producto, :existencia_inicial, :entradas_dia, :salidas_dia, :existencia_cierre)`, { id_cierre, id_producto: r.id_producto, sku: r.sku, nombre_producto: r.nombre_producto, existencia_inicial: Number(r.existencia_inicial || 0), entradas_dia: Number(r.entradas_dia || 0), salidas_dia: Number(r.salidas_dia || 0), existencia_cierre: Number(r.existencia_cierre || 0) });
    total_entradas += Number(r.entradas_dia || 0);
    total_salidas += Number(r.salidas_dia || 0);
    total_existencia_cierre += Number(r.existencia_cierre || 0);
  }
  await conn.query(`UPDATE cierre_dia SET total_entradas=:total_entradas, total_salidas=:total_salidas, total_existencia_cierre=:total_existencia_cierre WHERE id_cierre=:id_cierre`, { id_cierre, total_entradas, total_salidas, total_existencia_cierre });
  return { id_cierre, fecha_cierre, already_exists: false, rows, total_entradas, total_salidas, total_existencia_cierre };
}

export { enforceDailyCloseBeforeMutations, createDailyCloseForDate };
