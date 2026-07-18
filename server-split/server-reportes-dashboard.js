// server-reportes-dashboard.js  |  Dashboard & stock-scope routes (modular)
import { pool, auth, resolveStockScope, readDashboardResumenCache, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// ======= Dashboard helpers (extracted from monolithic backup) =======
function withTimeout(promise, ms, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), ms);
    }),
  ]);
}

const DASHBOARD_CACHE_TTL_SEC = 300;
const dashboardRefreshInFlight = new Set();

function dashboardScopeKey(id_bodega, days, mov_days) {
  return `${Number(id_bodega || 0)}:${Number(days || 0)}:${Number(mov_days || 0)}`;
}

async function writeDashboardResumenCache({ scope_key, id_bodega, days, mov_days, payload }) {
  await pool.query(
    `INSERT INTO dashboard_cache_resumen
      (scope_key, id_bodega, dias, mov_days, payload_json)
     VALUES (:scope_key, :id_bodega, :dias, :mov_days, :payload_json)
     ON DUPLICATE KEY UPDATE
      id_bodega=VALUES(id_bodega),
      dias=VALUES(dias),
      mov_days=VALUES(mov_days),
      payload_json=VALUES(payload_json),
      generado_en=CURRENT_TIMESTAMP`,
    {
      scope_key,
      id_bodega: id_bodega || null,
      dias: days,
      mov_days,
      payload_json: JSON.stringify(payload || {}),
    }
  );
}

function emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }) {
  return {
    scope: {
      id_bodega,
      bodega_nombre,
      can_all_bodegas: scope.can_all_bodegas,
      bodega_usuario: scope.id_bodega,
    },
    params: { days, mov_days },
    resumen: {
      productos_vigentes: 0,
      productos_vencidos: 0,
      productos_proximos: 0,
      productos_bajo_minimo: 0,
      productos_proximo_minimo: 0,
      productos_entre_minimo_ideal: 0,
      cantidad_vigente: 0,
      cantidad_vencida: 0,
      cantidad_proxima: 0,
      total_dinero: 0,
    },
    mas_movimiento: null,
    menos_movimiento: null,
  };
}

async function triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days }) {
  if (dashboardRefreshInFlight.has(scope_key)) return;
  dashboardRefreshInFlight.add(scope_key);
  try {
    const fresh = await buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days });
    await writeDashboardResumenCache({
      scope_key,
      id_bodega,
      days,
      mov_days,
      payload: fresh,
    });
  } catch (e) {
    console.error("No se pudo refrescar cache dashboard:", e);
  } finally {
    dashboardRefreshInFlight.delete(scope_key);
  }
}

async function buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days }) {
  const sumPromise = pool.query(
    `SELECT
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
          THEN v.id_producto
          ELSE NULL
        END) AS productos_vigentes,
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE())
          THEN v.id_producto
          ELSE NULL
        END) AS productos_vencidos,
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)
          THEN v.id_producto
          ELSE NULL
        END) AS productos_proximos,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE()) THEN v.stock ELSE 0
        END) AS cantidad_vigente,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE()) THEN v.stock ELSE 0
        END) AS cantidad_vencida,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)
          THEN v.stock ELSE 0
        END) AS cantidad_proxima
     FROM v_stock_por_lote v
     WHERE v.stock > 0
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)`,
    { id_bodega, days }
  );

  const moneyPromise = pool.query(
    `SELECT
        SUM(
          vs.stock * COALESCE(
            (
              SELECT k1.costo_unitario
              FROM kardex k1
              LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
              WHERE k1.id_bodega=vs.id_bodega
                AND k1.id_producto=vs.id_producto
                AND k1.delta_cantidad > 0
                AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                AND COALESCE(me1.no_contar_dashboard, 0) = 0
              ORDER BY k1.creado_en DESC, k1.id_kardex DESC
              LIMIT 1
            ),
            (
              SELECT k2.costo_unitario
              FROM kardex k2
              WHERE k2.id_bodega=vs.id_bodega
                AND k2.id_producto=vs.id_producto
                AND k2.delta_cantidad > 0
              ORDER BY k2.creado_en DESC, k2.id_kardex DESC
              LIMIT 1
            ),
            0
          )
        ) AS total_dinero
     FROM v_stock_resumen vs
     WHERE vs.stock > 0
       AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)`,
    { id_bodega }
  );

  const stockLevelPromise = pool.query(
    `SELECT
        COUNT(DISTINCT CASE
          WHEN COALESCE(lpb.activo, 1) = 1
               AND COALESCE(lpb.minimo, 0) > 0
               AND COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0)
          THEN vs.id_producto
          ELSE NULL
        END) AS productos_bajo_minimo,
        COUNT(DISTINCT CASE
          WHEN COALESCE(lpb.activo, 1) = 1
               AND COALESCE(lpb.minimo, 0) > 0
               AND COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1)
          THEN vs.id_producto
          ELSE NULL
        END) AS productos_proximo_minimo
     FROM v_stock_resumen vs
     LEFT JOIN limites_producto_bodega lpb
       ON lpb.id_bodega=vs.id_bodega
      AND lpb.id_producto=vs.id_producto
     WHERE vs.stock > 0
       AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)`,
    { id_bodega }
  );

  const topPromise = pool.query(
    `SELECT k.id_producto, p.nombre_producto, p.sku,
            SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento
     FROM kardex k
     JOIN productos p ON p.id_producto=k.id_producto
     LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
     WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
       AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
       AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
       AND COALESCE(me.no_contar_dashboard, 0) = 0
     GROUP BY k.id_producto, p.nombre_producto, p.sku
     HAVING SUM(ABS(k.delta_cantidad)) > 0
     ORDER BY cantidad_movimiento DESC, p.nombre_producto ASC
     LIMIT 1`,
    { id_bodega, mov_days }
  );

  const lowPromise = pool.query(
    `SELECT k.id_producto, p.nombre_producto, p.sku,
            SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento
     FROM kardex k
     JOIN productos p ON p.id_producto=k.id_producto
     LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
     WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
       AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
       AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
       AND COALESCE(me.no_contar_dashboard, 0) = 0
     GROUP BY k.id_producto, p.nombre_producto, p.sku
     HAVING SUM(ABS(k.delta_cantidad)) > 0
     ORDER BY cantidad_movimiento ASC, p.nombre_producto ASC
     LIMIT 1`,
    { id_bodega, mov_days }
  );

  const [sumRes, moneyRes, stockLevelRes, topRes, lowRes] = await Promise.all([
    withTimeout(sumPromise, 10000, [[]]),
    withTimeout(moneyPromise, 2500, [[]]),
    withTimeout(stockLevelPromise, 8000, [[]]),
    withTimeout(topPromise, 7000, [[]]),
    withTimeout(lowPromise, 7000, [[]]),
  ]);
  const sum = (sumRes?.[0] || [])[0] || {};
  const moneyRow = (moneyRes?.[0] || [])[0] || {};
  const stockLevelRow = (stockLevelRes?.[0] || [])[0] || {};
  const topRows = topRes?.[0] || [];
  const lowRows = lowRes?.[0] || [];

  return {
    scope: {
      id_bodega,
      bodega_nombre,
      can_all_bodegas: scope.can_all_bodegas,
      bodega_usuario: scope.id_bodega,
    },
    params: { days, mov_days },
    resumen: {
      productos_vigentes: Number(sum?.productos_vigentes || 0),
      productos_vencidos: Number(sum?.productos_vencidos || 0),
      productos_proximos: Number(sum?.productos_proximos || 0),
      productos_bajo_minimo: Number(stockLevelRow?.productos_bajo_minimo || 0),
      productos_proximo_minimo: Number(stockLevelRow?.productos_proximo_minimo || 0),
      productos_entre_minimo_ideal: Number(stockLevelRow?.productos_proximo_minimo || 0),
      cantidad_vigente: Number(sum?.cantidad_vigente || 0),
      cantidad_vencida: Number(sum?.cantidad_vencida || 0),
      cantidad_proxima: Number(sum?.cantidad_proxima || 0),
      total_dinero: Number(moneyRow?.total_dinero || 0),
    },
    mas_movimiento: topRows?.[0] || null,
    menos_movimiento: lowRows?.[0] || null,
  };
}

// -------------------------------------------------------
/* =========================
   STOCK SCOPE
========================= */
router.get("/api/reportes/stock-scope", auth, async (req, res) => {
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
router.get("/api/dashboard/resumen", auth, async (req, res) => {
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
