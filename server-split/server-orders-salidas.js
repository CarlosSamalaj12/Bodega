// server-orders-salidas.js  |  Direct salida/transferencia movement routes
import { pool, auth, requirePermission, enforceDailyCloseBeforeMutations, verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit, beginIdempotentRequest, isProductVisibleInWarehouse, pickLotsFEFO, getLastUnitCost } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

router.post("/api/salidas", auth, requirePermission("action.create_update", "registrar salidas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_motivo = null, id_bodega_destino = null, observaciones = null, lines = [] } = req.body || {};
  if (!id_bodega_destino) return res.status(400).json({ error: "Falta bodega destino" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas" });
  const id_bodega_origen = Number(req.user.id_warehouse || 0);
  if (!id_bodega_origen) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/salidas" })) return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  const idDestino = Number(id_bodega_destino || 0);
  if (!idDestino) return res.status(400).json({ error: "Bodega destino invalida" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let sensitiveApproval = null;

    const [[cfg]] = await conn.query(`SELECT cb.puede_despachar, cb.requiere_precio_salida FROM configuracion_bodega cb WHERE cb.id_bodega=:id_bodega LIMIT 1`, { id_bodega: id_bodega_origen });
    if (cfg && Number(cfg.puede_despachar || 0) !== 1) { await conn.rollback(); return res.status(400).json({ error: "Tu bodega no puede despachar" }); }

    const [[dst]] = await conn.query(`SELECT b.id_bodega, b.activo, b.tipo_bodega, cb.maneja_stock, cb.puede_recibir, cb.modo_despacho_auto FROM bodegas b LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega WHERE b.id_bodega=:id_bodega LIMIT 1`, { id_bodega: idDestino });
    if (!dst || Number(dst.activo || 0) !== 1) { await conn.rollback(); return res.status(400).json({ error: "Bodega destino no disponible" }); }

    const useTransfer = idDestino !== id_bodega_origen && Number(dst.maneja_stock || 0) === 1 && Number(dst.puede_recibir || 0) === 1 && (String(dst.modo_despacho_auto || "").toUpperCase() === "TRANSFERENCIA" || String(dst.tipo_bodega || "").toUpperCase() === "RECEPTORA");
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";

    let mot = null;
    if (id_motivo) {
      const [[motById]] = await conn.query(`SELECT id_motivo, nombre_motivo, tipo_movimiento FROM motivos_movimiento WHERE id_motivo=:id_motivo LIMIT 1`, { id_motivo: Number(id_motivo || 0) });
      mot = motById || null;
      if (mot && String(mot.tipo_movimiento || "").toUpperCase() !== tipo_mov) mot = null;
    }
    if (!mot) {
      const [[autoMot]] = await conn.query(`SELECT id_motivo, nombre_motivo, tipo_movimiento FROM motivos_movimiento WHERE tipo_movimiento=:tipo ORDER BY (nombre_motivo='Transferencia') DESC, id_motivo ASC LIMIT 1`, { tipo: tipo_mov });
      mot = autoMot || null;
    }
    if (!mot) { await conn.rollback(); return res.status(400).json({ error: `No existe motivo para tipo ${tipo_mov}` }); }
    if (String(mot.tipo_movimiento || "").toUpperCase() === "AJUSTE") {
      const approval = await verifySensitiveApproval(req, conn, "ajuste manual de salida");
      if (!approval.ok) { await conn.rollback(); return res.status(Number(approval.status || 403)).json(approval); }
      sensitiveApproval = approval;
    }

    const [[corrPed]] = await conn.query(`SELECT COALESCE(MAX(id_pedido), 0) AS correlativo FROM pedido_encabezado`);
    const correlativoPedido = Number(corrPed?.correlativo || 0);
    const no_documento = correlativoPedido > 0 ? String(correlativoPedido) : null;

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, no_documento, observaciones, creado_por, confirmado_en, estado) VALUES (:tipo_movimiento, :id_motivo, :id_bodega_origen, :id_bodega_destino, :no_documento, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      { tipo_movimiento: tipo_mov, id_motivo: mot.id_motivo, id_bodega_origen, id_bodega_destino: idDestino, no_documento: no_documento || null, observaciones: observaciones || null, creado_por: req.user.id_user }
    );
    const id_movimiento = mhRes.insertId;

    let anyOut = false;
    const normalize = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const motNameNorm = normalize(mot?.nombre_motivo || "");
    const allowExpiredWriteoff = motNameNorm.includes("MERMA") || motNameNorm.includes("DESCOMPOSICION");
    const todayStr = new Date().toISOString().slice(0, 10);
    const requierePrecioSalida = Number(cfg?.requiere_precio_salida || 0) === 1;

    for (const ln of lines) {
      const id_producto = Number(ln.id_producto || 0);
      const qtyRequested = Number(ln.cantidad || ln.qty || 0);
      const precioSalida = Number(ln.precio_salida || 0);
      if (!id_producto || qtyRequested <= 0) continue;
      if (requierePrecioSalida && precioSalida <= 0) { await conn.rollback(); return res.status(400).json({ error: `El precio de salida es obligatorio para producto #${id_producto}` }); }
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega_origen))) { await conn.rollback(); return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega origen` }); }
      if (useTransfer && !(await isProductVisibleInWarehouse(conn, id_producto, idDestino))) { await conn.rollback(); return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega destino` }); }

      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega_origen, id_producto, qtyRequested);
      if (!picks.length || remaining > 0) { await conn.rollback(); return res.status(400).json({ error: `Stock insuficiente para producto #${id_producto}` }); }

      const hasExpiredPick = picks.some((p) => p.fecha_vencimiento && String(p.fecha_vencimiento).slice(0, 10) < todayStr);
      if (hasExpiredPick && !allowExpiredWriteoff) { await conn.rollback(); return res.status(400).json({ error: "No puedes dar salida a producto vencido con ese motivo. Usa Merma o Descomposicion." }); }

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, id_bodega_origen, id_producto, p.lote);
        const [d] = await conn.query(`INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, precio_salida, observacion_linea) VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:precio_salida,:obs)`,
          { id_movimiento, id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, cantidad: p.qty, costo: costo_unitario, precio_salida: precioSalida > 0 ? precioSalida : null, obs: ln.observacion_linea || null });
        const id_detalle = d.insertId;
        await conn.query(`INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario) VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          { id_movimiento, id_detalle, id_bodega: id_bodega_origen, id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, delta: -p.qty, costo: costo_unitario });
        if (useTransfer) {
          await conn.query(`INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario) VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            { id_movimiento, id_detalle, id_bodega: idDestino, id_producto, lote: p.lote || null, fecha: p.fecha_vencimiento || null, delta: +p.qty, costo: costo_unitario });
        }
        anyOut = true;
      }
    }
    if (!anyOut) { await conn.rollback(); return res.status(400).json({ error: "Sin lineas validas para salida" }); }

    await conn.commit();
    await writeSensitiveActionAudit({ req, action_key: "SALIDA_AJUSTE_MANUAL", action_label: "Ajuste manual en salida", approval: sensitiveApproval, reference_type: "MOVIMIENTO", reference_id: id_movimiento, detail: { id_motivo: Number(id_motivo || 0), lineas: Number(lines.length || 0) } });
    res.json({ ok: true, id_movimiento, tipo_movimiento: tipo_mov, correlativo_pedido: correlativoPedido, sensitive_approval: toSensitiveApprovalPayload(sensitiveApproval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally { conn.release(); }
});

export default router;
