// server-orders-despacho.js  |  Order dispatch, revert, cancel/uncancel line routes
import { pool, auth, requirePermission, enforceDailyCloseBeforeMutations, requireSensitiveApproval, beginIdempotentRequest, writeSensitiveActionAudit, emitPedidoChanged, pickLotsFEFO, getLastUnitCost, toSensitiveApprovalPayload } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

async function recomputePedidoEstado(conn, id_pedido, opts = {}) {
  const actorUserId = Number(opts?.actorUserId || 0) || null;
  const justificacion = String(opts?.justificacion || "").trim();
  const [aggRows] = await conn.query(
    `SELECT COUNT(*) AS total_lineas,
            SUM(CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 1 ELSE 0 END) AS lineas_anuladas,
            SUM(CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 1 ELSE 0 END) AS lineas_completas_qty,
            SUM(CASE WHEN cantidad_surtida > 0 AND cantidad_surtida < cantidad_solicitada THEN 1 ELSE 0 END) AS lineas_parciales_qty,
            SUM(cantidad_solicitada) AS total_solicitado,
            SUM(cantidad_surtida) AS total_surtido
     FROM pedido_detalle WHERE id_pedido=:id_pedido`,
    { id_pedido }
  );
  const agg = aggRows?.[0] || {};
  const totalLineas = Number(agg.total_lineas || 0);
  const lineasAnuladas = Number(agg.lineas_anuladas || 0);
  const lineasCompletasQty = Number(agg.lineas_completas_qty || 0);
  const lineasParcialesQty = Number(agg.lineas_parciales_qty || 0);
  const totalSurtido = Number(agg.total_surtido || 0);
  const hasAnyJustified = lineasAnuladas > 0 || lineasParcialesQty > 0;
  const lineasResueltas = lineasAnuladas + lineasCompletasQty;

  let estado = "PENDIENTE";
  if (totalLineas > 0 && lineasResueltas >= totalLineas) {
    estado = hasAnyJustified ? "COMPLETADO_JUSTIFICADO" : "COMPLETADO";
  } else if (totalSurtido > 0 || lineasAnuladas > 0) {
    estado = "PARCIAL";
  }

  if (estado === "COMPLETADO") {
    await conn.query(`UPDATE pedido_encabezado SET estado=:estado, justificacion_despacho=NULL, aprobado_por=COALESCE(:aprobado_por, aprobado_por), aprobado_en=NOW() WHERE id_pedido=:id_pedido`,
      { estado, aprobado_por: actorUserId, id_pedido });
    return { estado, justificacion_despacho: null };
  }
  if (justificacion && (estado === "PARCIAL" || estado === "COMPLETADO_JUSTIFICADO")) {
    const [[head]] = await conn.query(`SELECT justificacion_despacho FROM pedido_encabezado WHERE id_pedido=:id_pedido LIMIT 1`, { id_pedido });
    const current = String(head?.justificacion_despacho || "").trim();
    const finalJust = !current ? justificacion : current.toLowerCase() === justificacion.toLowerCase() ? current : `${current} | ${justificacion}`;
    await conn.query(`UPDATE pedido_encabezado SET estado=:estado, justificacion_despacho=:justificacion, aprobado_por=COALESCE(:aprobado_por, aprobado_por), aprobado_en=NOW() WHERE id_pedido=:id_pedido`,
      { estado, justificacion: finalJust, aprobado_por: actorUserId, id_pedido });
    return { estado, justificacion_despacho: finalJust };
  }
  await conn.query(`UPDATE pedido_encabezado SET estado=:estado, aprobado_por=COALESCE(:aprobado_por, aprobado_por), aprobado_en=NOW() WHERE id_pedido=:id_pedido`,
    { estado, aprobado_por: actorUserId, id_pedido });
  const [[head]] = await conn.query(`SELECT justificacion_despacho FROM pedido_encabezado WHERE id_pedido=:id_pedido LIMIT 1`, { id_pedido });
  return { estado, justificacion_despacho: head?.justificacion_despacho || null };
}

router.post("/api/orders/:id/fulfill", auth, requirePermission("action.dispatch", "despachar pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) return res.status(400).json({ error: "Pedido invalido" });
  const { lines = [], justificacion = null } = req.body || {};
  const justificacionTxt = String(justificacion || "").trim();
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas a despachar" });
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/orders/${id_pedido}/fulfill` })) return res.status(409).json({ error: "Solicitud duplicada detectada." });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pe]] = await conn.query("SELECT * FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE", { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) return res.status(403).json({ error: "No puedes despachar pedidos de otra bodega" });
    if (pe.estado === "CANCELADO" || pe.estado === "COMPLETADO" || pe.estado === "COMPLETADO_JUSTIFICADO") return res.status(400).json({ error: "Pedido no despachable" });

    const [[cfg]] = await conn.query(`SELECT cb.modo_despacho_auto, cb.maneja_stock, b.tipo_bodega FROM configuracion_bodega cb JOIN bodegas b ON b.id_bodega=cb.id_bodega WHERE cb.id_bodega=:id`, { id: pe.id_bodega_solicita });
    const useTransfer = cfg?.tipo_bodega === "RECEPTORA" || cfg?.modo_despacho_auto === "TRANSFERENCIA";
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";
    const [[solUser]] = await conn.query(`SELECT nombre_completo FROM usuarios WHERE id_usuario=:id_usuario LIMIT 1`, { id_usuario: pe.id_usuario_solicita });
    const solicitanteNombre = String(solUser?.nombre_completo || `Usuario #${pe.id_usuario_solicita}`);
    const [[mot]] = await conn.query(`SELECT id_motivo FROM motivos_movimiento WHERE (nombre_motivo='Transferencia' AND :tipo='TRANSFERENCIA') OR (:tipo='SALIDA' AND tipo_movimiento='SALIDA') ORDER BY (nombre_motivo='Transferencia') DESC LIMIT 1`, { tipo: tipo_mov });
    if (!mot) return res.status(400).json({ error: "No existe motivo para el movimiento" });

    const [mhRes] = await conn.query(`INSERT INTO movimiento_encabezado (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado) VALUES(:tipo, :id_motivo, :origen, :destino, :obs, :u, NOW(), 'CONFIRMADO')`,
      { tipo: tipo_mov, id_motivo: mot.id_motivo, origen: pe.id_bodega_surtidor, destino: pe.id_bodega_solicita, obs: `Despacho Pedido #${id_pedido} | Solicitante: ${solicitanteNombre}`, u: req.user.id_user });
    const id_movimiento = mhRes.insertId;

    let anyFulfilled = false, requiresJustificacion = false;
    const skipped = [];
    for (const ln of lines) {
      const id_pedido_detalle = Number(ln.id_pedido_detalle);
      const qtyToFill = Number(ln.qty || 0);
      if (!id_pedido_detalle || qtyToFill <= 0) continue;
      const [[line]] = await conn.query(`SELECT * FROM pedido_detalle WHERE id_pedido_detalle=:id AND id_pedido=:id_pedido FOR UPDATE`, { id: id_pedido_detalle, id_pedido });
      if (!line) continue;
      if (String(line.estado_linea || "").toUpperCase() === "ANULADO") { skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "LINEA_ANULADA" }); continue; }
      const remainingToFill = Number(line.cantidad_solicitada) - Number(line.cantidad_surtida);
      if (remainingToFill <= 0) continue;
      if (qtyToFill < remainingToFill) requiresJustificacion = true;
      const { picks } = await pickLotsFEFO(conn, pe.id_bodega_surtidor, line.id_producto, qtyToFill, { allowExpired: false });
      if (!picks.length) { requiresJustificacion = true; skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "SIN_STOCK_NO_VIGENTE" }); continue; }
      anyFulfilled = true;
      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, pe.id_bodega_surtidor, line.id_producto, p.lote);
        const [d] = await conn.query(`INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea) VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:obs)`,
          { id_movimiento, id_producto: line.id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, cantidad: p.qty, costo: costo_unitario, obs: `Pedido #${id_pedido}` });
        const id_detalle = d.insertId;
        await conn.query(`INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario) VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          { id_movimiento, id_detalle, id_bodega: pe.id_bodega_surtidor, id_producto: line.id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, delta: -p.qty, costo: costo_unitario });
        if (useTransfer && cfg?.maneja_stock === 1) {
          await conn.query(`INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario) VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            { id_movimiento, id_detalle, id_bodega: pe.id_bodega_solicita, id_producto: line.id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, delta: +p.qty, costo: costo_unitario });
        }
        await conn.query(`INSERT INTO pedido_movimiento_vinculo (id_pedido_detalle, id_movimiento, id_detalle) VALUES(:id_pedido_detalle,:id_movimiento,:id_detalle)`, { id_pedido_detalle, id_movimiento, id_detalle });
      }
      const fulfilledNow = picks.reduce((a, b) => a + Number(b.qty), 0);
      if (Number(line.cantidad_surtida) + fulfilledNow < Number(line.cantidad_solicitada)) requiresJustificacion = true;
      await conn.query(`UPDATE pedido_detalle SET cantidad_surtida = cantidad_surtida + :add, estado_linea = CASE WHEN (cantidad_surtida + :add) >= cantidad_solicitada THEN 'DESPACHADO' ELSE 'PENDIENTE' END, justificacion_linea = CASE WHEN :justificacion IS NULL OR :justificacion='' THEN justificacion_linea WHEN (cantidad_surtida + :add) < cantidad_solicitada THEN :justificacion ELSE justificacion_linea END WHERE id_pedido_detalle=:id`,
        { add: fulfilledNow, id: id_pedido_detalle, justificacion: justificacionTxt || null });
    }
    if (!anyFulfilled) { await conn.rollback(); return res.status(400).json({ error: "Sin stock en las lineas seleccionadas", skipped }); }
    if (requiresJustificacion && !justificacionTxt) { await conn.rollback(); return res.status(400).json({ error: "Para despacho parcial debes ingresar una justificacion." }); }
    const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId: req.user.id_user, justificacion: justificacionTxt || null });
    await conn.commit();
    emitPedidoChanged({ id_pedido, requester_warehouse_id: pe.id_bodega_solicita, requested_from_warehouse_id: pe.id_bodega_surtidor, status: recalc.estado, action: "fulfilled" });
    res.json({ ok: true, id_movimiento, status: recalc.estado, justificacion_despacho: recalc.justificacion_despacho || null, skipped });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: String(e.message || e) }); } finally { conn.release(); }
});

router.post("/api/orders/:id/revert", auth, requirePermission("action.dispatch", "revertir despachos"), requireSensitiveApproval("reversa de despacho"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pe]] = await conn.query("SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido", { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    const [links] = await conn.query(`SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad FROM pedido_movimiento_vinculo pmv JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento WHERE pmv.id_pedido_detalle IN (SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido=:id_pedido) AND DATE(me.creado_en)=CURDATE()`, { id_pedido });
    if (!links.length) return res.status(400).json({ error: "No hay movimientos reversibles hoy" });
    const movIds = [...new Set(links.map((x) => x.id_movimiento))];
    const id_bodega_destino = Number(pe.id_bodega_solicita || 0);
    if (id_bodega_destino) {
      const [destRows] = await conn.query(`SELECT COUNT(*) as cnt FROM kardex k WHERE k.id_bodega = ? AND k.delta_cantidad < 0 AND k.id_producto IN (SELECT pd.id_producto FROM pedido_detalle pd WHERE pd.id_pedido = ? AND pd.cantidad_surtida > 0) AND k.id_movimiento NOT IN (${movIds.map(() => "?").join(",")})`, [id_bodega_destino, id_pedido, ...movIds]);
      if (Number(destRows[0]?.cnt || 0) > 0) { await conn.rollback(); return res.status(409).json({ error: "No se puede revertir: la bodega destino ya realizo movimientos de salida con los productos recibidos.", code: "DESTINATION_HAS_MOVEMENTS" }); }
    }
    for (const ln of links) {
      await conn.query(`UPDATE pedido_detalle SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0), estado_linea = CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO' WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO' ELSE 'PENDIENTE' END WHERE id_pedido_detalle=:id`, { qty: ln.cantidad, id: ln.id_pedido_detalle });
    }
    await conn.query(`DELETE FROM kardex WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM pedido_movimiento_vinculo WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM movimiento_detalle WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM movimiento_encabezado WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId: req.user.id_user });
    await conn.commit();
    await writeSensitiveActionAudit({ req, action_key: "REVERSA_DESPACHO_TOTAL", action_label: "Reversa total de despacho", approval: req.sensitive_approval, reference_type: "PEDIDO", reference_id: id_pedido, detail: { movimientos_revertidos: movIds.length } });
    emitPedidoChanged({ id_pedido, requester_warehouse_id: pe?.id_bodega_solicita, requested_from_warehouse_id: pe?.id_bodega_surtidor, status: recalc.estado, action: "reverted" });
    res.json({ ok: true, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: String(e.message || e) }); } finally { conn.release(); }
});

router.post("/api/orders/:id/revert-line", auth, requirePermission("action.dispatch", "revertir lineas despachadas"), requireSensitiveApproval("reversa de linea despachada"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pe]] = await conn.query("SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido", { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    const [links] = await conn.query(`SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad FROM pedido_movimiento_vinculo pmv JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento WHERE pmv.id_pedido_detalle=:id_pedido_detalle AND DATE(me.creado_en)=CURDATE()`, { id_pedido_detalle });
    if (!links.length) return res.status(400).json({ error: "No hay movimientos reversibles hoy" });
    const movIds = [...new Set(links.map((x) => x.id_movimiento))];
    const id_bodega_destino2 = Number(pe.id_bodega_solicita || 0);
    if (id_bodega_destino2) {
      const [destRows2] = await conn.query(`SELECT COUNT(*) as cnt FROM kardex k WHERE k.id_bodega = ? AND k.delta_cantidad < 0 AND k.id_producto IN (SELECT pd.id_producto FROM pedido_detalle pd WHERE pd.id_pedido_detalle = ?) AND k.id_movimiento NOT IN (${movIds.map(() => "?").join(",")})`, [id_bodega_destino2, id_pedido_detalle, ...movIds]);
      if (Number(destRows2[0]?.cnt || 0) > 0) { await conn.rollback(); return res.status(409).json({ error: "No se puede revertir la linea: la bodega destino ya realizo movimientos de salida con este producto.", code: "DESTINATION_HAS_MOVEMENTS" }); }
    }
    const reverted_qty = links.reduce((a, b) => a + Number(b.cantidad || 0), 0);
    await conn.query(`UPDATE pedido_detalle SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0), estado_linea = CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO' WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO' ELSE 'PENDIENTE' END WHERE id_pedido_detalle=:id`, { qty: reverted_qty, id: id_pedido_detalle });
    await conn.query(`DELETE FROM kardex WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM pedido_movimiento_vinculo WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM movimiento_detalle WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    await conn.query(`DELETE FROM movimiento_encabezado WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`, movIds);
    const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId: req.user.id_user });
    await conn.commit();
    await writeSensitiveActionAudit({ req, action_key: "REVERSA_DESPACHO_LINEA", action_label: "Reversa de linea despachada", approval: req.sensitive_approval, reference_type: "PEDIDO_DETALLE", reference_id: id_pedido_detalle, detail: { id_pedido, movimientos_revertidos: movIds.length, reverted_qty } });
    emitPedidoChanged({ id_pedido, requester_warehouse_id: pe?.id_bodega_solicita, requested_from_warehouse_id: pe?.id_bodega_surtidor, status: recalc.estado, action: "reverted_line" });
    res.json({ ok: true, reverted_qty, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: String(e.message || e) }); } finally { conn.release(); }
});

router.post("/api/orders/:id/cancel-line", auth, requirePermission("action.dispatch", "anular lineas de pedido"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  const justificacion = String(req.body?.justificacion || "").trim();
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  if (!justificacion) return res.status(400).json({ error: "La justificacion es obligatoria para anular una linea." });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pe]] = await conn.query(`SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE`, { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) return res.status(403).json({ error: "No puedes anular lineas de otra bodega" });
    const [[line]] = await conn.query(`SELECT id_pedido_detalle, cantidad_solicitada, cantidad_surtida, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea FROM pedido_detalle WHERE id_pedido_detalle=:id_pedido_detalle AND id_pedido=:id_pedido FOR UPDATE`, { id_pedido_detalle, id_pedido });
    if (!line) return res.status(404).json({ error: "Linea no encontrada" });
    if (String(line.estado_linea || "").toUpperCase() === "ANULADO") return res.status(400).json({ error: "La linea ya esta anulada." });
    if (Math.max(0, Number(line.cantidad_solicitada || 0) - Number(line.cantidad_surtida || 0)) <= 0) return res.status(400).json({ error: "La linea ya fue despachada completamente." });
    await conn.query(`UPDATE pedido_detalle SET estado_linea='ANULADO', justificacion_linea=:justificacion, anulado_por=:anulado_por, anulado_en=NOW() WHERE id_pedido_detalle=:id_pedido_detalle`, { justificacion, anulado_por: req.user.id_user, id_pedido_detalle });
    const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId: req.user.id_user, justificacion });
    await conn.commit();
    emitPedidoChanged({ id_pedido, requester_warehouse_id: pe?.id_bodega_solicita, requested_from_warehouse_id: pe?.id_bodega_surtidor, status: recalc.estado, action: "cancel_line" });
    res.json({ ok: true, status: recalc.estado, justificacion_despacho: recalc.justificacion_despacho || null, id_pedido_detalle });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: String(e.message || e) }); } finally { conn.release(); }
});

router.post("/api/orders/:id/uncancel-line", auth, requirePermission("action.dispatch", "rehabilitar lineas anuladas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[pe]] = await conn.query(`SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE`, { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) return res.status(403).json({ error: "No puedes modificar lineas de otra bodega" });
    const [[line]] = await conn.query(`SELECT id_pedido_detalle, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea FROM pedido_detalle WHERE id_pedido_detalle=:id_pedido_detalle AND id_pedido=:id_pedido FOR UPDATE`, { id_pedido_detalle, id_pedido });
    if (!line) return res.status(404).json({ error: "Linea no encontrada" });
    if (String(line.estado_linea || "").toUpperCase() !== "ANULADO") return res.status(400).json({ error: "La linea no esta anulada." });
    await conn.query(`UPDATE pedido_detalle SET estado_linea='PENDIENTE', justificacion_linea=NULL, anulado_por=NULL, anulado_en=NULL WHERE id_pedido_detalle=:id_pedido_detalle`, { id_pedido_detalle });
    const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId: req.user.id_user });
    await conn.commit();
    emitPedidoChanged({ id_pedido, requester_warehouse_id: pe?.id_bodega_solicita, requested_from_warehouse_id: pe?.id_bodega_surtidor, status: recalc.estado, action: "uncancel_line" });
    res.json({ ok: true, status: recalc.estado, id_pedido_detalle });
  } catch (e) { await conn.rollback(); res.status(500).json({ error: String(e.message || e) }); } finally { conn.release(); }
});

export default router;
