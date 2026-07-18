// server-admin-usuarios.js  |  Usuarios / roles / permisos / acceso routes (modular)
import { pool, auth, requirePermission, isAvatarTableMissingError, getUserPermissionsMap, canManageUserPermissions, PERM_CATALOG, isValidOrderPin, findOrderPinCollision, bcrypt, normalizeWarehouseIdList, buildNamedInClause, resolveStockScope, ensureUserWarehouseAccessTable, permissionDefaults } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// ======= Local helper (extracted from monolithic backup) =======
function normalizeAvatarData(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\\r\\n]+$/i.test(s)) return null;
  if (s.length > 1_400_000) return null;
  return s;
}

// -------------------------------------------------------
/* =========================
   ROLES (LISTA)
========================= */
router.get("/api/roles", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_rol AS id_role, nombre_rol AS role_name
     FROM roles
     WHERE activo=1
     ORDER BY nombre_rol ASC`
  );
  res.json(rows);
});

/* =========================
   USUARIOS (CREAR)
========================= */
router.post("/api/usuarios", auth, async (req, res) => {
  try {
    const {
      username,
      full_name,
      password,
      order_pin = null,
      can_supervisor = 0,
      no_auto_logout = 0,
      id_role,
      id_warehouse = null,
      active = 1,
      avatar_data = null,
    } = req.body || {};

    const user = String(username || "").trim();
    const name = String(full_name || "").trim();
    const pass = String(password || "");
    const pinPedido = String(order_pin || "").trim();
    const canSupervisor = Number(can_supervisor) ? 1 : 0;
    const roleId = Number(id_role || 0);
    const warehouseId = Number(id_warehouse || 0) || null;
    const isActive = Number(active) ? 1 : 0;
    const noAutoLogout = Number(no_auto_logout) ? 1 : 0;
    const avatarData = normalizeAvatarData(avatar_data);

    if (!user) return res.status(400).json({ error: "Falta usuario" });
    if (!name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });
    if (pinPedido && !isValidOrderPin(pinPedido)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });
    if (!roleId) return res.status(400).json({ error: "Falta rol" });
    if (pinPedido) {
      const duplicatedPinOwner = await findOrderPinCollision(pinPedido, 0, pool, false);
      if (duplicatedPinOwner) {
        return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
      }
    }

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `INSERT INTO usuarios
       (usuario, nombre_completo, contrasena_hash, id_rol, id_bodega, activo, no_auto_logout)
       VALUES (:usuario, :nombre_completo, :contrasena_hash, :id_rol, :id_bodega, :activo, :no_auto_logout)`,
      {
        usuario: user,
        nombre_completo: name,
        contrasena_hash: passHash,
        id_rol: roleId,
        id_bodega: warehouseId,
        activo: isActive,
        no_auto_logout: noAutoLogout,
      }
    );

    if (avatarData) {
      try {
        await pool.query(
          `INSERT INTO usuario_avatar (id_usuario, avatar_data)
           VALUES (:id_usuario, :avatar_data)
           ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
          { id_usuario: r.insertId, avatar_data: avatarData }
        );
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    if (pinPedido) {
      const pinHash = await bcrypt.hash(pinPedido, 10);
      await pool.query(
        `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
         VALUES (:id_usuario, :pin_hash)
         ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
        { id_usuario: r.insertId, pin_hash: pinHash }
      );
    }
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: r.insertId, activo: canSupervisor }
    );

    res.json({ ok: true, id_user: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (RESET PASSWORD)
========================= */
router.post("/api/usuarios/:id/reset-password", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pass = String(req.body?.password || "");
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `UPDATE usuarios
       SET contrasena_hash=:contrasena_hash
       WHERE id_usuario=:id_usuario`,
      { contrasena_hash: passHash, id_usuario: id_user }
    );

    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/usuarios/:id/reset-order-pin", auth, requirePermission("action.manage_permissions", "restablecer PIN de pedidos"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pin = String(req.body?.pin || "").trim();
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!isValidOrderPin(pin)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });

    const [usr] = await pool.query(
      `SELECT id_usuario
       FROM usuarios
       WHERE id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: id_user }
    );
    if (!usr.length) return res.status(404).json({ error: "Usuario no existe" });
    const duplicatedPinOwner = await findOrderPinCollision(pin, id_user, pool, false);
    if (duplicatedPinOwner) {
      return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query(
      `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
       VALUES (:id_usuario, :pin_hash)
       ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
      { id_usuario: id_user, pin_hash: pinHash }
    );

    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (EDITAR)
========================= */
router.patch("/api/usuarios/:id", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const username = String(req.body?.username || "").trim();
    const full_name = String(req.body?.full_name || "").trim();
    const id_role = Number(req.body?.id_role || 0);
    const id_warehouse = Number(req.body?.id_warehouse || 0) || null;
    const active = Number(req.body?.active) ? 1 : 0;
    const no_auto_logout = Number(req.body?.no_auto_logout) ? 1 : 0;
    const can_supervisor = Number(req.body?.can_supervisor) ? 1 : 0;
    const hasAvatarField = Object.prototype.hasOwnProperty.call(req.body || {}, "avatar_data");
    const avatarData = normalizeAvatarData(req.body?.avatar_data);

    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!username) return res.status(400).json({ error: "Falta usuario" });
    if (!full_name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!id_role) return res.status(400).json({ error: "Falta rol" });

    const [r] = await pool.query(
      `UPDATE usuarios
       SET usuario=:usuario,
           nombre_completo=:nombre_completo,
           id_rol=:id_rol,
           id_bodega=:id_bodega,
           activo=:activo,
           no_auto_logout=:no_auto_logout
       WHERE id_usuario=:id_usuario`,
      {
        usuario: username,
        nombre_completo: full_name,
        id_rol: id_role,
        id_bodega: id_warehouse,
        activo: active,
        no_auto_logout,
        id_usuario: id_user,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: id_user, activo: can_supervisor }
    );

    if (hasAvatarField) {
      try {
        if (avatarData) {
          await pool.query(
            `INSERT INTO usuario_avatar (id_usuario, avatar_data)
             VALUES (:id_usuario, :avatar_data)
             ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
            { id_usuario: id_user, avatar_data: avatarData }
          );
        } else {
          await pool.query(`DELETE FROM usuario_avatar WHERE id_usuario=:id_usuario`, { id_usuario: id_user });
        }
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (DESACTIVAR)
========================= */
router.post("/api/usuarios/:id/deactivate", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (Number(req.user?.id_user || 0) === id_user) {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
    }
    const [r] = await pool.query(
      `UPDATE usuarios
       SET activo=0
       WHERE id_usuario=:id_usuario`,
      { id_usuario: id_user }
    );
    if (!r.affectedRows) {
      const [chk] = await pool.query(
        `SELECT id_usuario FROM usuarios WHERE id_usuario=:id_usuario LIMIT 1`,
        { id_usuario: id_user }
      );
      if (!chk.length) return res.status(404).json({ error: "Usuario no existe" });
    }
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (LISTA)
========================= */
router.get("/api/usuarios", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  let rows = [];
  try {
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              ua.avatar_data AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  } catch (e) {
    if (!isAvatarTableMissingError(e)) throw e;
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              '' AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  }
  res.json(rows);
});

/* =========================
   PERMISOS
========================= */
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

/* =========================
   USUARIOS BODEGAS ACCESO
========================= */
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

/* =========================
   USUARIOS PERMISOS (GUARDAR)
========================= */
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
