// server-reportes-dashboard-detalle.js  |  Dashboard detalle route (stock minimo, vigentes, etc.)
import { pool, auth, resolveStockScope } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/dashboard/detalle", auth, async (req, res) => {
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

export default router;
