// server-reportes-kardex.js  |  Kardex report route (modular)
import { pool, auth, resolveStockScope, getScopedWarehouseFilter, buildTokenizedLikeFilter, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   KARDEX
========================= */
router.get("/api/reportes/kardex", auth, async (req, res) => {
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

export default router;
