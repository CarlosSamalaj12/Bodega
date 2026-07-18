// server-reportes-auditoria.js  |  Auditoria sensible route (modular)
import { pool, auth, requirePermission, buildTokenizedLikeFilter, canManageUserPermissions } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   AUDITORIA SENSIBLE
========================= */
router.get(
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

export default router;
