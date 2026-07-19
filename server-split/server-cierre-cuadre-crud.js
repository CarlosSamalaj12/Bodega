// server-cierre-cuadre-crud.js  |  Cuadre caja: reportes, consulta y guardado
import { pool, auth, requirePermission, normalizeCuadrePayload, normalizeYmdInput, ymd } from '../server-shared.js';
import { Router } from 'express';
import { resolveCuadreScope } from './server-cierre-cuadre-context.js';
const router = Router();
// -------------------------------------------------------
router.get("/api/reportes/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver reporte de cuadres de caja"), async (req, res) => {
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

router.get("/api/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
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

router.post(
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

export default router;
