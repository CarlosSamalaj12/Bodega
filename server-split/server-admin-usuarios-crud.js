// server-admin-usuarios-crud.js  |  Usuarios CRUD: crear, editar, desactivar, reset pass/pin, listar
import { pool, auth, requirePermission, isAvatarTableMissingError, isValidOrderPin, findOrderPinCollision, bcrypt } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// ======= Local helper =======
function normalizeAvatarData(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\\\r\\n]+$/i.test(s)) return null;
  if (s.length > 1_400_000) return null;
  return s;
}

// -------------------------------------------------------
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

export default router;
