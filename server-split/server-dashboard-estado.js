// server-dashboard-estado.js  |  Cierre dia: estado y listado
import { pool, auth, resolveStockScope, ymd, getScopedWarehouseFilter, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/cierre-dia/estado", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.is_bodeguero) {
      return res.status(403).json({ error: "Solo el rol bodeguero puede consultar el cierre de dia." });
    }
    const id_bodega = Number(scope.id_bodega || 0);
    if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const [[dates]] = await pool.query(`SELECT CURDATE() AS hoy, DATE_SUB(CURDATE(), INTERVAL 1 DAY) AS ayer`);
    const hoy = ymd(dates?.hoy);
    const ayer = ymd(dates?.ayer);

    const [[lc]] = await pool.query(
      `SELECT MAX(fecha_cierre) AS last_closed_date
       FROM cierre_dia
       WHERE id_bodega=:id_bodega`,
      { id_bodega }
    );
    const last_closed_date = ymd(lc?.last_closed_date);

    const [[todayRow]] = await pool.query(
      `SELECT id_cierre, fecha_cierre, creado_en, origen
       FROM cierre_dia
       WHERE id_bodega=:id_bodega AND fecha_cierre=CURDATE()
       LIMIT 1`,
      { id_bodega }
    );
    const [[yesterdayRow]] = await pool.query(
      `SELECT id_cierre, fecha_cierre, creado_en, origen
       FROM cierre_dia
       WHERE id_bodega=:id_bodega AND fecha_cierre=DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       LIMIT 1`,
      { id_bodega }
    );

    res.json({
      id_bodega,
      hoy,
      ayer,
      last_closed_date,
      today_closed: !!todayRow,
      yesterday_closed: !!yesterdayRow,
      pending_yesterday_close: !yesterdayRow,
      today_close: todayRow
        ? {
            id_cierre: Number(todayRow.id_cierre || 0),
            fecha_cierre: ymd(todayRow.fecha_cierre),
            creado_en: todayRow.creado_en,
            origen: todayRow.origen,
          }
        : null,
      yesterday_close: yesterdayRow
        ? {
            id_cierre: Number(yesterdayRow.id_cierre || 0),
            fecha_cierre: ymd(yesterdayRow.fecha_cierre),
            creado_en: yesterdayRow.creado_en,
            origen: yesterdayRow.origen,
          }
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.get("/api/cierre-dia", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.status(403).json({ error: "Sin permiso para ver cierres diarios" });

    const fecha = String(req.query.fecha || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const wh = Number(req.query.warehouse || 0);
    const limit = Math.max(1, Math.min(365, Number(req.query.limit || 120)));

    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({ error: "Fecha 'from' invalida. Formato esperado: YYYY-MM-DD" });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "Fecha 'to' invalida. Formato esperado: YYYY-MM-DD" });
    }

    const fromDate = fecha || from || null;
    const toDate = fecha || to || null;
    const warehouseScope = getScopedWarehouseFilter(scope, wh);
    if (warehouseScope.denied) {
      return res.json({
        id_bodega: null,
        can_all_bodegas: scope.can_all_bodegas,
        id_bodega_default: scope.id_bodega,
        filtros: { fecha: fecha || null, from: fromDate, to: toDate, warehouse: null, limit },
        rows: [],
      });
    }
    const id_bodega = !scope.can_all_bodegas ? scope.id_bodega : warehouseScope.selected;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "cdw")
        : null;

    const [rows] = await pool.query(
      `SELECT c.id_cierre,
              c.id_bodega,
              b.nombre_bodega,
              DATE_FORMAT(c.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
              c.total_entradas,
              c.total_salidas,
              c.total_existencia_cierre,
              c.creado_por,
              u.nombre_completo AS creado_por_nombre,
              c.origen,
              c.observaciones,
              c.creado_en,
              COALESCE(d.total_lineas, 0) AS total_lineas
       FROM cierre_dia c
       JOIN bodegas b ON b.id_bodega=c.id_bodega
       LEFT JOIN usuarios u ON u.id_usuario=c.creado_por
       LEFT JOIN (
         SELECT id_cierre, COUNT(*) AS total_lineas
         FROM cierre_dia_detalle
         GROUP BY id_cierre
       ) d ON d.id_cierre=c.id_cierre
       WHERE ${accessFilter ? `c.id_bodega IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR c.id_bodega=:id_bodega)
         AND (:from_date IS NULL OR c.fecha_cierre >= :from_date)
         AND (:to_date IS NULL OR c.fecha_cierre <= :to_date)
       ORDER BY c.fecha_cierre DESC, c.id_cierre DESC
       LIMIT ${limit}`,
      {
        id_bodega,
        from_date: fromDate,
        to_date: toDate,
        ...(accessFilter?.params || {}),
      }
    );

    res.json({
      id_bodega,
      can_all_bodegas: scope.can_all_bodegas,
      id_bodega_default: scope.id_bodega,
      filtros: { fecha: fecha || null, from: fromDate, to: toDate, warehouse: id_bodega, limit },
      rows,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
