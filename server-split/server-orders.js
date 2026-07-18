// server-orders.js  |  Orders routes (modular)
import { app, pool, auth, requirePermission, enforceDailyCloseBeforeMutations, requireSensitiveApproval, resolveStockScope, verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit } from '../server-shared.js';
// -------------------------------------------------------
app.post("/api/orders", auth, requirePermission("action.create_update", "crear pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
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
      return res.status(409).json({
        error:
          "El PIN de pedidos esta repetido con otro usuario activo. Restablece el PIN para continuar.",
      });
    }
    const requester_warehouse_id = Number(requesterUser.id_bodega || 0);
    if (!requester_warehouse_id) {
      await conn.rollback();
      return res.status(400).json({ error: "Usuario solicitante sin bodega asignada" });
    }
    if (
      req.body?.requester_warehouse_id &&
      Number(req.body.requester_warehouse_id || 0) !== requester_warehouse_id
    ) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega del usuario solicitante no coincide" });
    }

    const [[fromWh]] = await conn.query(
      `SELECT id_bodega, tipo_bodega, activo
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
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
      `INSERT INTO pedido_encabezado(id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, observaciones)
       VALUES(:u,:bs,:bd,:obs)`,
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
        `INSERT INTO pedido_detalle(id_pedido, id_producto, cantidad_solicitada, observacion_producto)
         VALUES(:id_pedido,:id_producto,:cantidad,:nota)`,
        { id_pedido, id_producto: ln.id_product, cantidad: ln.qty_requested, nota: ln.line_note ?? null }
      );
    }

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id,
      requested_from_warehouse_id,
      status: "PENDIENTE",
      action: "created",
    });
    res.json({ ok: true, id_order: id_pedido });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/pedidos/correlativo-actual", auth, async (req, res) => {
  try {
    const [[r]] = await pool.query(
      `SELECT COALESCE(MAX(id_pedido), 0) AS correlativo
       FROM pedido_encabezado`
    );
    res.json({ correlativo: Number(r?.correlativo || 0) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const scopeParam = req.query.scope ? String(req.query.scope) : null;
  const whParam = Number(req.query.warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  const where = [];
  const params = {};
  if (status) {
    where.push("p.estado=:status");
    params.status = status;
  }
  if (scopeParam === "dispatch") {
    const warehouseScope = getScopedWarehouseFilter(stockScope, whParam);
    if (warehouseScope.denied) return res.json([]);
    if (!stockScope.can_all_bodegas) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = req.user.id_warehouse;
    } else if (warehouseScope.selected) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = warehouseScope.selected;
    } else if (warehouseScope.restrictedIds.length) {
      const inClause = buildNamedInClause(warehouseScope.restrictedIds, "ordw");
      where.push(`p.id_bodega_surtidor IN (${inClause.sql})`);
      Object.assign(params, inClause.params);
    }
  } else if (scopeParam === "mine") {
    where.push("p.id_usuario_solicita=:uid");
    params.uid = req.user.id_user;
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const [rows] = await pool.query(
    `
    SELECT p.*, bs.nombre_bodega AS requester_warehouse, bd.nombre_bodega AS from_warehouse,
           u.nombre_completo AS requester_name,
           CASE
             WHEN bsol.tipo_bodega='RECEPTORA' OR cb.modo_despacho_auto='TRANSFERENCIA' THEN 'TRANSFERENCIA'
             ELSE 'SALIDA'
           END AS tipo_salida
    FROM pedido_encabezado p
    JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
    JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
    JOIN bodegas bsol ON bsol.id_bodega=p.id_bodega_solicita
    LEFT JOIN configuracion_bodega cb ON cb.id_bodega=p.id_bodega_solicita
    JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
    ${whereSql}
    ORDER BY p.creado_en DESC
    `,
    params
  );
  res.json(rows);
});

app.get("/api/orders/:id/details", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT p.*, b.nombre_bodega AS from_warehouse
     FROM pedido_encabezado p
     JOIN bodegas b ON b.id_bodega=p.id_bodega_surtidor
     WHERE p.id_pedido=:id_pedido`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).json({ error: "No tienes acceso a este pedido" });
    }
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).json({ error: "No tienes acceso a este pedido" });
  }

  const [lines] = await pool.query(
    `SELECT d.id_pedido_detalle, d.id_producto, p.nombre_producto,
            d.cantidad_solicitada, d.cantidad_surtida,
            COALESCE(d.estado_linea, 'PENDIENTE') AS estado_linea,
            d.justificacion_linea,
            CASE
              WHEN COALESCE(d.estado_linea, 'PENDIENTE')='ANULADO' THEN 0
              ELSE GREATEST(d.cantidad_solicitada - d.cantidad_surtida, 0)
            END AS pendiente,
            s.stock
     FROM pedido_detalle d
     JOIN productos p ON p.id_producto=d.id_producto
     LEFT JOIN v_stock_resumen s
       ON s.id_bodega=:id_bodega AND s.id_producto=d.id_producto
     WHERE d.id_pedido=:id_pedido
     ORDER BY p.nombre_producto ASC`,
    { id_pedido, id_bodega: pe.id_bodega_surtidor }
  );

  res.json({
    from_warehouse: pe.from_warehouse,
    status: pe.estado || null,
    justificacion_despacho: pe.justificacion_despacho || null,
    lines,
  });
});

async function recomputePedidoEstado(conn, id_pedido, opts = {}) {
  const actorUserId = Number(opts?.actorUserId || 0) || null;
  const justificacion = String(opts?.justificacion || "").trim();
  const [aggRows] = await conn.query(
    `SELECT
       COUNT(*) AS total_lineas,
       SUM(CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 1 ELSE 0 END) AS lineas_anuladas,
       SUM(CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 1 ELSE 0 END) AS lineas_completas_qty,
       SUM(CASE WHEN cantidad_surtida > 0 AND cantidad_surtida < cantidad_solicitada THEN 1 ELSE 0 END) AS lineas_parciales_qty,
       SUM(cantidad_solicitada) AS total_solicitado,
       SUM(cantidad_surtida) AS total_surtido
     FROM pedido_detalle
     WHERE id_pedido=:id_pedido`,
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
    await conn.query(
      `UPDATE pedido_encabezado
       SET estado=:estado,
           justificacion_despacho=NULL,
           aprobado_por=COALESCE(:aprobado_por, aprobado_por),
           aprobado_en=NOW()
       WHERE id_pedido=:id_pedido`,
      { estado, aprobado_por: actorUserId, id_pedido }
    );
    return { estado, justificacion_despacho: null };
  }

  if (justificacion && (estado === "PARCIAL" || estado === "COMPLETADO_JUSTIFICADO")) {
    const [[head]] = await conn.query(
      `SELECT justificacion_despacho
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       LIMIT 1`,
      { id_pedido }
    );
    const current = String(head?.justificacion_despacho || "").trim();
    const finalJust =
      !current ? justificacion : current.toLowerCase() === justificacion.toLowerCase() ? current : `${current} | ${justificacion}`;
    await conn.query(
      `UPDATE pedido_encabezado
       SET estado=:estado,
           justificacion_despacho=:justificacion,
           aprobado_por=COALESCE(:aprobado_por, aprobado_por),
           aprobado_en=NOW()
       WHERE id_pedido=:id_pedido`,
      {
        estado,
        justificacion: finalJust,
        aprobado_por: actorUserId,
        id_pedido,
      }
    );
    return { estado, justificacion_despacho: finalJust };
  }

  await conn.query(
    `UPDATE pedido_encabezado
     SET estado=:estado,
         aprobado_por=COALESCE(:aprobado_por, aprobado_por),
         aprobado_en=NOW()
     WHERE id_pedido=:id_pedido`,
    { estado, aprobado_por: actorUserId, id_pedido }
  );
  const [[head]] = await conn.query(
    `SELECT justificacion_despacho
     FROM pedido_encabezado
     WHERE id_pedido=:id_pedido
     LIMIT 1`,
    { id_pedido }
  );
  return { estado, justificacion_despacho: head?.justificacion_despacho || null };
}

async function pickLotsFEFO(conn, id_bodega, id_producto, qtyNeeded, opts = {}) {
  const allowExpired = opts.allowExpired !== false;
  const whereVenc = allowExpired ? "" : "AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())";
  const [lots] = await conn.query(
    `
    SELECT lote, fecha_vencimiento, stock
    FROM v_stock_disponible
    WHERE id_bodega=:id_bodega
      AND id_producto=:id_producto
      ${whereVenc}
    ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC
    `,
    { id_bodega, id_producto }
  );
  const picks = [];
  let remaining = Number(qtyNeeded);
  for (const l of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(l.stock));
    picks.push({ lote: l.lote, fecha_vencimiento: l.fecha_vencimiento, qty: take });
    remaining -= take;
  }

  if (!picks.length && allowExpired) {
    const [[r]] = await conn.query(
      `SELECT stock FROM v_stock_resumen WHERE id_bodega=:id_bodega AND id_producto=:id_producto LIMIT 1`,
      { id_bodega, id_producto }
    );
    const stock = Number(r?.stock || 0);
    if (stock > 0) {
      const take = Math.min(stock, Number(qtyNeeded));
      return { picks: [{ lote: null, fecha_vencimiento: null, qty: take }], remaining: Number(qtyNeeded) - take };
    }
  }

  return { picks, remaining };
}


async function getLastUnitCost(conn, id_bodega, id_producto, lote) {
  const [rows] = await conn.query(
    `SELECT costo_unitario
     FROM kardex
     WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote=:lote AND delta_cantidad > 0
     ORDER BY creado_en DESC
     LIMIT 1`,
    { id_bodega, id_producto, lote }
  );
  return rows[0]?.costo_unitario ?? 0;
}

/* =========================
   SALIDAS DIRECTAS (MOVIMIENTOS + KARDEX)
========================= */
app.post("/api/salidas", auth, requirePermission("action.create_update", "registrar salidas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_motivo = null, id_bodega_destino = null, observaciones = null, lines = [] } = req.body || {};

  if (!id_bodega_destino) return res.status(400).json({ error: "Falta bodega destino" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas" });

  const id_bodega_origen = Number(req.user.id_warehouse || 0);
  if (!id_bodega_origen) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/salidas" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }
  const idDestino = Number(id_bodega_destino || 0);
  if (!idDestino) return res.status(400).json({ error: "Bodega destino invalida" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let sensitiveApproval = null;

    const [[cfg]] = await conn.query(
      `SELECT cb.puede_despachar, cb.requiere_precio_salida
       FROM configuracion_bodega cb
       WHERE cb.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: id_bodega_origen }
    );
    if (cfg && Number(cfg.puede_despachar || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Tu bodega no puede despachar" });
    }

    const [[dst]] = await conn.query(
      `SELECT b.id_bodega, b.activo, b.tipo_bodega, cb.maneja_stock, cb.puede_recibir, cb.modo_despacho_auto
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: idDestino }
    );
    if (!dst || Number(dst.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega destino no disponible" });
    }

    const useTransfer =
      idDestino !== id_bodega_origen &&
      Number(dst.maneja_stock || 0) === 1 &&
      Number(dst.puede_recibir || 0) === 1 &&
      (String(dst.modo_despacho_auto || "").toUpperCase() === "TRANSFERENCIA" ||
        String(dst.tipo_bodega || "").toUpperCase() === "RECEPTORA");
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";

    let mot = null;
    if (id_motivo) {
      const [[motById]] = await conn.query(
        `SELECT id_motivo, nombre_motivo, tipo_movimiento
         FROM motivos_movimiento
         WHERE id_motivo=:id_motivo
         LIMIT 1`,
        { id_motivo: Number(id_motivo || 0) }
      );
      mot = motById || null;
      if (mot && String(mot.tipo_movimiento || "").toUpperCase() !== tipo_mov) {
        mot = null;
      }
    }

    if (!mot) {
      const [[autoMot]] = await conn.query(
        `SELECT id_motivo, nombre_motivo, tipo_movimiento
         FROM motivos_movimiento
         WHERE tipo_movimiento=:tipo
         ORDER BY (nombre_motivo='Transferencia') DESC, id_motivo ASC
         LIMIT 1`,
        { tipo: tipo_mov }
      );
      mot = autoMot || null;
    }

    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: `No existe motivo para tipo ${tipo_mov}` });
    }
    if (String(mot.tipo_movimiento || "").toUpperCase() === "AJUSTE") {
      const approval = await verifySensitiveApproval(req, conn, "ajuste manual de salida");
      if (!approval.ok) {
        await conn.rollback();
        return res.status(Number(approval.status || 403)).json(approval);
      }
      sensitiveApproval = approval;
    }

    const [[corrPed]] = await conn.query(
      `SELECT COALESCE(MAX(id_pedido), 0) AS correlativo
       FROM pedido_encabezado`
    );
    const correlativoPedido = Number(corrPed?.correlativo || 0);
    const no_documento = correlativoPedido > 0 ? String(correlativoPedido) : null;

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, no_documento, observaciones, creado_por, confirmado_en, estado)
       VALUES (:tipo_movimiento, :id_motivo, :id_bodega_origen, :id_bodega_destino, :no_documento, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        tipo_movimiento: tipo_mov,
        id_motivo: mot.id_motivo,
        id_bodega_origen,
        id_bodega_destino: idDestino,
        no_documento: no_documento || null,
        observaciones: observaciones || null,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento = mhRes.insertId;

    let anyOut = false;
    const normalize = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
    const motNameNorm = normalize(mot?.nombre_motivo || "");
    const allowExpiredWriteoff = motNameNorm.includes("MERMA") || motNameNorm.includes("DESCOMPOSICION");
    const todayStr = new Date().toISOString().slice(0, 10);
    const requierePrecioSalida = Number(cfg?.requiere_precio_salida || 0) === 1;

    for (const ln of lines) {
      const id_producto = Number(ln.id_producto || 0);
      const qtyRequested = Number(ln.cantidad || ln.qty || 0);
      const precioSalida = Number(ln.precio_salida || 0);
      if (!id_producto || qtyRequested <= 0) continue;
      if (requierePrecioSalida && precioSalida <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: `El precio de salida es obligatorio para producto #${id_producto}` });
      }
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega_origen))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega origen` });
      }
      if (useTransfer && !(await isProductVisibleInWarehouse(conn, id_producto, idDestino))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega destino` });
      }

      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega_origen, id_producto, qtyRequested);
      if (!picks.length || remaining > 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para producto #${id_producto}` });
      }

      const hasExpiredPick = picks.some((p) => p.fecha_vencimiento && String(p.fecha_vencimiento).slice(0, 10) < todayStr);
      if (hasExpiredPick && !allowExpiredWriteoff) {
        await conn.rollback();
        return res.status(400).json({
          error: "No puedes dar salida a producto vencido con ese motivo. Usa Merma o Descomposicion.",
        });
      }

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, id_bodega_origen, id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, precio_salida, observacion_linea)
           VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:precio_salida,:obs)`,
          {
            id_movimiento,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo: costo_unitario,
            precio_salida: precioSalida > 0 ? precioSalida : null,
            obs: ln.observacion_linea || null,
          }
        );
        const id_detalle = d.insertId;

        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: id_bodega_origen,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: -p.qty,
            costo: costo_unitario,
          }
        );
        if (useTransfer) {
          await conn.query(
            `INSERT INTO kardex
             (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
             VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            {
              id_movimiento,
              id_detalle,
              id_bodega: idDestino,
              id_producto,
              lote: p.lote || null,
              fecha: p.fecha_vencimiento || null,
              delta: +p.qty,
              costo: costo_unitario,
            }
          );
        }
        anyOut = true;
      }
    }

    if (!anyOut) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin lineas validas para salida" });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "SALIDA_AJUSTE_MANUAL",
      action_label: "Ajuste manual en salida",
      approval: sensitiveApproval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { id_motivo: Number(id_motivo || 0), lineas: Number(lines.length || 0) },
    });
    res.json({
      ok: true,
      id_movimiento,
      tipo_movimiento: tipo_mov,
      correlativo_pedido: correlativoPedido,
      sensitive_approval: toSensitiveApprovalPayload(sensitiveApproval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   DESPACHO (MOVIMIENTOS + KARDEX)
========================= */
app.post("/api/orders/:id/fulfill", auth, requirePermission("action.dispatch", "despachar pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const { lines = [], justificacion = null } = req.body || {};
  const justificacionTxt = String(justificacion || "").trim();
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas a despachar" });
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/orders/${id_pedido}/fulfill` })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query("SELECT * FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE", { id_pedido });
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      return res.status(403).json({ error: "No puedes despachar pedidos de otra bodega" });
    }
    if (pe.estado === "CANCELADO" || pe.estado === "COMPLETADO" || pe.estado === "COMPLETADO_JUSTIFICADO") {
      return res.status(400).json({ error: "Pedido no despachable" });
    }

    const [[cfg]] = await conn.query(
      `SELECT cb.modo_despacho_auto, cb.maneja_stock, b.tipo_bodega
       FROM configuracion_bodega cb
       JOIN bodegas b ON b.id_bodega=cb.id_bodega
       WHERE cb.id_bodega=:id`,
      { id: pe.id_bodega_solicita }
    );
    const useTransfer = cfg?.tipo_bodega === "RECEPTORA" || cfg?.modo_despacho_auto === "TRANSFERENCIA";
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";
    const [[solUser]] = await conn.query(
      `SELECT nombre_completo
       FROM usuarios
       WHERE id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: pe.id_usuario_solicita }
    );
    const solicitanteNombre = String(solUser?.nombre_completo || `Usuario #${pe.id_usuario_solicita}`);

    const [[mot]] = await conn.query(
      `SELECT id_motivo
       FROM motivos_movimiento
       WHERE (nombre_motivo='Transferencia' AND :tipo='TRANSFERENCIA')
          OR (:tipo='SALIDA' AND tipo_movimiento='SALIDA')
       ORDER BY (nombre_motivo='Transferencia') DESC
       LIMIT 1`,
      { tipo: tipo_mov }
    );
    if (!mot) return res.status(400).json({ error: "No existe motivo para el movimiento" });

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES(:tipo, :id_motivo, :origen, :destino, :obs, :u, NOW(), 'CONFIRMADO')`,
      {
        tipo: tipo_mov,
        id_motivo: mot.id_motivo,
        origen: pe.id_bodega_surtidor,
        // Siempre guardamos la bodega solicitante para trazabilidad del despacho.
        destino: pe.id_bodega_solicita,
        obs: `Despacho Pedido #${id_pedido} | Solicitante: ${solicitanteNombre}`,
        u: req.user.id_user,
      }
    );
    const id_movimiento = mhRes.insertId;

    let anyFulfilled = false;
    let requiresJustificacion = false;
    const skipped = [];

    for (const ln of lines) {
      const id_pedido_detalle = Number(ln.id_pedido_detalle);
      const qtyToFill = Number(ln.qty || 0);
      if (!id_pedido_detalle || qtyToFill <= 0) continue;

      const [[line]] = await conn.query(
        `SELECT * FROM pedido_detalle WHERE id_pedido_detalle=:id AND id_pedido=:id_pedido FOR UPDATE`,
        { id: id_pedido_detalle, id_pedido }
      );
      if (!line) continue;
      if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
        skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "LINEA_ANULADA" });
        continue;
      }

      const remainingToFill = Number(line.cantidad_solicitada) - Number(line.cantidad_surtida);
      if (remainingToFill <= 0) continue;
      const requested = qtyToFill;
      if (requested < remainingToFill) requiresJustificacion = true;

      const { picks } = await pickLotsFEFO(conn, pe.id_bodega_surtidor, line.id_producto, requested, {
        allowExpired: false,
      });
      if (!picks.length) {
        requiresJustificacion = true;
        skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "SIN_STOCK_NO_VIGENTE" });
        continue;
      }

      anyFulfilled = true;

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, pe.id_bodega_surtidor, line.id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:obs)`,
          {
            id_movimiento,
            id_producto: line.id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo: costo_unitario,
            obs: `Pedido #${id_pedido}`,
          }
        );
        const id_detalle = d.insertId;

        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: pe.id_bodega_surtidor,
            id_producto: line.id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: -p.qty,
            costo: costo_unitario,
          }
        );

        if (useTransfer && cfg?.maneja_stock === 1) {
          await conn.query(
            `INSERT INTO kardex
             (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
             VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            {
              id_movimiento,
              id_detalle,
              id_bodega: pe.id_bodega_solicita,
              id_producto: line.id_producto,
              lote: p.lote || null,
              fecha: p.fecha_vencimiento || null,
              delta: +p.qty,
              costo: costo_unitario,
            }
          );
        }

        await conn.query(
          `INSERT INTO pedido_movimiento_vinculo (id_pedido_detalle, id_movimiento, id_detalle)
           VALUES(:id_pedido_detalle,:id_movimiento,:id_detalle)`,
          { id_pedido_detalle, id_movimiento, id_detalle }
        );
      }

      const fulfilledNow = picks.reduce((a, b) => a + Number(b.qty), 0);
      const projectedSurtida = Number(line.cantidad_surtida) + fulfilledNow;
      if (projectedSurtida < Number(line.cantidad_solicitada)) {
        requiresJustificacion = true;
      }
      await conn.query(
        `UPDATE pedido_detalle
         SET cantidad_surtida = cantidad_surtida + :add,
             estado_linea = CASE
               WHEN (cantidad_surtida + :add) >= cantidad_solicitada THEN 'DESPACHADO'
               ELSE 'PENDIENTE'
             END,
             justificacion_linea = CASE
               WHEN :justificacion IS NULL OR :justificacion='' THEN justificacion_linea
               WHEN (cantidad_surtida + :add) < cantidad_solicitada THEN :justificacion
               ELSE justificacion_linea
             END
         WHERE id_pedido_detalle=:id`,
        {
          add: fulfilledNow,
          id: id_pedido_detalle,
          justificacion: justificacionTxt || null,
        }
      );
    }

    if (!anyFulfilled) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin stock en las lineas seleccionadas", skipped });
    }

    if (requiresJustificacion && !justificacionTxt) {
      await conn.rollback();
      return res.status(400).json({ error: "Para despacho parcial debes ingresar una justificacion." });
    }

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
      justificacion: justificacionTxt || null,
    });
    const newStatus = recalc.estado;

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe.id_bodega_solicita,
      requested_from_warehouse_id: pe.id_bodega_surtidor,
      status: newStatus,
      action: "fulfilled",
    });
    res.json({
      ok: true,
      id_movimiento,
      status: newStatus,
      justificacion_despacho: recalc.justificacion_despacho || null,
      skipped,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   REVERTIR DESPACHO (MISMO DIA)
========================= */
app.post("/api/orders/:id/revert", auth, requirePermission("action.dispatch", "revertir despachos"), requireSensitiveApproval("reversa de despacho"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      "SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido",
      { id_pedido }
    );
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    }

    const [links] = await conn.query(
      `SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad
       FROM pedido_movimiento_vinculo pmv
       JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
       JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
       WHERE pmv.id_pedido_detalle IN (
         SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido=:id_pedido
       )
       AND DATE(me.creado_en)=CURDATE()`,
      { id_pedido }
    );
    if (!links.length) return res.status(400).json({ error: "No hay movimientos reversibles hoy" });

    const movIds = [...new Set(links.map((x) => x.id_movimiento))];

    /* Validar que la bodega destino no haya movido los productos */
    const id_bodega_destino = Number(pe.id_bodega_solicita || 0);
    if (id_bodega_destino) {
      const [destRows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM kardex k
         WHERE k.id_bodega = ?
         AND k.delta_cantidad < 0
         AND k.id_producto IN (
           SELECT pd.id_producto FROM pedido_detalle pd
           WHERE pd.id_pedido = ? AND pd.cantidad_surtida > 0
         )
         AND k.id_movimiento NOT IN (${movIds.map(() => "?").join(",")})`,
        [id_bodega_destino, id_pedido, ...movIds]
      );
      if (Number(destRows[0]?.cnt || 0) > 0) {
        await conn.rollback();
        return res.status(409).json({
          error: "No se puede revertir: la bodega destino (solicitante) ya realizo movimientos de salida con los productos recibidos. El stock quedaria INCONSISTENTE.",
          code: "DESTINATION_HAS_MOVEMENTS"
        });
      }
    }

    for (const ln of links) {
      await conn.query(
        `UPDATE pedido_detalle
         SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0),
             estado_linea = CASE
               WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO'
               WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO'
               ELSE 'PENDIENTE'
             END
         WHERE id_pedido_detalle=:id`,
        { qty: ln.cantidad, id: ln.id_pedido_detalle }
      );
    }

    await conn.query(
      `DELETE FROM kardex WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM pedido_movimiento_vinculo WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_detalle WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_encabezado WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });
    const estado = recalc.estado;

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "REVERSA_DESPACHO_TOTAL",
      action_label: "Reversa total de despacho",
      approval: req.sensitive_approval,
      reference_type: "PEDIDO",
      reference_id: id_pedido,
      detail: { movimientos_revertidos: movIds.length },
    });
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: estado,
      action: "reverted",
    });
    res.json({ ok: true, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});


app.get("/api/orders/:id/lots", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT id_bodega_solicita, id_bodega_surtidor
     FROM pedido_encabezado
     WHERE id_pedido=:id_pedido
     LIMIT 1`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).json({ error: "No tienes acceso a este pedido" });
    }
  } else if (!orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).json({ error: "No tienes acceso a este pedido" });
  }
  const [rows] = await pool.query(
    `SELECT pr.nombre_producto, md.lote, md.fecha_vencimiento, md.cantidad,
            me.tipo_movimiento, me.creado_en
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


app.post("/api/orders/:id/revert-line", auth, requirePermission("action.dispatch", "revertir lineas despachadas"), requireSensitiveApproval("reversa de linea despachada"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      "SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido",
      { id_pedido }
    );
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    }

    const [links] = await conn.query(
      `SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad
       FROM pedido_movimiento_vinculo pmv
       JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
       JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
       WHERE pmv.id_pedido_detalle=:id_pedido_detalle
         AND DATE(me.creado_en)=CURDATE()`,
      { id_pedido_detalle }
    );
    if (!links.length) return res.status(400).json({ error: "No hay movimientos reversibles hoy" });

    const movIds = [...new Set(links.map((x) => x.id_movimiento))];

    /* Validar que la bodega destino no haya movido los productos (linea individual) */
    const id_bodega_destino2 = Number(pe.id_bodega_solicita || 0);
    if (id_bodega_destino2) {
      const [destRows2] = await conn.query(
        `SELECT COUNT(*) as cnt FROM kardex k
         WHERE k.id_bodega = ?
         AND k.delta_cantidad < 0
         AND k.id_producto IN (
           SELECT pd.id_producto FROM pedido_detalle pd
           WHERE pd.id_pedido_detalle = ?
         )
         AND k.id_movimiento NOT IN (${movIds.map(() => "?").join(",")})`,
        [id_bodega_destino2, id_pedido_detalle, ...movIds]
      );
      if (Number(destRows2[0]?.cnt || 0) > 0) {
        await conn.rollback();
        return res.status(409).json({
          error: "No se puede revertir la linea: la bodega destino (solicitante) ya realizo movimientos de salida con este producto. El stock quedaria INCONSISTENTE.",
          code: "DESTINATION_HAS_MOVEMENTS"
        });
      }
    }

    const reverted_qty = links.reduce((a, b) => a + Number(b.cantidad || 0), 0);

    await conn.query(
      `UPDATE pedido_detalle
       SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0),
           estado_linea = CASE
             WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO'
             WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO'
             ELSE 'PENDIENTE'
           END
       WHERE id_pedido_detalle=:id`,
      { qty: reverted_qty, id: id_pedido_detalle }
    );

    await conn.query(
      `DELETE FROM kardex WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM pedido_movimiento_vinculo WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_detalle WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_encabezado WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });
    const estado = recalc.estado;

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "REVERSA_DESPACHO_LINEA",
      action_label: "Reversa de linea despachada",
      approval: req.sensitive_approval,
      reference_type: "PEDIDO_DETALLE",
      reference_id: id_pedido_detalle,
      detail: { id_pedido, movimientos_revertidos: movIds.length, reverted_qty },
    });
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: estado,
      action: "reverted_line",
    });
    res.json({ ok: true, reverted_qty, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/orders/:id/cancel-line", auth, requirePermission("action.dispatch", "anular lineas de pedido"), enforceDailyCloseBeforeMutations, async (req, res) => {
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

    const [[pe]] = await conn.query(
      `SELECT id_bodega_solicita, id_bodega_surtidor
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido }
    );
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      return res.status(403).json({ error: "No puedes anular lineas de otra bodega" });
    }

    const [[line]] = await conn.query(
      `SELECT id_pedido_detalle, cantidad_solicitada, cantidad_surtida, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea
       FROM pedido_detalle
       WHERE id_pedido_detalle=:id_pedido_detalle
         AND id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido_detalle, id_pedido }
    );
    if (!line) return res.status(404).json({ error: "Linea no encontrada" });
    if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
      return res.status(400).json({ error: "La linea ya esta anulada." });
    }
    const pendiente = Math.max(0, Number(line.cantidad_solicitada || 0) - Number(line.cantidad_surtida || 0));
    if (pendiente <= 0) {
      return res.status(400).json({ error: "La linea ya fue despachada completamente." });
    }

    await conn.query(
      `UPDATE pedido_detalle
       SET estado_linea='ANULADO',
           justificacion_linea=:justificacion,
           anulado_por=:anulado_por,
           anulado_en=NOW()
       WHERE id_pedido_detalle=:id_pedido_detalle`,
      {
        justificacion,
        anulado_por: req.user.id_user,
        id_pedido_detalle,
      }
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
      justificacion,
    });

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: recalc.estado,
      action: "cancel_line",
    });
    res.json({
      ok: true,
      status: recalc.estado,
      justificacion_despacho: recalc.justificacion_despacho || null,
      id_pedido_detalle,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/orders/:id/uncancel-line", auth, requirePermission("action.dispatch", "rehabilitar lineas anuladas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      `SELECT id_bodega_solicita, id_bodega_surtidor
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido }
    );
    if (!pe) return res.status(404).json({ error: "Pedido no existe" });
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      return res.status(403).json({ error: "No puedes modificar lineas de otra bodega" });
    }

    const [[line]] = await conn.query(
      `SELECT id_pedido_detalle, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea
       FROM pedido_detalle
       WHERE id_pedido_detalle=:id_pedido_detalle
         AND id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido_detalle, id_pedido }
    );
    if (!line) return res.status(404).json({ error: "Linea no encontrada" });
    if (String(line.estado_linea || "").toUpperCase() !== "ANULADO") {
      return res.status(400).json({ error: "La linea no esta anulada." });
    }

    await conn.query(
      `UPDATE pedido_detalle
       SET estado_linea='PENDIENTE',
           justificacion_linea=NULL,
           anulado_por=NULL,
           anulado_en=NULL
       WHERE id_pedido_detalle=:id_pedido_detalle`,
      { id_pedido_detalle }
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: recalc.estado,
      action: "uncancel_line",
    });
    res.json({
      ok: true,
      status: recalc.estado,
      id_pedido_detalle,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/print/order/:id", auth, async (req, res) => {
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
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).send("Sin permiso");
    }
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).send("Sin permiso");
  }
  const [lines] = await pool.query(
    `SELECT d.*, pr.nombre_producto
     FROM pedido_detalle d
     JOIN productos pr ON pr.id_producto=d.id_producto
     WHERE d.id_pedido=:id_pedido
     ORDER BY pr.nombre_producto ASC`,
    { id_pedido }
  );
  const logoSrc = await getPreferredWarehousePrintLogoDataUri(oh.id_bodega_solicita, oh.id_bodega_surtidor);
  const footerHtml = buildWarehouseFooterHtml(
    { telefono_contacto: oh.req_wh_phone, direccion_contacto: oh.req_wh_address },
    { telefono_contacto: oh.from_wh_phone, direccion_contacto: oh.from_wh_address }
  );

  const html = `
<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Pedido #${id_pedido}</title>
<style>
  body{font-family: Arial; padding:16px;}
  .headLogo{display:block; margin:0 auto 10px; max-height:64px; width:auto; object-fit:contain;}
  .headTitle{margin:4px 0 0; text-align:center;}
  .row{display:flex; justify-content:space-between; gap:12px;}
  .muted{color:#666; font-size:12px;}
  table{width:100%; border-collapse:collapse; margin-top:12px;}
  th,td{border:1px solid #ddd; padding:4px 6px; font-size:11px; line-height:1.2;}
  th{background:#f5f5f5;}
  @media print{
    @page{ size: A4 portrait; margin: 10mm; }
  }
</style>
</head><body>
  <img class="headLogo" src="${logoSrc}" alt="Hotel Jardines del Lago" />
  <h2 class="headTitle">Pedido #${id_pedido}</h2>
  <div class="row">
    <div>
      <div class="muted">Solicita</div>
      <div><b>${oh.requester_name || ""}</b></div>
      <div class="muted">Area/Bodega: ${oh.req_wh || ""}</div>
    </div>
    <div>
      <div class="muted">De bodega</div>
      <div><b>${oh.from_wh || ""}</b></div>
      <div class="muted">Fecha: ${oh.creado_en ? (() => {
        const dt = new Date(oh.creado_en);
        if (Number.isNaN(dt.getTime())) return "";
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const yyyy = dt.getFullYear();
        const hh = String(dt.getHours()).padStart(2, "0");
        const mi = String(dt.getMinutes()).padStart(2, "0");
        const ss = String(dt.getSeconds()).padStart(2, "0");
        return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`;
      })() : ""}</div>
      <div class="muted">Estado: ${oh.estado || ""}</div>
    </div>
  </div>
  ${oh.observaciones ? `<p><b>Notas:</b> ${oh.observaciones}</p>` : ``}
  <table>
    <thead><tr><th>Producto</th><th>Cant.</th><th>Despachado</th><th>Observacion</th></tr></thead>
    <tbody>
      ${lines.map(x=>`
        <tr>
          <td>${x.nombre_producto}</td>
          <td style="text-align:right">${x.cantidad_solicitada}</td>
          <td style="text-align:right">${x.cantidad_surtida}</td>
          <td>${x.observacion_producto ?? ""}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  <script>window.print()</script>

  <div style="margin-top:48px; display:flex; gap:20px;">
    <div style="flex:1; text-align:center;">
      <div style="border-top:1px solid #999; padding-top:6px; font-size:12px;">Firma solicitante<br/>${oh.requester_name || ""}</div>
    </div>
    <div style="flex:1; text-align:center;">
      <div style="border-top:1px solid #999; padding-top:6px; font-size:12px;">Firma despacha<br/>${oh.approver_name || ""}</div>
    </div>
  </div>
</body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

