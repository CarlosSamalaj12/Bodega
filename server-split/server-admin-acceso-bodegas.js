// server-admin-acceso-bodegas.js  |  Acceso bodegas de usuarios: consulta y actualizacion
import { pool, auth, canManageUserPermissions, ensureUserWarehouseAccessTable, normalizeWarehouseIdList, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/usuarios/:id/bodegas-acceso", auth, async (req, res) => {
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });

    const [rows] = await pool.query(
      `SELECT uba.id_bodega, b.nombre_bodega
       FROM usuario_bodegas_acceso uba
       JOIN bodegas b ON b.id_bodega=uba.id_bodega
       WHERE uba.id_usuario=:id_usuario
       ORDER BY b.nombre_bodega ASC, uba.id_bodega ASC`,
      { id_usuario }
    );
    res.json({
      id_usuario,
      bodegas: rows || [],
      ids: normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega)),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.put("/api/usuarios/:id/bodegas-acceso", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const ids = normalizeWarehouseIdList(req.body?.id_bodegas || []);

    const [[userRow]] = await conn.query(
      `SELECT u.id_usuario, r.nombre_rol
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario }
    );
    if (!userRow) return res.status(404).json({ error: "Usuario no existe" });

    const roleName = String(userRow?.nombre_rol || "").trim().toUpperCase();
    const isReportRole = roleName.includes("REPORTE");
    const isAdminRole = roleName.includes("ADMIN");
    if (!isReportRole || isAdminRole) {
      return res.status(400).json({ error: "Solo usuarios de reportes no administradores pueden tener este filtro" });
    }

    if (ids.length) {
      const inClause = buildNamedInClause(ids, "uba");
      const [validRows] = await conn.query(
        `SELECT id_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})`,
        inClause.params
      );
      const validIds = normalizeWarehouseIdList((validRows || []).map((r) => r.id_bodega));
      if (validIds.length !== ids.length) {
        return res.status(400).json({ error: "Una o mas bodegas no son validas o no estan activas" });
      }
    }

    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM usuario_bodegas_acceso
       WHERE id_usuario=:id_usuario`,
      { id_usuario }
    );
    for (const id_bodega of ids) {
      await conn.query(
        `INSERT INTO usuario_bodegas_acceso (id_usuario, id_bodega)
         VALUES (:id_usuario, :id_bodega)`,
        { id_usuario, id_bodega }
      );
    }
    await conn.commit();
    res.json({ ok: true, id_usuario, id_bodegas: ids });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

export default router;
