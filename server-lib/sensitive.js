// server-lib/sensitive.js  —  Sensitive action approval, daily close, dashboard cache
import { pool, DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS } from "./core.js";
import { ensureSensitiveActionAuditTable, ensureDashboardCacheTable } from "./tables.js";

async function verifySensitiveApproval(req, conn, actionLabel) {
  if (!req.user || !req.body) return { ok: true, method: "NO_OP", message: "No se requiere aprobacion sensible" };
  const alreadyApproved = req.sensitive_approval?.ok;
  if (alreadyApproved) return req.sensitive_approval;
  const supervisorPin = String(req.body?.supervisor_pin || req.body?.approval_supervisor_pin || "").trim();
  const supervisorUserId = Number(req.body?.supervisor_user_id || req.body?.approval_supervisor_user_id || 0);
  if (!supervisorPin || !supervisorUserId) return { ok: true, method: "NO_PIN", message: "Sin PIN supervisor — se omite validacion sensible" };
  const { isValidSupervisorPin, bcrypt } = await Promise.all([import("./format.js"), import("./core.js")]);
  if (!isValidSupervisorPin(supervisorPin)) return { ok: false, status: 400, error: "El PIN del supervisor debe tener entre 6 y 12 digitos" };
  const [[userRow]] = await conn.query(`SELECT u.id_usuario, u.nombre_completo, u.activo, ups.pin_hash FROM usuarios u LEFT JOIN usuario_pin_supervisor ups ON ups.id_usuario=u.id_usuario WHERE u.id_usuario=:id_usuario LIMIT 1`, { id_usuario: supervisorUserId });
  if (!userRow || Number(userRow.activo || 0) !== 1) return { ok: false, status: 400, error: "Supervisor no valido" };
  if (!userRow.pin_hash) return { ok: false, status: 400, error: "El supervisor no tiene PIN configurado" };
  const bcryptMod = await import("bcryptjs");
  const pinOk = await bcryptMod.default.compare(supervisorPin, userRow.pin_hash || "");
  if (!pinOk) {
    const { trackPinFailure } = await import("./core.js");
    trackPinFailure("supervisor", { supervisor_user_id: supervisorUserId, actor_user_id: Number(req.user?.id_user || 0) });
    return { ok: false, status: 401, error: "PIN de supervisor invalido" };
  }
  return {
    ok: true, method: "SUPERVISOR_PIN", supervisor_user_id: supervisorUserId, supervisor_usuario: String(userRow.nombre_completo || `#${supervisorUserId}`),
    actor_label: `${actionLabel}`,
  };
}

function toSensitiveApprovalPayload(approval) {
  if (!approval || !approval.ok) return null;
  return { method: approval.method || "UNKNOWN", supervisor_user_id: approval.supervisor_user_id || null, supervisor_usuario: approval.supervisor_usuario || null, actor_label: approval.actor_label || null };
}

async function writeSensitiveActionAudit({ req, action_key, action_label, approval, reference_type, reference_id, detail }) {
  try {
    await ensureSensitiveActionAuditTable();
    const actorId = Number(req.user?.id_user || 0);
    const actorName = String(req.user?.full_name || "").trim() || "Sistema";
    const actorWarehouse = Number(req.user?.id_warehouse || 0);
    const supervisorId = Number(approval?.supervisor_user_id || 0) || null;
    const supervisorUser = String(approval?.supervisor_usuario || "").trim() || null;
    const approvalMethod = String(approval?.method || "NO_OP");
    await pool.query(`INSERT INTO auditoria_accion_sensible (action_key, action_label, endpoint, http_method, id_usuario_actor, actor_nombre, id_bodega_actor, id_usuario_supervisor, supervisor_usuario, supervisor_nombre, approval_method, reference_type, reference_id, detail_json) VALUES (:action_key, :action_label, :endpoint, :http_method, :id_usuario_actor, :actor_nombre, :id_bodega_actor, :id_usuario_supervisor, :supervisor_usuario, :supervisor_nombre, :approval_method, :reference_type, :reference_id, :detail_json)`, {
      action_key, action_label, endpoint: req.path || null, http_method: req.method || null, id_usuario_actor: actorId, actor_nombre: actorName, id_bodega_actor: actorWarehouse || null, id_usuario_supervisor: supervisorId, supervisor_usuario: supervisorUser, supervisor_nombre: supervisorUser, approval_method: approvalMethod, reference_type: reference_type || null, reference_id: reference_id || null, detail_json: detail ? JSON.stringify(detail) : null,
    });
  } catch (e) { console.error("Error al escribir auditoria sensible:", e); }
}

function requireSensitiveApproval(actionLabel = "esta accion") {
  return (req, res, next) => {
    req.sensitive_approval_check = { label: actionLabel };
    next();
  };
}

async function enforceDailyCloseBeforeMutations(req, res, next) {
  try {
    const { ensureDailyCloseTables } = await import("./tables.js");
    await ensureDailyCloseTables();
    const id_bodega = Number(req.user?.id_warehouse || 0);
    if (!id_bodega) return next();
    const fecha_hoy = new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(`SELECT 1 AS c FROM cierre_dia WHERE id_bodega=:id_bodega AND fecha_cierre=:fecha LIMIT 1`, { id_bodega, fecha: fecha_hoy });
    if (rows.length > 0) {
      const { resolveStockScope } = await import("./format.js");
      const scope = await resolveStockScope(req.user);
      if (!scope.can_all_bodegas) return res.status(403).json({ error: "El dia ya ha sido cerrado. No se pueden realizar movimientos.", code: "DAY_CLOSED" });
    }
    next();
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
}


async function readDashboardResumenCache(scope_key) {
  try {
    const { ensureDashboardCacheTable } = await import("./tables.js");
    await ensureDashboardCacheTable();
    const [[row]] = await pool.query(`SELECT scope_key, payload_json, generado_en FROM dashboard_cache_resumen WHERE scope_key=:scope_key LIMIT 1`, { scope_key });
    if (row?.payload_json) return { ...JSON.parse(row.payload_json), _cache_hit: true, _cached_at: row.generado_en };
  } catch { /* ignore */ }
  return null;
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

export {
  verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit,
  requireSensitiveApproval, enforceDailyCloseBeforeMutations,
  readDashboardResumenCache, createDailyCloseForDate,
  DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS,
};
