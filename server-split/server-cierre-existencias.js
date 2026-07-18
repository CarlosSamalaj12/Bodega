// server-cierre-existencias.js  |  Existencias / alertas / corte diario routes (modular)
import { pool, auth, resolveStockScope, getScopedWarehouseFilter, buildNamedInClause, buildTokenizedLikeFilter, normalizeWarehouseIdList } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   REPORTE EXISTENCIAS + ALERTAS
========================= */
router.get("/api/reportes/existencias", auth, async (req, res) => {
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

router.get("/api/reportes/existencias/alertas", auth, async (req, res) => {
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

/* =========================
   CORTE DIARIO
========================= */
router.get("/api/reportes/corte-diario", auth, async (req, res) => {
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

export default router;
