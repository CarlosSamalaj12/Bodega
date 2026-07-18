// server-cierre.js  |  Cierre routes (modular)
import { app, pool, auth, requirePermission, enforceDailyCloseBeforeMutations, verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit, resolveStockScope, softDelete, getScopedWarehouseFilter } from '../server-shared.js';
// -------------------------------------------------------
app.post("/api/salidas/conteo-final", auth, requirePermission("action.create_update", "registrar salidas por conteo final"), enforceDailyCloseBeforeMutations, async (req, res) => {
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

/* =========================
   BODEGAS (CREAR)
========================= */
app.post("/api/bodegas", auth, async (req, res) => {
  const {
    nombre_bodega,
    tipo_bodega,
    activo = 1,
    maneja_stock = 1,
    puede_recibir = 1,
    puede_despachar = 1,
    modo_despacho_auto = "SALIDA",
    id_bodega_destino_default = null,
    permite_salida_conteo_final = 0,
    requiere_precio_salida = 0,
    telefono_contacto = null,
    direccion_contacto = null,
  } = req.body || {};

  if (!nombre_bodega) return res.status(400).json({ error: "Falta nombre" });
  if (!tipo_bodega) return res.status(400).json({ error: "Falta tipo" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO bodegas (nombre_bodega, tipo_bodega, activo, telefono_contacto, direccion_contacto)
       VALUES (:nombre_bodega, :tipo_bodega, :activo, :telefono_contacto, :direccion_contacto)`,
      {
        nombre_bodega,
        tipo_bodega,
        activo: activo ? 1 : 0,
        telefono_contacto: String(telefono_contacto || "").trim() || null,
        direccion_contacto: String(direccion_contacto || "").trim() || null,
      }
    );
    const id_bodega = r.insertId;

    await conn.query(
      `INSERT INTO configuracion_bodega
       (id_bodega, maneja_stock, puede_recibir, puede_despachar, modo_despacho_auto, id_bodega_destino_default, permite_salida_conteo_final, requiere_precio_salida)
       VALUES (:id_bodega, :maneja_stock, :puede_recibir, :puede_despachar, :modo_despacho_auto, :id_bodega_destino_default, :permite_salida_conteo_final, :requiere_precio_salida)`,
      {
        id_bodega,
        maneja_stock: maneja_stock ? 1 : 0,
        puede_recibir: puede_recibir ? 1 : 0,
        puede_despachar: puede_despachar ? 1 : 0,
        modo_despacho_auto,
        id_bodega_destino_default: id_bodega_destino_default || null,
        permite_salida_conteo_final: permite_salida_conteo_final ? 1 : 0,
        requiere_precio_salida: requiere_precio_salida ? 1 : 0,
      }
    );

    await conn.commit();
    res.json({ ok: true, id_bodega });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/categories", auth, async (req, res) => {
  const { category_name } = req.body || {};
  if (!category_name) return res.status(400).json({ error: "Falta nombre" });
  await pool.query("INSERT INTO categories(category_name, active) VALUES(:category_name, 1)", { category_name });
  res.json({ ok: true });
});

app.put("/api/categories/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const { category_name, active } = req.body || {};
  await pool.query(
    "UPDATE categories SET category_name=COALESCE(:category_name, category_name), active=COALESCE(:active, active) WHERE id_category=:id",
    { id, category_name: category_name ?? null, active: typeof active === "number" ? active : null }
  );
  res.json({ ok: true });
});

app.delete("/api/categories/:id", auth, async (req, res) => {
  await softDelete("categories", "id_category", Number(req.params.id));
  res.json({ ok: true });
});

/* =========================
   STOCK (solo con stock + no vencido opcional)
========================= */
app.get("/api/stock", auth, async (req, res) => {
  const id_warehouse = Number(req.query.warehouse || req.user.id_warehouse || 0);
  const onlyWithStock = String(req.query.onlyWithStock || "1") === "1";
  const includeLots = String(req.query.includeLots || "1") === "1";
  const notExpiredOnly = String(req.query.notExpiredOnly || "1") === "1";

  if (!id_warehouse) return res.status(400).json({ error: "Falta bodega" });

  if (includeLots) {
    const [rows] = await pool.query(
      `
      SELECT
        v.id_producto, p.nombre_producto, p.sku,
        v.lote, v.fecha_vencimiento,
        v.stock
      FROM v_stock_por_lote v
      JOIN productos p ON p.id_producto=v.id_producto
      WHERE v.id_bodega=:id_bodega
        ${onlyWithStock ? "AND v.stock > 0" : ""}
        ${notExpiredOnly ? "AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())" : ""}
      ORDER BY p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
      `,
      { id_bodega: id_warehouse }
    );
    return res.json(rows);
  } else {
    const [rows] = await pool.query(
      `
      SELECT
        s.id_producto, p.nombre_producto, p.sku,
        s.stock
      FROM v_stock_resumen s
      JOIN productos p ON p.id_producto=s.id_producto
      WHERE s.id_bodega=:id_bodega
        ${onlyWithStock ? "AND s.stock > 0" : ""}
      ORDER BY p.nombre_producto ASC
      `,
      { id_bodega: id_warehouse }
    );
    return res.json(rows);
  }
});

/* =========================
   REPORTE EXISTENCIAS + ALERTAS
========================= */
app.get("/api/reportes/existencias", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.json([]);
  if (!scope.can_all_bodegas && !scope.maneja_stock) return res.json([]);

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
  if (warehouseScope.denied) return res.json([]);
  let id_bodega = warehouseScope.selected;
  if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
  const accessFilter =
    warehouseScope.restrictedIds.length && !id_bodega
      ? buildNamedInClause(warehouseScope.restrictedIds, "rexw")
      : null;

  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "rexq");
  const from_date = String(req.query.from || "").trim() || null;
  const to_date = String(req.query.to || "").trim() || null;
  const id_categoria = Number(req.query.categoria || 0) || null;
  const id_subcategoria = Number(req.query.subcategoria || 0) || null;
  const include_zero_stock = req.query.include_zero_stock === "1" || req.query.include_zero_stock === "true";
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

  const [rows] = await pool.query(
    `SELECT v.id_bodega,
            b.nombre_bodega,
            v.id_producto,
            p.nombre_producto,
            p.sku,
            p.id_subcategoria,
            sc.nombre_subcategoria,
            COALESCE(lpb.minimo, 0) AS minimo_stock,
            COALESCE(lpb.maximo, 0) AS maximo_stock,
            v.lote,
            v.fecha_vencimiento,
            v.stock,
            CASE
              WHEN v.fecha_vencimiento IS NULL THEN NULL
              ELSE DATEDIFF(v.fecha_vencimiento, CURDATE())
            END AS dias_para_vencer,
            rs.max_dias_vida,
            rs.dias_alerta_antes,
            e.fecha_entrada_lote,
            CASE
              WHEN e.fecha_entrada_lote IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), e.fecha_entrada_lote)
            END AS dias_en_bodega,
            CASE
              WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR e.fecha_entrada_lote IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), e.fecha_entrada_lote)
            END AS dias_restantes_regla
            ,
            (
              COALESCE(
                (
                  SELECT k2.costo_unitario
                  FROM kardex k2
                  WHERE k2.id_bodega=v.id_bodega
                    AND k2.id_producto=v.id_producto
                    AND (k2.lote <=> v.lote)
                    AND (k2.fecha_vencimiento <=> v.fecha_vencimiento)
                    AND k2.delta_cantidad > 0
                  ORDER BY k2.creado_en DESC
                  LIMIT 1
                ),
                (
                  SELECT k2b.costo_unitario
                  FROM kardex k2b
                  WHERE k2b.id_bodega=v.id_bodega
                    AND k2b.id_producto=v.id_producto
                    AND k2b.delta_cantidad > 0
                  ORDER BY k2b.creado_en DESC
                  LIMIT 1
                ),
                0
              )
            ) AS costo_unitario_ref,
            (
              v.stock * COALESCE(
                (
                  SELECT k3.costo_unitario
                  FROM kardex k3
                  WHERE k3.id_bodega=v.id_bodega
                    AND k3.id_producto=v.id_producto
                    AND (k3.lote <=> v.lote)
                    AND (k3.fecha_vencimiento <=> v.fecha_vencimiento)
                    AND k3.delta_cantidad > 0
                  ORDER BY k3.creado_en DESC
                  LIMIT 1
                ),
                (
                  SELECT k3b.costo_unitario
                  FROM kardex k3b
                  WHERE k3b.id_bodega=v.id_bodega
                    AND k3b.id_producto=v.id_producto
                    AND k3b.delta_cantidad > 0
                  ORDER BY k3b.creado_en DESC
                  LIMIT 1
                ),
                0
              )
            ) AS total_linea
     FROM v_stock_por_lote v
     JOIN bodegas b ON b.id_bodega=v.id_bodega
     JOIN productos p ON p.id_producto=v.id_producto
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     LEFT JOIN limites_producto_bodega lpb
            ON lpb.id_bodega=v.id_bodega
           AND lpb.id_producto=v.id_producto
           AND lpb.activo=1
     LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
     LEFT JOIN (
       SELECT id_bodega, id_producto, lote, fecha_vencimiento, MIN(DATE(creado_en)) AS fecha_entrada_lote
       FROM kardex
       WHERE delta_cantidad > 0
       GROUP BY id_bodega, id_producto, lote, fecha_vencimiento
     ) e ON e.id_bodega=v.id_bodega
         AND e.id_producto=v.id_producto
         AND (e.lote <=> v.lote)
         AND (e.fecha_vencimiento <=> v.fecha_vencimiento)
     WHERE ${include_zero_stock ? "1=1" : "v.stock > 0"}
       AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
       AND ${qf.clause}
       AND (:from_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= :from_date)
       AND (:to_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento <= :to_date)
       AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
       AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
     ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
     LIMIT ${limit}`,
    { id_bodega, from_date, to_date, id_categoria, id_subcategoria, ...(accessFilter?.params || {}), ...qf.params }
  );
  res.json(rows);
});

app.get("/api/reportes/existencias/alertas", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.json([]);
  if (!scope.can_all_bodegas && !scope.maneja_stock) return res.json([]);

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
  if (warehouseScope.denied) return res.json([]);
  let id_bodega = warehouseScope.selected;
  if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
  const accessFilter =
    warehouseScope.restrictedIds.length && !id_bodega
      ? buildNamedInClause(warehouseScope.restrictedIds, "realw")
      : null;

  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "realq");
  const from_date = String(req.query.from || "").trim() || null;
  const to_date = String(req.query.to || "").trim() || null;
  const id_categoria = Number(req.query.categoria || 0) || null;
  const id_subcategoria = Number(req.query.subcategoria || 0) || null;
  const days = Math.max(1, Math.min(365, Number(req.query.days || 15)));
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

  const [rows] = await pool.query(
    `SELECT v.id_bodega,
            b.nombre_bodega,
            v.id_producto,
            p.nombre_producto,
            p.sku,
            p.id_subcategoria,
            sc.nombre_subcategoria,
            v.lote,
            v.fecha_vencimiento,
            v.stock,
            DATEDIFF(v.fecha_vencimiento, CURDATE()) AS dias_para_vencer,
            rs.max_dias_vida,
            rs.dias_alerta_antes,
            e.fecha_entrada_lote,
            CASE
              WHEN e.fecha_entrada_lote IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), e.fecha_entrada_lote)
            END AS dias_en_bodega,
            CASE
              WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR e.fecha_entrada_lote IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), e.fecha_entrada_lote)
            END AS dias_restantes_regla
     FROM v_stock_por_lote v
     JOIN bodegas b ON b.id_bodega=v.id_bodega
     JOIN productos p ON p.id_producto=v.id_producto
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
     LEFT JOIN (
       SELECT id_bodega, id_producto, lote, fecha_vencimiento, MIN(DATE(creado_en)) AS fecha_entrada_lote
       FROM kardex
       WHERE delta_cantidad > 0
       GROUP BY id_bodega, id_producto, lote, fecha_vencimiento
     ) e ON e.id_bodega=v.id_bodega
         AND e.id_producto=v.id_producto
         AND (e.lote <=> v.lote)
         AND (e.fecha_vencimiento <=> v.fecha_vencimiento)
     WHERE v.stock > 0
       AND (
         (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) <= :days)
         OR (
           COALESCE(rs.max_dias_vida,0) > 0
           AND e.fecha_entrada_lote IS NOT NULL
           AND (rs.max_dias_vida - DATEDIFF(CURDATE(), e.fecha_entrada_lote)) <= GREATEST(COALESCE(rs.dias_alerta_antes,0),0)
         )
       )
       AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
       AND ${qf.clause}
       AND (:from_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= :from_date)
       AND (:to_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento <= :to_date)
       AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
       AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
     ORDER BY DATEDIFF(v.fecha_vencimiento, CURDATE()) ASC, b.nombre_bodega ASC, p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, from_date, to_date, days, id_categoria, id_subcategoria, ...(accessFilter?.params || {}), ...qf.params }
  );
  res.json(rows);
});

app.get("/api/reportes/corte-diario", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) {
    return res.json({
      bodega: null,
      fecha_ayer: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      fecha_hoy: new Date().toISOString().slice(0, 10),
      rows: [],
    });
  }

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse, { fallbackToDefault: true });
  if (warehouseScope.denied || !warehouseScope.selected) {
    return res.json({
      bodega: null,
      fecha_ayer: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      fecha_hoy: new Date().toISOString().slice(0, 10),
      rows: [],
    });
  }
  const id_bodega = warehouseScope.selected;
  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "rcdq");
  const show_all = String(req.query.show_all || "") === "1" ? 1 : 0;
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 1000)));

  const [[bod]] = await pool.query(
    `SELECT nombre_bodega
     FROM bodegas
     WHERE id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );

  const [rows] = await pool.query(
    `SELECT p.id_producto,
            p.nombre_producto,
            p.sku,
            COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
            COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
            COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
            COALESCE(SUM(k.delta_cantidad), 0) AS existencia_actual
     FROM productos p
     LEFT JOIN (
       SELECT k.*
       FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento AND me.estado<>'ANULADO'
     ) k
       ON k.id_producto=p.id_producto
      AND k.id_bodega=:id_bodega
     WHERE p.activo=1
       AND ${qf.clause}
     GROUP BY p.id_producto, p.nombre_producto, p.sku
     HAVING (:show_all=1
             OR ABS(existencia_ayer) > 0
             OR ABS(entradas_hoy) > 0
             OR ABS(existencia_actual) > 0)
     ORDER BY p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, show_all, ...qf.params }
  );

  res.json({
    bodega: bod?.nombre_bodega || `Bodega #${id_bodega}`,
    fecha_ayer: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    fecha_hoy: new Date().toISOString().slice(0, 10),
    rows,
  });
});

function isCuadreAllWarehousesRoleName(roleName) {
  const n = String(roleName || "").trim().toUpperCase();
  return n.includes("ADMIN") || n.includes("REPORTE");
}

async function resolveCuadreScope(user) {
  const id_usuario = Number(user?.id_user || 0);
  const id_rol = Number(user?.id_role || 0);
  const id_bodega_usuario = Number(user?.id_warehouse || 0) || null;

  let roleName = "";
  if (id_rol > 0) {
    const [[roleRow]] = await pool.query(
      `SELECT nombre_rol
       FROM roles
       WHERE id_rol=:id_rol
       LIMIT 1`,
      { id_rol }
    );
    roleName = String(roleRow?.nombre_rol || "").trim();
  }

  const can_all_bodegas = isCuadreAllWarehousesRoleName(roleName);

  const [bodegas] = await pool.query(
    `SELECT id_bodega, nombre_bodega
     FROM bodegas
     WHERE activo=1
     ORDER BY nombre_bodega ASC`
  );
  const rows = Array.isArray(bodegas) ? bodegas : [];
  const ids = rows.map((b) => Number(b.id_bodega || 0)).filter((x) => x > 0);

  const id_bodega_default = id_bodega_usuario && ids.includes(id_bodega_usuario)
    ? id_bodega_usuario
    : (ids[0] || null);

  if (!can_all_bodegas) {
    if (id_bodega_usuario && ids.includes(id_bodega_usuario)) {
      return {
        id_usuario,
        can_all_bodegas,
        id_bodega_default,
        allowed_ids: [id_bodega_usuario],
        bodegas: rows.filter((b) => Number(b.id_bodega || 0) === id_bodega_usuario),
      };
    }
    return {
      id_usuario,
      can_all_bodegas,
      id_bodega_default: null,
      allowed_ids: [],
      bodegas: [],
    };
  }

  return {
    id_usuario,
    can_all_bodegas,
    id_bodega_default,
    allowed_ids: ids,
    bodegas: rows,
  };
}

app.get("/api/cuadre-caja/context", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    return res.json({
      ok: true,
      can_all_bodegas: scope.can_all_bodegas,
      id_bodega_default: scope.id_bodega_default,
      bodegas: scope.bodegas || [],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver reporte de cuadres de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    const fechaRaw = String(req.query.fecha || "").trim();
    const fecha = normalizeYmdInput(fechaRaw);
    const responsable = String(req.query.responsable || "").trim();
    const requested = Number(req.query.warehouse || 0) || 0;
    const limit = Math.max(1, Math.min(300, Number(req.query.limit || 200)));

    if (fechaRaw && !fecha) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }

    let warehouseFilter = null;
    if (scope.can_all_bodegas) {
      warehouseFilter = requested > 0 ? requested : null;
    } else {
      const allowedId = Number(scope.allowed_ids?.[0] || 0);
      if (!allowedId) return res.json({ ok: true, rows: [] });
      if (requested > 0 && requested !== allowedId) {
        return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
      }
      warehouseFilter = allowedId;
    }

    const params = { limit };
    const where = [];
    if (fecha) {
      where.push('cc.fecha=:fecha');
      params['fecha'] = fecha;
    }
    if (warehouseFilter) {
      where.push('cc.id_bodega=:id_bodega');
      params['id_bodega'] = warehouseFilter;
    }
    if (responsable) {
      where.push('cc.responsable LIKE :responsable');
      params['responsable'] = `%${responsable}%`;
    }

    const sql = `SELECT cc.fecha,
                        cc.id_bodega,
                        b.nombre_bodega,
                        cc.sede,
                        cc.responsable,
                        cc.total_efectivo,
                        cc.total_cobro,
                        cc.total_venta_ambiente,
                        cc.gran_total_reporte,
                        cc.actualizado_en
                 FROM cuadre_caja cc
                 INNER JOIN bodegas b ON b.id_bodega=cc.id_bodega
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY cc.fecha DESC, cc.actualizado_en DESC
                 LIMIT :limit`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, rows: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);

    const fechaSource = req.method === "POST" ? (req.body?.fecha || req.query.fecha) : req.query.fecha;
    const fechaRaw = String(fechaSource || "").trim();
    const fecha = normalizeYmdInput(fechaRaw) || ymd(new Date()) || "";
    if (fechaRaw && !fecha) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }

    const warehouseSource = req.method === "POST" ? (req.body?.warehouse || req.query.warehouse) : req.query.warehouse;
    const requested = Number(warehouseSource || 0) || 0;
    const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
    if (!id_bodega) return res.status(400).json({ error: "No hay bodega disponible para el usuario" });

    if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
      return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
    }

    const [[bod]] = await pool.query(
      `SELECT nombre_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );

    const [[row]] = await pool.query(
      `SELECT id_cuadre,
              fecha,
              id_bodega,
              sede,
              responsable,
              payload_json,
              total_efectivo,
              total_cobro,
              total_venta_ambiente,
              gran_total_reporte,
              creado_en,
              actualizado_en
       FROM cuadre_caja
       WHERE fecha=:fecha
         AND id_bodega=:id_bodega
       LIMIT 1`,
      { fecha, id_bodega }
    );

    let parsedPayload = {};
    if (row?.payload_json) {
      try {
        parsedPayload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        parsedPayload = {};
      }
    }

    const normalized = normalizeCuadrePayload(parsedPayload, {
      sede: row?.sede || "",
      responsable: row?.responsable || "",
    });

    return res.json({
      ok: true,
      fecha,
      id_bodega,
      bodega: bod?.nombre_bodega || `Bodega #${id_bodega}`,
      exists: Boolean(row?.id_cuadre),
      id_cuadre: Number(row?.id_cuadre || 0) || null,
      payload: normalized.payload,
      totals: {
        total_efectivo: Number(row?.total_efectivo ?? normalized.total_efectivo ?? 0),
        total_cobro: Number(row?.total_cobro ?? normalized.total_cobro ?? 0),
        total_venta_ambiente: Number(row?.total_venta_ambiente ?? normalized.total_venta_ambiente ?? 0),
        gran_total_reporte: Number(row?.gran_total_reporte ?? normalized.gran_total_reporte ?? 0),
      },
      creado_en: row?.creado_en || null,
      actualizado_en: row?.actualizado_en || null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post(
  "/api/cuadre-caja",
  auth,
  requirePermission("section.view.cuadre-caja", "usar modulo cuadre de caja"),
  requirePermission("action.create_update", "guardar cuadre de caja"),
  async (req, res) => {
    try {
      const scope = await resolveCuadreScope(req.user);
      const fechaRaw = String(req.body?.fecha || "").trim();
      const fecha = normalizeYmdInput(fechaRaw);
      if (!fecha) {
        return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
      }

      const requested = Number(req.body?.id_bodega || 0) || 0;
      const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
      if (!id_bodega) return res.status(400).json({ error: "No hay bodega disponible para el usuario" });

      if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
        return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
      }

      const normalized = normalizeCuadrePayload(req.body?.payload || {});
      const actor = Number(req.user?.id_user || 0) || null;

      await pool.query(
        `INSERT INTO cuadre_caja
          (fecha, id_bodega, sede, responsable, payload_json, total_efectivo, total_cobro, total_venta_ambiente, gran_total_reporte, creado_por, actualizado_por)
         VALUES
          (:fecha, :id_bodega, :sede, :responsable, :payload_json, :total_efectivo, :total_cobro, :total_venta_ambiente, :gran_total_reporte, :actor, :actor)
         ON DUPLICATE KEY UPDATE
          sede=VALUES(sede),
          responsable=VALUES(responsable),
          payload_json=VALUES(payload_json),
          total_efectivo=VALUES(total_efectivo),
          total_cobro=VALUES(total_cobro),
          total_venta_ambiente=VALUES(total_venta_ambiente),
          gran_total_reporte=VALUES(gran_total_reporte),
          actualizado_por=VALUES(actualizado_por),
          actualizado_en=CURRENT_TIMESTAMP`,
        {
          fecha,
          id_bodega,
          sede: normalized.payload.sede || null,
          responsable: normalized.payload.responsable || null,
          payload_json: JSON.stringify(normalized.payload || {}),
          total_efectivo: normalized.total_efectivo,
          total_cobro: normalized.total_cobro,
          total_venta_ambiente: normalized.total_venta_ambiente,
          gran_total_reporte: normalized.gran_total_reporte,
          actor,
        }
      );

      return res.json({
        ok: true,
        fecha,
        id_bodega,
        payload: normalized.payload,
        totals: {
          total_efectivo: normalized.total_efectivo,
          total_cobro: normalized.total_cobro,
          total_venta_ambiente: normalized.total_venta_ambiente,
          gran_total_reporte: normalized.gran_total_reporte,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }
);
app.all("/api/print/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "imprimir cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    const fechaSource = req.method === "POST" ? (req.body?.fecha || req.query.fecha) : req.query.fecha;
    const fechaRaw = String(fechaSource || "").trim();
    const fecha = normalizeYmdInput(fechaRaw) || ymd(new Date()) || "";
    if (fechaRaw && !fecha) {
      return res.status(400).send("Fecha invalida. Formato esperado: YYYY-MM-DD");
    }

    const warehouseSource = req.method === "POST" ? (req.body?.warehouse || req.query.warehouse) : req.query.warehouse;
    const requested = Number(warehouseSource || 0) || 0;
    const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
    if (!id_bodega) return res.status(400).send("No hay bodega disponible para el usuario");
    if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
      return res.status(403).send("Sin acceso a la bodega solicitada");
    }

    const formatSource = req.method === "POST" ? (req.body?.format || req.query.format) : req.query.format;
    const formatRaw = String(formatSource || "carta").trim().toLowerCase();
    const format = formatRaw === "pos" ? "pos" : "carta";
    const payloadOverrideRaw = req.method === "POST"
      ? String(req.body?.payload_override || "").trim()
      : String(req.query.payload_override || "").trim();

    const [[bod]] = await pool.query(
      `SELECT nombre_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );

    const [[row]] = await pool.query(
      `SELECT id_cuadre,
              sede,
              responsable,
              payload_json,
              total_efectivo,
              total_cobro,
              total_venta_ambiente,
              gran_total_reporte,
              actualizado_en
       FROM cuadre_caja
       WHERE fecha=:fecha
         AND id_bodega=:id_bodega
       LIMIT 1`,
      { fecha, id_bodega }
    );

    let parsedPayload = {};
    if (row?.payload_json) {
      try {
        parsedPayload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        parsedPayload = {};
      }
    }

    let payloadOverride = null;
    if (payloadOverrideRaw) {
      try {
        const parsed = JSON.parse(payloadOverrideRaw);
        if (parsed && typeof parsed === "object") payloadOverride = parsed;
      } catch {}
    }

    const normalized = normalizeCuadrePayload(payloadOverride || parsedPayload, {
      sede: row?.sede || bod?.nombre_bodega || "",
      responsable: row?.responsable || "",
      payload_json: parsedPayload,
    });

    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const fmtMoney = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQty = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

    const p = normalized.payload || {};
    const monedas = p.monedas || {};
    const pagos = p.pagos || {};
    const ventas = p.ventas || {};
    const ventasRows = Array.isArray(p.ventas_rows) && p.ventas_rows.length
      ? p.ventas_rows
      : [
          { ambiente: "Flor de Cafe", monto: Number(ventas.flor_cafe || 0) },
          { ambiente: "Restaurante", monto: Number(ventas.restaurante || 0) },
          { ambiente: "Nilas", monto: Number(ventas.nilas || 0) },
          { ambiente: "ElDeck", monto: Number(ventas.eldeck || 0) },
          { ambiente: "Cactus", monto: Number(ventas.cactus || 0) },
          { ambiente: "Gelato", monto: Number(ventas.gelato || 0) },
          { ambiente: "Jazmin", monto: Number(ventas.jazmin || 0) },
        ];
    const extras = p.extras || {};
    const detalle = Array.isArray(p.detalle) ? p.detalle : [];
    const logoSrc = await getWarehouseLogoDataUri(id_bodega);

    const baseCss = format === "pos"
      ? `
        @page { size: 80mm auto; margin: 2mm; }
        body {
          width: auto;
          margin: 0;
          padding: 0 2.8mm 0 0.8mm;
          font-family: "DejaVu Sans Mono", "Consolas", "Lucida Console", monospace;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.3;
          color: #111;
          -webkit-font-smoothing: none;
          text-rendering: optimizeLegibility;
          box-sizing: border-box;
        }
        h1 { font-size: 15px; margin: 4px 0 5px; text-align: center; letter-spacing: .2px; }
        .meta { text-align: center; font-size: 11px; margin-bottom: 7px; line-height: 1.3; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
        th, td { border-bottom: 1px dashed #bbb; padding: 3px 3px 3px 4px; vertical-align: top; }
        th { text-align: left; font-size: 11px; }
        td.n { text-align: right; white-space: nowrap; padding-right: 1px; }
        .section { margin-top: 8px; font-weight: bold; border-top: 1px solid #000; padding: 4px 0 0 1px; }
        .tot { font-weight: bold; border-top: 1px solid #000; }
        .logo { display:block; margin:0 auto 4px; max-width:48mm; max-height:18mm; }
      `
      : `
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
        h1 { font-size: 20px; margin: 6px 0 2px; text-align: center; }
        .meta { text-align: center; font-size: 12px; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d8d8d8; padding: 5px 6px; vertical-align: top; }
        th { background:#f4f4f4; text-align:left; }
        td.n { text-align: right; white-space: nowrap; }
        .section { margin-top: 12px; font-weight: bold; }
        .tot { font-weight: bold; background:#f9f9f9; }
        .logo { display:block; margin:0 auto 8px; max-width:130px; max-height:56px; }
      `;

    const html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cuadre de caja</title>
  <style>${baseCss}</style>
</head>
<body>
  <img class="logo" src="${logoSrc}" alt="Logo" />
  <h1>Cuadre de Caja</h1>
  <div class="meta">${esc(p.sede || bod?.nombre_bodega || "-")} | Fecha: ${esc(dmy(fecha))} | Responsable: ${esc(p.responsable || "-")}</div>

  <div class="section">Efectivo por denominacion</div>
  <table>
    <thead><tr><th>Cantidad</th><th>Detalle</th><th class="n">Total</th></tr></thead>
    <tbody>
      ${CUADRE_DENOMINACIONES.map((d) => {
        const key = String(d);
        const qty = Number(monedas[key] || 0);
        const line = qty * Number(d);
        return `<tr><td>${fmtQty(qty)}</td><td>Q ${fmtMoney(d)}</td><td class="n">Q ${fmtMoney(line)}</td></tr>`;
      }).join("")}
      <tr><td>${fmtQty(pagos.dolares_cantidad || 0)}</td><td>$ ${fmtMoney(CUADRE_DOLAR_DENOM_USD)} x Q ${fmtMoney(CUADRE_DOLAR_TIPO_CAMBIO)}</td><td class="n">$ ${fmtMoney(pagos.dolares_total || 0)}</td></tr>
      <tr><td colspan="2">Dolares a quetzales</td><td class="n">Q ${fmtMoney(pagos.dolares_quetzales || 0)}</td></tr>
      <tr class="tot"><td colspan="2">Total efectivo</td><td class="n">Q ${fmtMoney(normalized.total_efectivo)}</td></tr>
      <tr><td colspan="2">Visa</td><td class="n">Q ${fmtMoney(pagos.visa || 0)}</td></tr>
      <tr><td colspan="2">Bancos</td><td class="n">Q ${fmtMoney(pagos.bancos || 0)}</td></tr>
      <tr><td colspan="2">CXC Trabajadores</td><td class="n">Q ${fmtMoney(pagos.cxc_trabajadores || 0)}</td></tr>
      <tr><td colspan="2">CXC Habitaciones</td><td class="n">Q ${fmtMoney(pagos.cxc_habitaciones || 0)}</td></tr>
      <tr><td colspan="2">PASE CONSUMIBLE</td><td class="n">Q ${fmtMoney(pagos.pase_consumible || 0)}</td></tr>
      <tr class="tot"><td colspan="2">TOTAL COBRO</td><td class="n">Q ${fmtMoney(normalized.total_cobro)}</td></tr>
    </tbody>
  </table>

  <div class="section">Ventas por ambiente</div>
  <table>
    <tbody>
      ${ventasRows
        .map((r) => `<tr><td>${esc(r.ambiente || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td></tr>`)
        .join("")}
      <tr class="tot"><td>TOTAL VENTA POR AMBIENTE</td><td class="n">Q ${fmtMoney(normalized.total_venta_ambiente)}</td></tr>
      <tr><td>Pedidos Nilas</td><td class="n">Q ${fmtMoney(extras.pedidos_nilas || 0)}</td></tr>
      <tr><td>Cortesias</td><td class="n">Q ${fmtMoney(extras.cortesias || 0)}</td></tr>
      <tr class="tot"><td>GRAN TOTAL DE REPORTE</td><td class="n">Q ${fmtMoney(normalized.gran_total_reporte)}</td></tr>
    </tbody>
  </table>

  <div class="section">Detalle funcionarios / cortesia</div>
  <table>
    <thead><tr><th>Descrip</th><th>Nombre</th><th class="n">Monto</th><th>Check</th></tr></thead>
    <tbody>
      ${detalle.length
        ? detalle
            .map((r) => `<tr><td>${esc(r.descripcion || "")}</td><td>${esc(r.nombre || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td><td>${esc(r.check_no || "")}</td></tr>`)
            .join("")
        : `<tr><td colspan="4">Sin detalle</td></tr>`}
    </tbody>
  </table>

  <div class="meta" style="margin-top:8px">Actualizado: ${esc(payloadOverride ? "Vista previa actual" : (row?.actualizado_en ? String(row.actualizado_en) : "-"))}</div>
  <script>window.print()</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    return res.status(500).send(String(e.message || e));
  }
});
