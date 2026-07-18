// server-reportes-entradas-salidas.js  |  Entradas / salidas / pedidos report routes (modular)
import { pool, auth, resolveStockScope, requirePermission, getScopedWarehouseFilter, buildTokenizedLikeFilter, buildNamedInClause, ensureMovimientoDashboardColumn, ensureMovimientoPastUpdateTrigger } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   REPORTE ENTRADAS
========================= */
router.get("/api/reportes/entradas", auth, async (req, res) => {
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

/* =========================
   DASHBOARD FLAG (entradas)
========================= */
router.post("/api/entradas/:id_movimiento/dashboard-flag",
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

/* =========================
   REPORTE SALIDAS
========================= */
router.get("/api/reportes/salidas", auth, async (req, res) => {
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

/* =========================
   REPORTE PEDIDOS
========================= */
router.get("/api/reportes/pedidos", auth, async (req, res) => {
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

export default router;
