// server-orders-pedidos.js  |  Order CRUD, list, details, lots, print routes
import { pool, auth, requirePermission, enforceDailyCloseBeforeMutations, resolveStockScope, beginIdempotentRequest, isValidOrderPin, findOrderPinCollision, bcrypt, trackPinFailure, isProductVisibleInWarehouse, emitPedidoChanged, getScopedWarehouseFilter, buildNamedInClause, normalizeWarehouseIdList, getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

router.post("/api/orders", auth, requirePermission("action.create_update", "crear pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { requested_from_warehouse_id, notes, lines } = req.body || {};
  const requester_user_id = Number(req.body?.requester_user_id || 0);
  const requester_pin = String(req.body?.requester_pin || "").trim();
  if (!requester_user_id) return res.status(400).json({ error: "Falta usuario solicitante" });
  if (!requester_pin) return res.status(400).json({ error: "Falta codigo del usuario solicitante" });
  if (!isValidOrderPin(requester_pin)) return res.status(400).json({ error: "El PIN de pedido debe tener entre 6 y 12 digitos" });
  if (!requested_from_warehouse_id) return res.status(400).json({ error: "Falta bodega origen/destino" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Pedido sin lineas" });
  const requestedFromWarehouseId = Number(requested_from_warehouse_id || 0);
  if (!requestedFromWarehouseId) return res.status(400).json({ error: "Bodega que despacha invalida" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/orders" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[requesterUser]] = await conn.query(
      `SELECT u.id_usuario, u.id_bodega, u.activo, upp.pin_hash
       FROM usuarios u
       LEFT JOIN usuario_pin_pedido upp ON upp.id_usuario=u.id_usuario
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: requester_user_id }
    );
    if (!requesterUser || Number(requesterUser.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Usuario solicitante no disponible" });
    }
    if (!requesterUser.pin_hash) {
      await conn.rollback();
      return res.status(400).json({ error: "El usuario solicitante no tiene PIN de pedidos configurado" });
    }
    const pinOk = await bcrypt.compare(requester_pin, requesterUser.pin_hash || "");
    if (!pinOk) {
      trackPinFailure("order", { requester_user_id, actor_user_id: Number(req.user?.id_user || 0) });
      await conn.rollback();
      return res.status(401).json({ error: "Codigo de usuario solicitante invalido" });
    }
    const duplicatedPinOwner = await findOrderPinCollision(requester_pin, requester_user_id, conn, true);
    if (duplicatedPinOwner) {
      await conn.rollback();
      return res.status(409).json({ error: "El PIN de pedidos esta repetido con otro usuario activo. Restablece el PIN para continuar." });
    }
    const requester_warehouse_id = Number(requesterUser.id_bodega || 0);
    if (!requester_warehouse_id) {
      await conn.rollback();
      return res.status(400).json({ error: "Usuario solicitante sin bodega asignada" });
    }
    if (req.body?.requester_warehouse_id && Number(req.body.requester_warehouse_id || 0) !== requester_warehouse_id) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega del usuario solicitante no coincide" });
    }

    const [[fromWh]] = await conn.query(
      `SELECT id_bodega, tipo_bodega, activo FROM bodegas WHERE id_bodega=:id_bodega LIMIT 1`,
      { id_bodega: requestedFromWarehouseId }
    );
    if (!fromWh || Number(fromWh.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega que despacha no disponible" });
    }
    const tipoFrom = String(fromWh.tipo_bodega || "").toUpperCase();
    if (!["PRINCIPAL", "RECEPTORA"].includes(tipoFrom)) {
      await conn.rollback();
      return res.status(400).json({ error: "Solo se puede pedir a bodegas PRINCIPAL o RECEPTORA" });
    }

    const [r] = await conn.query(
      `INSERT INTO pedido_encabezado(id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, observaciones) VALUES(:u,:bs,:bd,:obs)`,
      { u: requester_user_id, bs: requester_warehouse_id, bd: requested_from_warehouse_id, obs: notes ?? null }
    );
    const id_pedido = r.insertId;

    for (const ln of lines) {
      if (ln?.id_product && !(await isProductVisibleInWarehouse(conn, ln.id_product, requestedFromWarehouseId))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${ln.id_product} no esta habilitado para la bodega que despacha` });
      }
      if (!ln.id_product || !ln.qty_requested || ln.qty_requested <= 0) continue;
      await conn.query(
        `INSERT INTO pedido_detalle(id_pedido, id_producto, cantidad_solicitada, observacion_producto) VALUES(:id_pedido,:id_producto,:cantidad,:nota)`,
        { id_pedido, id_producto: ln.id_product, cantidad: ln.qty_requested, nota: ln.line_note ?? null }
      );
    }

    await conn.commit();
    emitPedidoChanged({ id_pedido, requester_warehouse_id, requested_from_warehouse_id, status: "PENDIENTE", action: "created" });
    res.json({ ok: true, id_order: id_pedido });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally { conn.release(); }
});

router.get("/api/pedidos/correlativo-actual", auth, async (req, res) => {
  try {
    const [[r]] = await pool.query(`SELECT COALESCE(MAX(id_pedido), 0) AS correlativo FROM pedido_encabezado`);
    res.json({ correlativo: Number(r?.correlativo || 0) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

router.get("/api/orders", auth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const scopeParam = req.query.scope ? String(req.query.scope) : null;
  const whParam = Number(req.query.warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  const where = [];
  const params = {};
  if (status) { where.push("p.estado=:status"); params.status = status; }
  if (scopeParam === "dispatch") {
    const warehouseScope = getScopedWarehouseFilter(stockScope, whParam);
    if (warehouseScope.denied) return res.json([]);
    if (!stockScope.can_all_bodegas) { where.push("p.id_bodega_surtidor=:wh"); params.wh = req.user.id_warehouse; }
    else if (warehouseScope.selected) { where.push("p.id_bodega_surtidor=:wh"); params.wh = warehouseScope.selected; }
    else if (warehouseScope.restrictedIds.length) {
      const inClause = buildNamedInClause(warehouseScope.restrictedIds, "ordw");
      where.push(`p.id_bodega_surtidor IN (${inClause.sql})`);
      Object.assign(params, inClause.params);
    }
  } else if (scopeParam === "mine") { where.push("p.id_usuario_solicita=:uid"); params.uid = req.user.id_user; }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const [rows] = await pool.query(
    `SELECT p.*, bs.nombre_bodega AS requester_warehouse, bd.nombre_bodega AS from_warehouse,
            u.nombre_completo AS requester_name,
            CASE WHEN bsol.tipo_bodega='RECEPTORA' OR cb.modo_despacho_auto='TRANSFERENCIA' THEN 'TRANSFERENCIA' ELSE 'SALIDA' END AS tipo_salida
     FROM pedido_encabezado p
     JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
     JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
     JOIN bodegas bsol ON bsol.id_bodega=p.id_bodega_solicita
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=p.id_bodega_solicita
     JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
     ${whereSql}
     ORDER BY p.creado_en DESC`, params
  );
  res.json(rows);
});

router.get("/api/orders/:id/details", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) return res.status(400).json({ error: "Pedido invalido" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT p.*, b.nombre_bodega AS from_warehouse FROM pedido_encabezado p JOIN bodegas b ON b.id_bodega=p.id_bodega_surtidor WHERE p.id_pedido=:id_pedido`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) return res.status(403).json({ error: "No tienes acceso a este pedido" });
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) return res.status(403).json({ error: "No tienes acceso a este pedido" });
  const [lines] = await pool.query(
    `SELECT d.id_pedido_detalle, d.id_producto, p.nombre_producto,
            d.cantidad_solicitada, d.cantidad_surtida,
            COALESCE(d.estado_linea, 'PENDIENTE') AS estado_linea, d.justificacion_linea,
            CASE WHEN COALESCE(d.estado_linea, 'PENDIENTE')='ANULADO' THEN 0 ELSE GREATEST(d.cantidad_solicitada - d.cantidad_surtida, 0) END AS pendiente,
            s.stock
     FROM pedido_detalle d
     JOIN productos p ON p.id_producto=d.id_producto
     LEFT JOIN v_stock_resumen s ON s.id_bodega=:id_bodega AND s.id_producto=d.id_producto
     WHERE d.id_pedido=:id_pedido
     ORDER BY p.nombre_producto ASC`,
    { id_pedido, id_bodega: pe.id_bodega_surtidor }
  );
  res.json({ from_warehouse: pe.from_warehouse, status: pe.estado || null, justificacion_despacho: pe.justificacion_despacho || null, lines });
});

router.get("/api/orders/:id/lots", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido LIMIT 1`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) return res.status(403).json({ error: "No tienes acceso a este pedido" });
  } else if (!orderWarehouses.includes(actorWarehouse)) return res.status(403).json({ error: "No tienes acceso a este pedido" });
  const [rows] = await pool.query(
    `SELECT pr.nombre_producto, md.lote, md.fecha_vencimiento, md.cantidad, me.tipo_movimiento, me.creado_en
     FROM pedido_movimiento_vinculo pmv
     JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
     JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
     JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
     JOIN productos pr ON pr.id_producto=pd.id_producto
     WHERE pd.id_pedido=:id_pedido
     ORDER BY me.creado_en DESC, pr.nombre_producto ASC`,
    { id_pedido }
  );
  res.json({ count: rows.length, rows });
});

router.get("/api/print/order/:id", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  const [[oh]] = await pool.query(
    `SELECT p.*, u.nombre_completo AS requester_name, bs.nombre_bodega AS req_wh, bd.nombre_bodega AS from_wh,
            bs.telefono_contacto AS req_wh_phone, bs.direccion_contacto AS req_wh_address,
            bd.telefono_contacto AS from_wh_phone, bd.direccion_contacto AS from_wh_address,
            ua.nombre_completo AS approver_name
     FROM pedido_encabezado p
     JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
     JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
     JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
     LEFT JOIN usuarios ua ON ua.id_usuario=p.aprobado_por
     WHERE p.id_pedido=:id_pedido`,
    { id_pedido }
  );
  if (!oh) return res.status(404).send("Pedido no existe");
  const orderWarehouses = [Number(oh.id_bodega_solicita || 0), Number(oh.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) return res.status(403).send("Sin permiso");
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) return res.status(403).send("Sin permiso");
  const [lines] = await pool.query(
    `SELECT d.*, pr.nombre_producto FROM pedido_detalle d JOIN productos pr ON pr.id_producto=d.id_producto WHERE d.id_pedido=:id_pedido ORDER BY pr.nombre_producto ASC`,
    { id_pedido }
  );
  const logoSrc = await getPreferredWarehousePrintLogoDataUri(oh.id_bodega_solicita, oh.id_bodega_surtidor);
  const footerHtml = buildWarehouseFooterHtml(
    { telefono_contacto: oh.req_wh_phone, direccion_contacto: oh.req_wh_address },
    { telefono_contacto: oh.from_wh_phone, direccion_contacto: oh.from_wh_address }
  );
  const dateStr = oh.creado_en ? (() => {
    const dt = new Date(oh.creado_en);
    if (Number.isNaN(dt.getTime())) return "";
    return `${String(dt.getDate()).padStart(2,"0")}-${String(dt.getMonth()+1).padStart(2,"0")}-${dt.getFullYear()} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}:${String(dt.getSeconds()).padStart(2,"0")}`;
  })() : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Pedido #${id_pedido}</title><style>body{font-family:Arial;padding:16px;}.headLogo{display:block;margin:0 auto 10px;max-height:64px;width:auto;object-fit:contain;}.headTitle{margin:4px 0 0;text-align:center;}.row{display:flex;justify-content:space-between;gap:12px;}.muted{color:#666;font-size:12px;}table{width:100%;border-collapse:collapse;margin-top:12px;}th,td{border:1px solid #ddd;padding:4px 6px;font-size:11px;line-height:1.2;}th{background:#f5f5f5;}@media print{@page{size:A4 portrait;margin:10mm;}}</style></head><body><img class="headLogo" src="${logoSrc}" alt="Logo" /><h2 class="headTitle">Pedido #${id_pedido}</h2><div class="row"><div><div class="muted">Solicita</div><div><b>${oh.requester_name||""}</b></div><div class="muted">Area/Bodega: ${oh.req_wh||""}</div></div><div><div class="muted">De bodega</div><div><b>${oh.from_wh||""}</b></div><div class="muted">Fecha: ${dateStr}</div><div class="muted">Estado: ${oh.estado||""}</div></div></div>${oh.observaciones?`<p><b>Notas:</b> ${oh.observaciones}</p>`:""}<table><thead><tr><th>Producto</th><th>Cant.</th><th>Despachado</th><th>Observacion</th></tr></thead><tbody>${lines.map(x=>`<tr><td>${x.nombre_producto}</td><td style="text-align:right">${x.cantidad_solicitada}</td><td style="text-align:right">${x.cantidad_surtida}</td><td>${x.observacion_producto??""}</td></tr>`).join("")}</tbody></table><script>window.print()</script><div style="margin-top:48px;display:flex;gap:20px;"><div style="flex:1;text-align:center;"><div style="border-top:1px solid #999;padding-top:6px;font-size:12px;">Firma solicitante<br/>${oh.requester_name||""}</div></div><div style="flex:1;text-align:center;"><div style="border-top:1px solid #999;padding-top:6px;font-size:12px;">Firma despacha<br/>${oh.approver_name||""}</div></div></div></body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

export default router;
