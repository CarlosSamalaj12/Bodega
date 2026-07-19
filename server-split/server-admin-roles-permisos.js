// server-admin-roles-permisos.js  |  Roles y permisos: lista, catalogo, consulta y guardado
import { pool, auth, canManageUserPermissions, getUserPermissionsMap, PERM_CATALOG, resolveStockScope, permissionDefaults } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/roles", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_rol AS id_role, nombre_rol AS role_name
     FROM roles
     WHERE activo=1
     ORDER BY nombre_rol ASC`
  );
  res.json(rows);
});

router.get("/api/permisos/catalogo", auth, async (req, res) => {
  res.json(PERM_CATALOG);
});

router.get("/api/me/permisos", auth, async (req, res) => {
  try {
    const id_usuario = Number(req.user?.id_user || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    const scope = await resolveStockScope(req.user);
    res.json({
      permisos: map,
      catalogo: PERM_CATALOG,
      is_admin_role: Number(scope?.is_admin_role ? 1 : 0),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.get("/api/usuarios/:id/permisos", auth, async (req, res) => {
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    res.json({ id_usuario, permisos: map, catalogo: PERM_CATALOG });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.put("/api/usuarios/:id/permisos", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const input = req.body?.permisos || {};
    const map = permissionDefaults();

    if (Array.isArray(input)) {
      for (const it of input) {
        const k = String(it?.permiso || "");
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        map[k] = Number(it?.activo) ? 1 : 0;
      }
    } else if (input && typeof input === "object") {
      for (const k of Object.keys(map)) {
        if (Object.prototype.hasOwnProperty.call(input, k)) {
          map[k] = Number(input[k]) ? 1 : 0;
        }
      }
    } else {
      return res.status(400).json({ error: "Formato de permisos invalido" });
    }

    await conn.beginTransaction();
    for (const k of Object.keys(map)) {
      await conn.query(
        `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
         VALUES (:id_usuario, :permiso, :activo)
         ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
        { id_usuario, permiso: k, activo: map[k] }
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

export default router;
