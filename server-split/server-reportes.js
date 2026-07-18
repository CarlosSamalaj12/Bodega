// server-reportes.js  |  Report routes (modular)
import { app, pool, auth, resolveStockScope, requirePermission, readDashboardResumenCache, getWarehouseLogoDataUri, getWarehouseAppLogoDataUri, getWarehousePrintLogoDataUri, buildWarehouseFooterHtml, getPreferredWarehousePrintLogoDataUri, getScopedWarehouseFilter, buildTokenizedLikeFilter, buildNamedInClause, ymd, dmy, normalizeWarehouseIdList } from '../server-shared.js';
// -------------------------------------------------------
app.get("/api/reportes/stock-scope", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    let rows = [];
    if (!scope.can_view_existencias) {
      rows = [];
    } else if (scope.has_warehouse_restrictions) {
      const inClause = buildNamedInClause(scope.allowed_warehouse_ids, "sw");
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})
         ORDER BY nombre_bodega ASC`,
        inClause.params
      );
    } else if (scope.can_all_bodegas) {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
         ORDER BY nombre_bodega ASC`
      );
    } else {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega: scope.id_bodega }
      );
    }

    res.json({
      id_bodega_default: scope.id_bodega,
      maneja_stock: scope.maneja_stock,
      is_bodeguero: scope.is_bodeguero,
      can_close_day: scope.is_bodeguero,
      can_view_existencias: scope.can_view_existencias,
      can_all_bodegas: scope.can_all_bodegas,
      has_warehouse_restrictions: scope.has_warehouse_restrictions,
      bodegas: rows,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   DASHBOARD INICIO
========================= */
app.get("/api/dashboard/resumen", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const id_bodega = scope.can_all_bodegas ? Number(req.query.warehouse || 0) || null : scope.id_bodega;
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    const mov_days = Math.max(7, Math.min(365, Number(req.query.mov_days || 30)));
    const force = String(req.query.force || "") === "1";
    const scope_key = dashboardScopeKey(id_bodega, days, mov_days);
    let bodega_nombre = null;
    if (id_bodega) {
      const [[bRow]] = await pool.query(
        `SELECT nombre_bodega
         FROM bodegas
         WHERE id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega }
      );
      bodega_nombre = bRow?.nombre_bodega || null;
    }
    const cacheRow = force ? null : await readDashboardResumenCache(scope_key);
    if (cacheRow?.payload) {
      const isFresh = Number(cacheRow.age_sec || 0) <= DASHBOARD_CACHE_TTL_SEC;
      const payload = {
        ...cacheRow.payload,
        scope: {
          ...(cacheRow.payload.scope || {}),
          id_bodega,
          bodega_nombre,
          can_all_bodegas: scope.can_all_bodegas,
          bodega_usuario: scope.id_bodega,
        },
        cache: {
          hit: true,
          stale: !isFresh,
          age_sec: Number(cacheRow.age_sec || 0),
          generado_en: cacheRow.generado_en,
        },
      };
      if (!isFresh) {
        triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      }
      return res.json(payload);
    }

    if (!force) {
      triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      return res.json({
        ...emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
        cache: { hit: false, stale: false, warming: true, age_sec: 0, generado_en: null },
      });
    }

    const fresh = await withTimeout(
      buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
      12000,
      null
    );
    if (!fresh) {
      triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      return res.json({
        ...emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
        cache: { hit: false, stale: false, warming: true, timeout: true, age_sec: 0, generado_en: null },
      });
    }
    await writeDashboardResumenCache({
      scope_key,
      id_bodega,
      days,
      mov_days,
      payload: fresh,
    });
    return res.json({
      ...fresh,
      cache: { hit: false, stale: false, warming: false, age_sec: 0, generado_en: new Date() },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/dashboard/detalle", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const kind = String(req.query.kind || "vigentes").trim().toLowerCase();
    const id_bodega = scope.can_all_bodegas ? Number(req.query.warehouse || 0) || null : scope.id_bodega;
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    const mov_days = Math.max(7, Math.min(365, Number(req.query.mov_days || 30)));
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 300)));


    if (kind === "stock_minimo") {
      const [rows] = await pool.query(
        `SELECT vs.id_bodega,
                b.nombre_bodega,
                vs.id_producto,
                p.nombre_producto,
                p.sku,
                COALESCE(vs.stock, 0) AS stock,
                COALESCE(lpb.minimo, 0) AS minimo_stock,
                COALESCE(lpb.maximo, 0) AS maximo_stock,
                CASE
                  WHEN COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0) THEN 'Bajo minimo'
                  WHEN COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1) THEN 'Proximo a minimo'
                  ELSE ''
                END AS nivel_stock
         FROM v_stock_resumen vs
         JOIN bodegas b ON b.id_bodega=vs.id_bodega
         JOIN productos p ON p.id_producto=vs.id_producto
         LEFT JOIN limites_producto_bodega lpb
           ON lpb.id_bodega=vs.id_bodega
          AND lpb.id_producto=vs.id_producto
         WHERE vs.stock > 0
           AND COALESCE(lpb.activo, 1)=1
           AND COALESCE(lpb.minimo, 0) > 0
           AND (
             COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0)
             OR COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1)
           )
           AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)
         ORDER BY b.nombre_bodega ASC,
                  CASE WHEN COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0) THEN 0 ELSE 1 END ASC,
                  p.nombre_producto ASC
         LIMIT ${limit}`,
        { id_bodega }
      );
      return res.json({ kind, rows });
    }
    const stockKinds = {
      vigentes: "(v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())",
      vencidos: "(v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE())",
      proximos: "(v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)",
      rotar: "(v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)",
    };

    if (Object.prototype.hasOwnProperty.call(stockKinds, kind)) {
      const whereKind = stockKinds[kind];
      const [rows] = await pool.query(
        `SELECT v.id_bodega,
                b.nombre_bodega,
                v.id_producto,
                p.nombre_producto,
                p.sku,
                v.lote,
                v.fecha_vencimiento,
                v.stock,
                CASE
                  WHEN v.fecha_vencimiento IS NULL THEN NULL
                  ELSE DATEDIFF(v.fecha_vencimiento, CURDATE())
                END AS dias_para_vencer,
                COALESCE(
                  (
                    SELECT k1.costo_unitario
                    FROM kardex k1
                    LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
                    WHERE k1.id_bodega=v.id_bodega
                      AND k1.id_producto=v.id_producto
                      AND k1.delta_cantidad > 0
                      AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                      AND COALESCE(me1.no_contar_dashboard, 0) = 0
                    ORDER BY k1.creado_en DESC, k1.id_kardex DESC
                    LIMIT 1
                  ),
                  (
                    SELECT k2.costo_unitario
                    FROM kardex k2
                    WHERE k2.id_bodega=v.id_bodega
                      AND k2.id_producto=v.id_producto
                      AND k2.delta_cantidad > 0
                    ORDER BY k2.creado_en DESC, k2.id_kardex DESC
                    LIMIT 1
                  ),
                  0
                ) AS costo_unitario,
                (
                  v.stock * COALESCE(
                    (
                      SELECT k1.costo_unitario
                      FROM kardex k1
                      LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
                      WHERE k1.id_bodega=v.id_bodega
                        AND k1.id_producto=v.id_producto
                        AND k1.delta_cantidad > 0
                        AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                        AND COALESCE(me1.no_contar_dashboard, 0) = 0
                      ORDER BY k1.creado_en DESC, k1.id_kardex DESC
                      LIMIT 1
                    ),
                    (
                      SELECT k2.costo_unitario
                      FROM kardex k2
                      WHERE k2.id_bodega=v.id_bodega
                        AND k2.id_producto=v.id_producto
                        AND k2.delta_cantidad > 0
                      ORDER BY k2.creado_en DESC, k2.id_kardex DESC
                      LIMIT 1
                    ),
                    0
                  )
                ) AS total_linea
         FROM v_stock_por_lote v
         JOIN bodegas b ON b.id_bodega=v.id_bodega
         JOIN productos p ON p.id_producto=v.id_producto
         WHERE v.stock > 0
           AND (${whereKind})
           AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
         ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
         LIMIT ${limit}`,
        { id_bodega, days }
      );
      return res.json({ kind, rows });
    }

    if (kind === "mas_mov" || kind === "menos_mov") {
      const orderSql = kind === "mas_mov" ? "DESC" : "ASC";
      const [rows] = await pool.query(
        `SELECT k.id_producto,
                p.nombre_producto,
                p.sku,
                SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento,
                MAX(k.creado_en) AS ultimo_movimiento,
                (
                  SELECT COALESCE(SUM(vs.stock),0)
                  FROM v_stock_resumen vs
                  WHERE vs.id_producto=k.id_producto
                    AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)
                ) AS stock_actual
         FROM kardex k
         JOIN productos p ON p.id_producto=k.id_producto
         LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
         WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
           AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
           AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
           AND COALESCE(me.no_contar_dashboard, 0) = 0
         GROUP BY k.id_producto, p.nombre_producto, p.sku
         HAVING SUM(ABS(k.delta_cantidad)) > 0
         ORDER BY cantidad_movimiento ${orderSql}, p.nombre_producto ASC
         LIMIT ${limit}`,
        { id_bodega, mov_days }
      );
      return res.json({ kind, rows });
    }

    return res.status(400).json({ error: "Tipo de detalle no valido" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/entradas", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json([]);

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json([]);
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "renw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "renq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const motivoRaw = String(req.query.motivo || "").trim().toUpperCase();
    const tipo_movimiento = motivoRaw === "TRANSFERENCIA" ? "TRANSFERENCIA" : null;
    const id_motivo = tipo_movimiento ? null : Number(req.query.motivo || 0) || null;
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000)));

    const [rows] = await pool.query(
      `SELECT me.id_movimiento,
              me.tipo_movimiento AS tipo_entrada,
              DATE(me.creado_en) AS fecha,
              TIME(me.creado_en) AS hora,
              me.creado_en,
              me.no_documento,
              me.observaciones,
              b.id_bodega,
              b.nombre_bodega,
              m.id_motivo,
              m.nombre_motivo,
              COALESCE(me.no_contar_dashboard, 0) AS no_contar_dashboard,
              u.id_usuario,
              u.nombre_completo AS usuario_creador,
              md.id_detalle,
              md.id_producto,
              p.nombre_producto,
              p.sku,
              p.id_categoria,
              c.nombre_categoria,
              p.id_subcategoria,
              sc.nombre_subcategoria,
              md.lote,
              md.fecha_vencimiento,
              md.cantidad,
              md.costo_unitario,
              md.precio_salida,
              (md.cantidad * md.costo_unitario) AS total_linea
       FROM movimiento_encabezado me
       JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       LEFT JOIN bodegas b ON b.id_bodega=me.id_bodega_destino
       JOIN productos p ON p.id_producto=md.id_producto
       LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
       LEFT JOIN motivos_movimiento m ON m.id_motivo=me.id_motivo
       LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
       WHERE me.tipo_movimiento IN ('ENTRADA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND ${accessFilter ? `me.id_bodega_destino IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR me.id_bodega_destino=:id_bodega)
         AND ${qf.clause}
         AND (:lote IS NULL OR md.lote LIKE :lote)
         AND (:documento IS NULL OR me.no_documento LIKE :documento)
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
         AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
         AND (:tipo_movimiento IS NULL OR me.tipo_movimiento=:tipo_movimiento)
         AND (:id_motivo IS NULL OR me.id_motivo=:id_motivo)
       ORDER BY me.creado_en DESC, me.id_movimiento DESC, md.id_detalle DESC
       LIMIT ${limit}`,
      {
        id_bodega,
        lote,
        documento,
        from_date,
        to_date,
        id_categoria,
        id_subcategoria,
        tipo_movimiento,
        id_motivo,
        ...(accessFilter?.params || {}),
        ...qf.params,
      }
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post(
  "/api/entradas/:id_movimiento/dashboard-flag",
  auth,
  requirePermission("action.manage_permissions", "administrar exclusion del panel principal en entradas"),
  async (req, res) => {
    let conn = null;
    try {
      await ensureMovimientoDashboardColumn();
      await ensureMovimientoPastUpdateTrigger();
      const id_movimiento = Number(req.params.id_movimiento || 0);
      if (!id_movimiento) return res.status(400).json({ error: "Movimiento invalido" });
      const scope = await resolveStockScope(req.user);
      if (!scope?.is_admin_role) {
        return res.status(403).json({ error: "Solo un administrador puede excluir entradas antiguas del panel principal." });
      }

      const no_contar_dashboard = Number(req.body?.no_contar_dashboard) === 1 ? 1 : 0;
      conn = await pool.getConnection();
      const [[row]] = await conn.query(
        `SELECT id_movimiento, tipo_movimiento, id_bodega_destino, id_bodega_origen
         FROM movimiento_encabezado
         WHERE id_movimiento=:id_movimiento
         LIMIT 1`,
        { id_movimiento }
      );
      if (!row) return res.status(404).json({ error: "Movimiento no encontrado" });
      if (String(row.tipo_movimiento || "").toUpperCase() !== "ENTRADA") {
        return res.status(400).json({ error: "Solo las entradas pueden excluirse del panel principal." });
      }

      await conn.query(`SET @allow_dashboard_flag_past_update = 1`);
      await conn.query(
        `UPDATE movimiento_encabezado
         SET no_contar_dashboard=:no_contar_dashboard
         WHERE id_movimiento=:id_movimiento`,
        { id_movimiento, no_contar_dashboard }
      );
      await conn.query(`SET @allow_dashboard_flag_past_update = 0`);

      await pool.query(`DELETE FROM dashboard_cache_resumen`);

      return res.json({ ok: true, id_movimiento, no_contar_dashboard });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    } finally {
      if (conn) conn.release();
    }
  }
);

app.get("/api/reportes/salidas", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json([]);

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json([]);
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "resw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "resq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const id_bodega_destino = Number(req.query.warehouse_destino || 0) || null;
    const motivoRaw = String(req.query.motivo || "").trim().toUpperCase();
    const tipo_movimiento = motivoRaw === "TRANSFERENCIA" ? "TRANSFERENCIA" : null;
    const id_motivo = tipo_movimiento ? null : Number(req.query.motivo || 0) || null;
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000)));

    const [rows] = await pool.query(
      `SELECT me.id_movimiento,
              me.tipo_movimiento AS tipo_salida,
              DATE(me.creado_en) AS fecha,
              TIME(me.creado_en) AS hora,
              me.creado_en,
              me.no_documento,
              me.observaciones,
              bo.id_bodega AS id_bodega_origen,
              bo.nombre_bodega AS nombre_bodega_origen,
              COALESCE(bd.id_bodega, bped.id_bodega) AS id_bodega_destino,
              COALESCE(bd.nombre_bodega, bped.nombre_bodega) AS nombre_bodega_destino,
              COALESCE(usol.nombre_completo, '') AS solicitante_pedido,
              m.id_motivo,
              m.nombre_motivo,
              u.id_usuario,
              u.nombre_completo AS usuario_creador,
              md.id_detalle,
              md.id_producto,
              p.nombre_producto,
              p.sku,
              p.id_categoria,
              c.nombre_categoria,
              p.id_subcategoria,
              sc.nombre_subcategoria,
              md.lote,
              md.fecha_vencimiento,
              md.cantidad,
              md.costo_unitario,
              (md.cantidad * md.costo_unitario) AS total_linea
       FROM movimiento_encabezado me
       JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
       LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
       LEFT JOIN (
         SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         GROUP BY pmv.id_movimiento
       ) pm ON pm.id_movimiento=me.id_movimiento
       LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
       LEFT JOIN bodegas bped ON bped.id_bodega=pe.id_bodega_solicita
       LEFT JOIN usuarios usol ON usol.id_usuario=pe.id_usuario_solicita
       JOIN productos p ON p.id_producto=md.id_producto
       LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
       LEFT JOIN motivos_movimiento m ON m.id_motivo=me.id_motivo
       LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
       WHERE me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND ${accessFilter ? `me.id_bodega_origen IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR me.id_bodega_origen=:id_bodega)
         AND ${qf.clause}
         AND (:lote IS NULL OR md.lote LIKE :lote)
         AND (:documento IS NULL OR me.no_documento LIKE :documento)
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
         AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
         AND (:id_bodega_destino IS NULL OR COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)=:id_bodega_destino)
         AND (:tipo_movimiento IS NULL OR me.tipo_movimiento=:tipo_movimiento)
         AND (:id_motivo IS NULL OR me.id_motivo=:id_motivo)
       ORDER BY me.creado_en DESC, me.id_movimiento DESC, md.id_detalle DESC
       LIMIT ${limit}`,
      {
        id_bodega,
        lote,
        documento,
        from_date,
        to_date,
        id_categoria,
        id_subcategoria,
        id_bodega_destino,
        tipo_movimiento,
        id_motivo,
        ...(accessFilter?.params || {}),
        ...qf.params,
      }
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/pedidos", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json([]);

    const requesterScope = getScopedWarehouseFilter(scope, req.query.warehouse_requester);
    if (requesterScope.denied) return res.json([]);
    let id_bodega_solicita = requesterScope.selected;
    const dispatchScope = getScopedWarehouseFilter(scope, req.query.warehouse_dispatch);
    if (dispatchScope.denied) return res.json([]);
    let id_bodega_surtidor = dispatchScope.selected;
    const localWarehouseId = !scope.can_all_bodegas ? Number(scope.id_bodega || 0) || null : null;
    if (!scope.can_all_bodegas) {
      id_bodega_surtidor = null;
    }
    const requesterAccessFilter =
      requesterScope.restrictedIds.length && !id_bodega_solicita
        ? buildNamedInClause(requesterScope.restrictedIds, "rprw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["pr.nombre_producto", "pr.sku", "us.nombre_completo"], "rpeq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const date_mode = String(req.query.date_mode || "PEDIDO").trim().toUpperCase() === "DESPACHO" ? "DESPACHO" : "PEDIDO";
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const id_pedido = Number(req.query.pedido || 0) || null;
    const estado = String(req.query.estado || "").trim() || null;
    const id_usuario_solicita = Number(req.query.requester_user || 0) || null;
    const id_usuario_despacha = Number(req.query.dispatch_user || 0) || null;
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000)));

    const [rows] = await pool.query(
      `SELECT p.id_pedido,
              DATE(p.creado_en) AS fecha_pedido,
              TIME(p.creado_en) AS hora_pedido,
              p.creado_en,
              p.estado,
              p.observaciones,
              p.id_usuario_solicita,
              us.nombre_completo AS solicitante,
              p.id_bodega_solicita,
              bs.nombre_bodega AS bodega_solicitante,
              p.id_bodega_surtidor,
              bd.nombre_bodega AS bodega_despacho,
              p.aprobado_por AS id_usuario_aprobador,
              ua.nombre_completo AS usuario_aprobador,
              p.aprobado_en,
              DATE(p.aprobado_en) AS fecha_despacho,
              TIME(p.aprobado_en) AS hora_despacho,
              d.id_pedido_detalle,
              d.id_producto,
              pr.nombre_producto,
              pr.sku,
              pr.id_categoria,
              c.nombre_categoria,
              pr.id_subcategoria,
              sc.nombre_subcategoria,
              d.cantidad_solicitada,
              d.cantidad_surtida,
              (d.cantidad_solicitada - d.cantidad_surtida) AS pendiente,
              COALESCE(mv.lotes_despachados, '') AS lotes_despachados,
              mv.ultima_salida_en,
              DATE(mv.ultima_salida_en) AS fecha_ultima_salida,
              TIME(mv.ultima_salida_en) AS hora_ultima_salida,
              COALESCE(mv.usuarios_despacho, '') AS usuarios_despacho,
              COALESCE(mv.tipos_movimiento, '') AS tipos_salida,
              COALESCE(mv.total_linea, 0) AS total_linea
       FROM pedido_encabezado p
       JOIN pedido_detalle d ON d.id_pedido=p.id_pedido
       JOIN productos pr ON pr.id_producto=d.id_producto
       LEFT JOIN categorias c ON c.id_categoria=pr.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=pr.id_subcategoria
       JOIN usuarios us ON us.id_usuario=p.id_usuario_solicita
       LEFT JOIN usuarios ua ON ua.id_usuario=p.aprobado_por
       JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
       JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
       LEFT JOIN (
         SELECT pmv.id_pedido_detalle,
                GROUP_CONCAT(DISTINCT COALESCE(md.lote,'(sin lote)') ORDER BY md.lote SEPARATOR ', ') AS lotes_despachados,
                MAX(me.creado_en) AS ultima_salida_en,
                GROUP_CONCAT(DISTINCT COALESCE(ud.nombre_completo,'') ORDER BY ud.nombre_completo SEPARATOR ', ') AS usuarios_despacho,
                GROUP_CONCAT(DISTINCT me.tipo_movimiento ORDER BY me.tipo_movimiento SEPARATOR ', ') AS tipos_movimiento,
                SUM(md.cantidad * md.costo_unitario) AS total_linea
         FROM pedido_movimiento_vinculo pmv
         JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
         JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
         LEFT JOIN usuarios ud ON ud.id_usuario=me.creado_por
         GROUP BY pmv.id_pedido_detalle
       ) mv ON mv.id_pedido_detalle=d.id_pedido_detalle
       WHERE (:id_pedido IS NULL OR p.id_pedido=:id_pedido)
         AND (:estado IS NULL OR p.estado=:estado)
         AND ${requesterAccessFilter ? `p.id_bodega_solicita IN (${requesterAccessFilter.sql})` : "1=1"}
         AND (:id_bodega_solicita IS NULL OR p.id_bodega_solicita=:id_bodega_solicita)
         AND (:id_bodega_surtidor IS NULL OR p.id_bodega_surtidor=:id_bodega_surtidor)
         AND (
           :local_warehouse_id IS NULL
           OR p.id_bodega_solicita=:local_warehouse_id
           OR p.id_bodega_surtidor=:local_warehouse_id
         )
         AND (:id_usuario_solicita IS NULL OR p.id_usuario_solicita=:id_usuario_solicita)
         AND (
           :id_usuario_despacha IS NULL
           OR p.aprobado_por=:id_usuario_despacha
           OR EXISTS (
             SELECT 1
             FROM pedido_movimiento_vinculo pmv3
             JOIN movimiento_encabezado me3 ON me3.id_movimiento=pmv3.id_movimiento
             WHERE pmv3.id_pedido_detalle=d.id_pedido_detalle
               AND me3.creado_por=:id_usuario_despacha
           )
         )
         AND (
           (:date_mode='DESPACHO'
             AND (:from_date IS NULL OR DATE(p.aprobado_en) >= :from_date)
             AND (:to_date IS NULL OR DATE(p.aprobado_en) <= :to_date))
           OR
           (:date_mode<>'DESPACHO'
             AND (:from_date IS NULL OR DATE(p.creado_en) >= :from_date)
             AND (:to_date IS NULL OR DATE(p.creado_en) <= :to_date))
         )
         AND (:id_categoria IS NULL OR pr.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR pr.id_subcategoria=:id_subcategoria)
         AND ${qf.clause}
         AND (:lote IS NULL OR EXISTS (
            SELECT 1
            FROM pedido_movimiento_vinculo pmv2
            JOIN movimiento_detalle md2 ON md2.id_detalle=pmv2.id_detalle
            WHERE pmv2.id_pedido_detalle=d.id_pedido_detalle
              AND md2.lote LIKE :lote
         ))
       ORDER BY p.id_pedido DESC, d.id_pedido_detalle ASC
       LIMIT ${limit}`,
      {
        id_pedido,
        estado,
        id_bodega_solicita,
        id_bodega_surtidor,
        local_warehouse_id: localWarehouseId,
        id_usuario_solicita,
        id_usuario_despacha,
        date_mode,
        from_date,
        to_date,
        id_categoria,
        id_subcategoria,
        lote,
        ...(requesterAccessFilter?.params || {}),
        ...qf.params,
      }
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});


app.get("/api/reportes/tendencia-producto", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ producto: null, price_increases: [], price_monthly: [], price_status: "sin_datos", demand_by_date: [], demand_peak_dates: [] });

    const id_producto = Number(req.query.producto || 0) || null;
    if (!id_producto) return res.status(400).json({ error: "Selecciona un producto" });

    const baseScope = getScopedWarehouseFilter(scope, req.query.warehouse_base);
    if (baseScope.denied) return res.json({ producto: null, price_increases: [], price_monthly: [], price_status: "sin_datos", demand_by_date: [], demand_peak_dates: [] });

    let id_bodega_base = baseScope.selected;
    if (!scope.can_all_bodegas) id_bodega_base = Number(scope.id_bodega || 0) || null;
    if (!id_bodega_base) id_bodega_base = Number(scope.id_bodega || 0) || null;
    if (!id_bodega_base) return res.status(400).json({ error: "Bodega base invalida" });

    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;

    const requesterAccessFilter =
      scope.has_warehouse_restrictions && Array.isArray(scope.allowed_warehouse_ids) && scope.allowed_warehouse_ids.length
        ? buildNamedInClause(scope.allowed_warehouse_ids, "rtpr")
        : null;

    const [[prod]] = await pool.query(
      `SELECT id_producto, nombre_producto, sku
       FROM productos
       WHERE id_producto=:id_producto
       LIMIT 1`,
      { id_producto }
    );
    if (!prod) return res.status(404).json({ error: "Producto no encontrado" });

    const [priceRows] = await pool.query(
      `SELECT DATE(k.creado_en) AS fecha,
              k.creado_en,
              k.costo_unitario
       FROM kardex k
       WHERE k.id_producto=:id_producto
         AND k.id_bodega=:id_bodega_base
         AND k.delta_cantidad > 0
         AND k.costo_unitario > 0
         AND (:from_date IS NULL OR DATE(k.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(k.creado_en) <= :to_date)
       ORDER BY k.creado_en ASC, k.id_kardex ASC`,
      { id_producto, id_bodega_base, from_date, to_date }
    );

    let prevPrice = null;
    const price_increases = [];
    for (const row of priceRows || []) {
      const nextPrice = Number(row?.costo_unitario || 0);
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) continue;
      if (prevPrice !== null && nextPrice > prevPrice) {
        const pct_up = prevPrice > 0 ? ((nextPrice - prevPrice) / prevPrice) * 100 : 0;
        price_increases.push({
          fecha: row.fecha,
          precio_anterior: prevPrice,
          precio_nuevo: nextPrice,
          pct_up: Number(pct_up.toFixed(4)),
        });
      }
      prevPrice = nextPrice;
    }

    const monthMap = new Map();
    for (const row of priceRows || []) {
      const fechaTxt = String(row?.fecha || "").trim();
      const monthKey = fechaTxt.slice(0, 7);
      const priceVal = Number(row?.costo_unitario || 0);
      if (!monthKey || !Number.isFinite(priceVal) || priceVal <= 0) continue;
      monthMap.set(monthKey, priceVal);
    }

    const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const price_monthly = [];
    let prevMonthlyPrice = null;
    for (const [periodo, precio] of sortedMonths) {
      const pct_change = prevMonthlyPrice && prevMonthlyPrice > 0
        ? ((precio - prevMonthlyPrice) / prevMonthlyPrice) * 100
        : 0;
      price_monthly.push({
        periodo,
        precio: Number(precio || 0),
        pct_change: Number(pct_change.toFixed(4)),
      });
      prevMonthlyPrice = precio;
    }

    const uniqueMonthlyPrices = Array.from(new Set(price_monthly.map((x) => Number(x.precio || 0).toFixed(4))));
    const price_status = price_increases.length > 0
      ? "subio"
      : (uniqueMonthlyPrices.length <= 1 && price_monthly.length > 0 ? "se_mantuvo" : "sin_subidas");

    const [demandRows] = await pool.query(
      `SELECT DATE(me.creado_en) AS fecha,
              SUM(md.cantidad) AS cantidad_solicitada,
              COUNT(DISTINCT me.id_movimiento) AS pedidos
       FROM movimiento_encabezado me
       JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       LEFT JOIN (
         SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         GROUP BY pmv.id_movimiento
       ) pm ON pm.id_movimiento=me.id_movimiento
       LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
       WHERE md.id_producto=:id_producto
         AND me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND me.id_bodega_origen=:id_bodega_base
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IS NOT NULL
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)<>:id_bodega_base
         AND ${requesterAccessFilter ? `COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IN (${requesterAccessFilter.sql})` : "1=1"}
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
       GROUP BY DATE(me.creado_en)
       ORDER BY fecha ASC`,
      {
        id_producto,
        id_bodega_base,
        from_date,
        to_date,
        ...(requesterAccessFilter?.params || {}),
      }
    );
    const demand_by_date = (demandRows || []).map((x) => ({
      fecha: x.fecha,
      cantidad_solicitada: Number(x.cantidad_solicitada || 0),
      pedidos: Number(x.pedidos || 0),
    }));

    const [warehouseRows] = await pool.query(
      `SELECT COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) AS id_bodega_destino,
              bdest.nombre_bodega,
              SUM(md.cantidad) AS cantidad_sacada,
              COUNT(DISTINCT me.id_movimiento) AS pedidos
       FROM movimiento_encabezado me
       JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       LEFT JOIN (
         SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         GROUP BY pmv.id_movimiento
       ) pm ON pm.id_movimiento=me.id_movimiento
       LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
       LEFT JOIN bodegas bdest ON bdest.id_bodega=COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)
       WHERE md.id_producto=:id_producto
         AND me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND me.id_bodega_origen=:id_bodega_base
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IS NOT NULL
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)<>:id_bodega_base
         AND ${requesterAccessFilter ? `COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IN (${requesterAccessFilter.sql})` : "1=1"}
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
       GROUP BY COALESCE(me.id_bodega_destino, pe.id_bodega_solicita), bdest.nombre_bodega
       ORDER BY cantidad_sacada DESC, pedidos DESC, bdest.nombre_bodega ASC`,
      {
        id_producto,
        id_bodega_base,
        from_date,
        to_date,
        ...(requesterAccessFilter?.params || {}),
      }
    );

    const demand_by_warehouse = (warehouseRows || []).map((x) => ({
      id_bodega: Number(x.id_bodega_destino || 0),
      nombre_bodega: String(x.nombre_bodega || '').trim(),
      cantidad_sacada: Number(x.cantidad_sacada || 0),
      pedidos: Number(x.pedidos || 0),
    }));
    const top_consumer_warehouse = demand_by_warehouse.length ? demand_by_warehouse[0] : null;

    const demand_peak_dates = [...demand_by_date]
      .sort((a, b) => Number(b.cantidad_solicitada || 0) - Number(a.cantidad_solicitada || 0))
      .slice(0, 5);

    return res.json({
      producto: prod,
      base_warehouse: id_bodega_base,
      from_date,
      to_date,
      price_increases,
      price_monthly,
      price_status,
      demand_by_date,
      demand_by_warehouse,
      top_consumer_warehouse,
      demand_peak_dates,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
app.get("/api/reportes/kardex", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json([]);

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json([]);
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "rkaw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku", "ui.nombre_completo"], "rkaq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const tipo = String(req.query.tipo || "").trim().toUpperCase() || null;
    const id_producto = Number(req.query.producto || 0) || null;
    const id_usuario = Number(req.query.usuario || 0) || null;
    const id_solicitante = Number(req.query.solicitante || 0) || null;
    const id_movimiento = Number(req.query.movimiento || 0) || null;
    const limit = Math.max(1, Math.min(8000, Number(req.query.limit || 2000)));

    const id_bodega_stock = scope.can_all_bodegas
      ? (id_bodega || null)
      : scope.id_bodega;

    const [rows] = await pool.query(
      `SELECT k.id_movimiento,
              k.id_detalle,
              DATE(COALESCE(k.creado_en, me.creado_en)) AS fecha,
              TIME(COALESCE(k.creado_en, me.creado_en)) AS hora,
              COALESCE(k.creado_en, me.creado_en) AS creado_en,
              me.tipo_movimiento,
              me.no_documento,
              me.observaciones,
              k.id_bodega AS id_bodega_kardex,
              bk.nombre_bodega AS bodega_kardex,
              me.id_bodega_origen,
              bo.nombre_bodega AS bodega_origen,
              me.id_bodega_destino,
              bd.nombre_bodega AS bodega_destino,
              k.id_producto,
              p.nombre_producto,
              p.sku,
              p.id_categoria,
              c.nombre_categoria,
              p.id_subcategoria,
              sc.nombre_subcategoria,
              k.lote,
              k.fecha_vencimiento,
              k.delta_cantidad,
              CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END AS cantidad_entrada,
              CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END AS cantidad_salida,
              k.costo_unitario,
              ABS(k.delta_cantidad * k.costo_unitario) AS total_linea,
              (
                SELECT COALESCE(SUM(vs.stock),0)
                FROM v_stock_resumen vs
                WHERE vs.id_producto=k.id_producto
                  AND (:id_bodega_stock IS NULL OR vs.id_bodega=:id_bodega_stock)
              ) AS stock_total_producto,
              me.creado_por AS id_usuario_ingreso,
              ui.nombre_completo AS usuario_ingreso,
              pm.id_pedido,
              pm.id_usuario_solicita,
              pm.solicitante_pedido
       FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
       LEFT JOIN bodegas bk ON bk.id_bodega=k.id_bodega
       LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
       LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
       JOIN productos p ON p.id_producto=k.id_producto
       LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
       LEFT JOIN usuarios ui ON ui.id_usuario=me.creado_por
       LEFT JOIN (
         SELECT pmv.id_detalle,
                MIN(pd.id_pedido) AS id_pedido,
                MIN(pe.id_usuario_solicita) AS id_usuario_solicita,
                MIN(us.nombre_completo) AS solicitante_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         JOIN pedido_encabezado pe ON pe.id_pedido=pd.id_pedido
         LEFT JOIN usuarios us ON us.id_usuario=pe.id_usuario_solicita
         GROUP BY pmv.id_detalle
       ) pm ON pm.id_detalle=k.id_detalle
       WHERE me.estado<>'ANULADO'
         AND ${accessFilter ? `k.id_bodega IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
         AND (:tipo IS NULL OR me.tipo_movimiento=:tipo)
         AND (:id_movimiento IS NULL OR k.id_movimiento=:id_movimiento)
         AND (:id_producto IS NULL OR k.id_producto=:id_producto)
         AND (:id_usuario IS NULL OR me.creado_por=:id_usuario)
         AND (:id_solicitante IS NULL OR pm.id_usuario_solicita=:id_solicitante)
         AND ${qf.clause}
         AND (:lote IS NULL OR k.lote LIKE :lote)
         AND (:documento IS NULL OR me.no_documento LIKE :documento)
         AND (:from_date IS NULL OR DATE(COALESCE(k.creado_en, me.creado_en)) >= :from_date)
         AND (:to_date IS NULL OR DATE(COALESCE(k.creado_en, me.creado_en)) <= :to_date)
         AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
       ORDER BY CASE me.tipo_movimiento
                  WHEN 'ENTRADA' THEN 1
                  WHEN 'SALIDA' THEN 2
                  WHEN 'TRANSFERENCIA' THEN 3
                  ELSE 9
                END ASC,
                COALESCE(k.creado_en, me.creado_en) ASC,
                k.id_movimiento ASC,
                k.id_detalle ASC
       LIMIT ${limit}`,
      {
        id_bodega,
        id_bodega_stock,
        tipo,
        id_movimiento,
        id_producto,
        id_usuario,
        id_solicitante,
        lote,
        documento,
        from_date,
        to_date,
        id_categoria,
        id_subcategoria,
        ...(accessFilter?.params || {}),
        ...qf.params,
      }
    );

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get(
  "/api/reportes/auditoria-sensibles",
  auth,
  requirePermission("section.view.r-auditoria-sensibles", "ver reporte de auditoria sensible"),
  async (req, res) => {
    try {
      const from = String(req.query.from || "").trim() || null;
      const to = String(req.query.to || "").trim() || null;
      const action_key = String(req.query.action_key || "").trim() || null;
      const qRaw = String(req.query.q || "").trim();
      const qf = buildTokenizedLikeFilter(
        qRaw,
        ["actor_nombre", "supervisor_nombre", "supervisor_usuario", "action_label"],
        "rauq"
      );
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

      if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: "Fecha 'from' invalida. Formato esperado: YYYY-MM-DD" });
      }
      if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: "Fecha 'to' invalida. Formato esperado: YYYY-MM-DD" });
      }

      const canSeeAll = await canManageUserPermissions(Number(req.user?.id_user || 0));
      const id_bodega_actor = canSeeAll ? null : Number(req.user?.id_warehouse || 0) || null;

      const [rows] = await pool.query(
        `SELECT id_auditoria,
                action_key,
                action_label,
                endpoint,
                http_method,
                id_usuario_actor,
                actor_nombre,
                id_bodega_actor,
                id_usuario_supervisor,
                supervisor_usuario,
                supervisor_nombre,
                approval_method,
                reference_type,
                reference_id,
                detail_json,
                creado_en
         FROM auditoria_accion_sensible
         WHERE (:from IS NULL OR DATE(creado_en) >= :from)
           AND (:to IS NULL OR DATE(creado_en) <= :to)
           AND (:action_key IS NULL OR action_key = :action_key)
           AND ${qf.clause}
           AND (:id_bodega_actor IS NULL OR id_bodega_actor=:id_bodega_actor)
         ORDER BY creado_en DESC, id_auditoria DESC
         LIMIT ${limit}`,
        { from, to, action_key, id_bodega_actor, ...qf.params }
      );

      res.json(rows || []);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);


/* =========================
   PEDIDOS (TABLAS EN ESPANOL)
========================= */
