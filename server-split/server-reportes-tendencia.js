// server-reportes-tendencia.js  |  Tendencia producto route (modular)
import { pool, auth, resolveStockScope, getScopedWarehouseFilter, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   TENDENCIA PRODUCTO
========================= */
router.get("/api/reportes/tendencia-producto", auth, async (req, res) => {
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

export default router;
