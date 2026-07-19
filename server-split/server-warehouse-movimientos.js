// server-warehouse-movimientos.js  |  Movimientos de inventario: entradas y ajustes
import { pool, auth, requirePermission, enforceDailyCloseBeforeMutations, verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit, resolveStockScope, beginIdempotentRequest, isProductVisibleInWarehouse, pickLotsFEFO, getLastUnitCost } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.post("/api/entradas", auth, requirePermission("action.create_update", "registrar entradas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const {
    id_motivo,
    id_proveedor = null,
    no_documento = null,
    observaciones = null,
    pagado = null,
    lines = [],
  } = req.body || {};

  if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas" });

  const id_bodega_destino = Number(req.user.id_warehouse || 0);
  if (!id_bodega_destino) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/entradas" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const obsFinal =
    pagado ? `${observaciones ? `${observaciones} | ` : ""}Pagado: ${String(pagado)}` : observaciones;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let sensitiveApproval = null;
    const [[mot]] = await conn.query(
      `SELECT id_motivo, tipo_movimiento, nombre_motivo
       FROM motivos_movimiento
       WHERE id_motivo=:id_motivo
       LIMIT 1`,
      { id_motivo: Number(id_motivo || 0) }
    );
    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo no existe" });
    }
    const motType = String(mot.tipo_movimiento || "").toUpperCase();
    if (!["ENTRADA", "AJUSTE"].includes(motType)) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo invalido para entrada" });
    }
    if (motType === "AJUSTE") {
      const approval = await verifySensitiveApproval(req, conn, "ajuste manual de entrada");
      if (!approval.ok) {
        await conn.rollback();
        return res.status(Number(approval.status || 403)).json(approval);
      }
      sensitiveApproval = approval;
    }

    const [r] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_destino, id_proveedor, no_documento, observaciones, creado_por)
       VALUES ('ENTRADA', :id_motivo, :id_bodega_destino, :id_proveedor, :no_documento, :observaciones, :creado_por)`,
      {
        id_motivo,
        id_bodega_destino,
        id_proveedor: id_proveedor || null,
        no_documento: no_documento || null,
        observaciones: obsFinal || null,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento = r.insertId;

    for (const ln of lines) {
      if (!ln.id_producto) throw new Error("Linea sin producto");
      if (!(await isProductVisibleInWarehouse(conn, ln.id_producto, id_bodega_destino))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${ln.id_producto} no esta habilitado para la bodega destino` });
      }
      const cantidad = Number(ln.cantidad || ln.qty || ln.qty_requested || 0);
      if (!cantidad || cantidad <= 0) continue;
      const costo_unitario = Number(ln.precio || ln.costo_unitario || 0);

      const [d] = await conn.query(
        `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
         VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
        {
          id_movimiento,
          id_producto: ln.id_producto,
          lote: ln.lote || null,
          fecha_vencimiento: ln.caducidad || null,
          cantidad,
          costo_unitario,
          observacion_linea: ln.observacion_linea || null,
        }
      );
      const id_detalle = d.insertId;

      await conn.query(
        `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
         VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
        {
          id_movimiento,
          id_detalle,
          id_bodega: id_bodega_destino,
          id_producto: ln.id_producto,
          lote: ln.lote || null,
          fecha_vencimiento: ln.caducidad || null,
          delta_cantidad: cantidad,
          costo_unitario,
        }
      );
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "ENTRADA_AJUSTE_MANUAL",
      action_label: "Ajuste manual en entrada",
      approval: sensitiveApproval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { id_motivo: Number(id_motivo || 0), lineas: Number(lines.length || 0) },
    });
    res.json({ ok: true, id_movimiento, sensitive_approval: toSensitiveApprovalPayload(sensitiveApproval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.get("/api/entradas/existe-documento", auth, async (req, res) => {
  try {
    const no_documento = String(req.query.no_documento || "").trim();
    if (!no_documento) return res.status(400).json({ error: "Falta no_documento" });
    const id_bodega = Number(req.user?.id_warehouse || 0);
    const id_usuario = Number(req.user?.id_user || 0);
    if (!id_bodega || !id_usuario) return res.status(400).json({ error: "Usuario sin bodega" });

    const [[row]] = await pool.query(
      `SELECT id_movimiento, creado_en
       FROM movimiento_encabezado
       WHERE tipo_movimiento='ENTRADA'
         AND id_bodega_destino=:id_bodega
         AND creado_por=:id_usuario
         AND no_documento=:no_documento
         AND DATE(creado_en)=CURDATE()
       ORDER BY id_movimiento DESC
       LIMIT 1`,
      { id_bodega, id_usuario, no_documento }
    );
    if (!row?.id_movimiento) return res.json({ exists: false });
    return res.json({ exists: true, id_movimiento: Number(row.id_movimiento || 0), creado_en: row.creado_en || null });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/ajustes", auth, requirePermission("action.create_update", "registrar ajustes"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { direccion = "", id_motivo, observaciones = null, lines = [], id_bodega: id_bodega_input = null } = req.body || {};
  const dir = String(direccion || "").trim().toUpperCase();
  if (!["ENTRADA", "SALIDA"].includes(dir)) return res.status(400).json({ error: "Direccion invalida: ENTRADA o SALIDA" });
  if (!id_motivo) return res.status(400).json({ error: "Falta motivo de ajuste" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas de ajuste" });

  const scope = await resolveStockScope(req.user);
  const requestedWarehouse = Number(id_bodega_input || 0);
  const id_bodega = scope.can_all_bodegas ? (requestedWarehouse > 0 ? requestedWarehouse : scope.id_bodega) : scope.id_bodega;
  if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/ajustes" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[warehouseRow]] = await conn.query(
      `SELECT id_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
         AND activo=1
       LIMIT 1`,
      { id_bodega }
    );
    if (!warehouseRow) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega no valida para ajuste" });
    }

    const [[motivo]] = await conn.query(
      `SELECT id_motivo, tipo_movimiento, nombre_motivo, activo
       FROM motivos_movimiento
       WHERE id_motivo=:id_motivo
       LIMIT 1`,
      { id_motivo: Number(id_motivo || 0) }
    );
    if (!motivo || Number(motivo.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo no disponible" });
    }
    if (String(motivo.tipo_movimiento || "").toUpperCase() !== "AJUSTE") {
      await conn.rollback();
      return res.status(400).json({ error: "El motivo seleccionado no es de tipo AJUSTE" });
    }

    const approval = await verifySensitiveApproval(req, conn, `ajuste ${dir.toLowerCase()}`);
    if (!approval.ok) {
      await conn.rollback();
      return res.status(Number(approval.status || 403)).json(approval);
    }

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('AJUSTE', :id_motivo, :id_bodega_origen, :id_bodega_destino, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        id_motivo: Number(id_motivo || 0),
        id_bodega_origen: dir === "SALIDA" ? id_bodega : null,
        id_bodega_destino: dir === "ENTRADA" ? id_bodega : null,
        observaciones: String(observaciones || "").trim() || `Ajuste ${dir}`,
        creado_por: Number(req.user?.id_user || 0),
      }
    );
    const id_movimiento = Number(mhRes.insertId || 0);
    let appliedLines = 0;

    for (const ln of lines) {
      const id_producto = Number(ln?.id_producto || 0);
      const qtyRequested = Number(ln?.cantidad || 0);
      if (!id_producto || qtyRequested <= 0) continue;
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega seleccionada` });
      }

      if (dir === "ENTRADA") {
        const lote = String(ln?.lote || "").trim() || null;
        const fecha_vencimiento = String(ln?.caducidad || "").trim() || null;
        const costo_unitario = Number(ln?.costo_unitario || 0);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
          {
            id_movimiento,
            id_producto,
            lote,
            fecha_vencimiento,
            cantidad: qtyRequested,
            costo_unitario,
            observacion_linea: String(ln?.observacion_linea || "").trim() || null,
          }
        );
        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
          {
            id_movimiento,
            id_detalle: Number(d.insertId || 0),
            id_bodega,
            id_producto,
            lote,
            fecha_vencimiento,
            delta_cantidad: qtyRequested,
            costo_unitario,
          }
        );
        appliedLines += 1;
        continue;
      }

      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega, id_producto, qtyRequested);
      if (!picks.length || remaining > 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para producto #${id_producto}` });
      }

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, id_bodega, id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
          {
            id_movimiento,
            id_producto,
            lote: p.lote || null,
            fecha_vencimiento: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo_unitario,
            observacion_linea: String(ln?.observacion_linea || "").trim() || null,
          }
        );
        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
          {
            id_movimiento,
            id_detalle: Number(d.insertId || 0),
            id_bodega,
            id_producto,
            lote: p.lote || null,
            fecha_vencimiento: p.fecha_vencimiento || null,
            delta_cantidad: -Number(p.qty || 0),
            costo_unitario,
          }
        );
      }
      appliedLines += 1;
    }

    if (!appliedLines) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin lineas validas para ajuste" });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: dir === "ENTRADA" ? "ENTRADA_AJUSTE_MANUAL" : "SALIDA_AJUSTE_MANUAL",
      action_label: dir === "ENTRADA" ? "Ajuste manual en entrada" : "Ajuste manual en salida",
      approval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { direccion: dir, id_motivo: Number(id_motivo || 0), lineas: appliedLines },
    });
    res.json({
      ok: true,
      id_movimiento,
      tipo_movimiento: "AJUSTE",
      direccion: dir,
      sensitive_approval: toSensitiveApprovalPayload(approval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

export default router;
