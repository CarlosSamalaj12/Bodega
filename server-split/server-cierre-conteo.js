// server-cierre-conteo.js  |  Conteo final routes (modular)
import { pool, auth, requirePermission, enforceDailyCloseBeforeMutations, verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit, resolveStockScope, getScopedWarehouseFilter, beginIdempotentRequest, isProductVisibleInWarehouse, pickLotsFEFO, getLastUnitCost } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
router.post("/api/salidas/conteo-final", auth, requirePermission("action.create_update", "registrar salidas por conteo final"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_bodega: id_bodega_input = null, observaciones = null, lines = [] } = req.body || {};
  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: "Sin lineas para procesar" });
  }
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/salidas/conteo-final" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const scope = await resolveStockScope(req.user);
  const requestedWarehouse = Number(id_bodega_input || 0);
  if (requestedWarehouse <= 0) {
    return res.status(400).json({ error: "Debes seleccionar una bodega especifica" });
  }
  const warehouseScope = getScopedWarehouseFilter(scope, requestedWarehouse);
  if (warehouseScope.denied || !warehouseScope.selected) {
    return res.status(400).json({ error: "Bodega no valida para conteo final" });
  }
  const id_bodega = scope.can_all_bodegas ? warehouseScope.selected : scope.id_bodega;
  if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[warehouseRow]] = await conn.query(
      `SELECT b.id_bodega, b.nombre_bodega, b.activo, cb.maneja_stock, cb.permite_salida_conteo_final
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );
    if (!warehouseRow || Number(warehouseRow.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega no disponible" });
    }
    if (Number(warehouseRow.maneja_stock || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega seleccionada no maneja stock" });
    }
    if (Number(warehouseRow.permite_salida_conteo_final || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega seleccionada no tiene habilitada la salida por conteo final" });
    }

    const [[motivo]] = await conn.query(
      `SELECT id_motivo, nombre_motivo, tipo_movimiento, activo
       FROM motivos_movimiento
       WHERE tipo_movimiento='AJUSTE'
         AND activo=1
       ORDER BY
         (UPPER(nombre_motivo) LIKE '%CONTEO%') DESC,
         (UPPER(nombre_motivo) LIKE '%INVENTARIO%') DESC,
         id_motivo ASC
       LIMIT 1`
    );
    if (!motivo) {
      await conn.rollback();
      return res.status(400).json({ error: "No existe un motivo activo de AJUSTE para registrar el conteo final" });
    }

    const approval = await verifySensitiveApproval(req, conn, "salida por conteo final");
    if (!approval.ok) {
      await conn.rollback();
      return res.status(Number(approval.status || 403)).json(approval);
    }

    const obsBase = String(observaciones || "").trim();
    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('AJUSTE', :id_motivo, :id_bodega_origen, NULL, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        id_motivo: Number(motivo.id_motivo || 0),
        id_bodega_origen: id_bodega,
        observaciones:
          obsBase ||
          `Salida automatica por conteo final de ${warehouseRow.nombre_bodega || `bodega #${id_bodega}`}`,
        creado_por: Number(req.user?.id_user || 0),
      }
    );
    const id_movimiento = Number(mhRes.insertId || 0);

    let appliedLines = 0;
    let affectedProducts = 0;
    let totalSalida = 0;

    for (const ln of lines) {
      const id_producto = Number(ln?.id_producto || 0);
      if (!id_producto) continue;
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega seleccionada` });
      }

      const existenciaFinal = Number(ln?.existencia_final);
      if (!Number.isFinite(existenciaFinal) || existenciaFinal < 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Existencia final invalida para producto #${id_producto}` });
      }

      const [[stockRow]] = await conn.query(
        `SELECT COALESCE(stock, 0) AS stock
         FROM v_stock_resumen
         WHERE id_bodega=:id_bodega
           AND id_producto=:id_producto
         LIMIT 1`,
        { id_bodega, id_producto }
      );
      const existenciaActual = Number(stockRow?.stock || 0);
      if (existenciaFinal > existenciaActual) {
        await conn.rollback();
        return res.status(400).json({
          error: `La existencia final no puede ser mayor a la existencia actual para producto #${id_producto}`,
        });
      }

      const qtyRequested = existenciaActual - existenciaFinal;
      if (qtyRequested <= 0) continue;

      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega, id_producto, qtyRequested);
      if (!picks.length || remaining > 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para producto #${id_producto}` });
      }

      const notePrefix = `Conteo final. Sistema: ${existenciaActual}. Final: ${existenciaFinal}. Salida: ${qtyRequested}.`;
      const extraNote = String(ln?.observacion_linea || "").trim();
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
            cantidad: Number(p.qty || 0),
            costo_unitario,
            observacion_linea: extraNote ? `${notePrefix} ${extraNote}` : notePrefix,
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
        totalSalida += Number(p.qty || 0);
      }
      appliedLines += 1;
      affectedProducts += 1;
    }

    if (!appliedLines) {
      await conn.rollback();
      return res.status(400).json({ error: "No hay diferencias para generar salidas" });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "SALIDA_AJUSTE_MANUAL",
      action_label: "Salida por conteo final",
      approval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: {
        id_bodega,
        id_motivo: Number(motivo.id_motivo || 0),
        productos: affectedProducts,
        lineas: appliedLines,
        total_salida: totalSalida,
      },
    });

    res.json({
      ok: true,
      id_movimiento,
      tipo_movimiento: "AJUSTE",
      direccion: "SALIDA",
      id_bodega,
      total_productos: affectedProducts,
      total_salida: totalSalida,
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
