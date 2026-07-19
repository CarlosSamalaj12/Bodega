// server-auth-login.js  |  Login route
import { pool, bcrypt, signToken, isAvatarTableMissingError } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Falta usuario o contrasena" });

    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT
           u.id_usuario AS id_user,
           u.usuario AS username,
           u.nombre_completo AS full_name,
           u.contrasena_hash AS pass_hash,
           u.id_rol AS id_role,
           u.id_bodega AS id_warehouse,
           u.no_auto_logout AS no_auto_logout,
           u.activo AS active,
           ua.avatar_data AS avatar_url
         FROM usuarios u
         LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
         WHERE u.usuario=:username
         LIMIT 1`,
        { username }
      );
    } catch (e) {
      if (!isAvatarTableMissingError(e)) throw e;
      [rows] = await pool.query(
        `SELECT
           u.id_usuario AS id_user,
           u.usuario AS username,
           u.nombre_completo AS full_name,
           u.contrasena_hash AS pass_hash,
           u.id_rol AS id_role,
           u.id_bodega AS id_warehouse,
           u.no_auto_logout AS no_auto_logout,
           u.activo AS active,
           '' AS avatar_url
         FROM usuarios u
         WHERE u.usuario=:username
         LIMIT 1`,
        { username }
      );
    }
    const u = rows[0];
    if (!u || !u.active) return res.status(401).json({ error: "Usuario invalido o inactivo" });

    const ok = await bcrypt.compare(password, u.pass_hash || "");
    if (!ok) return res.status(401).json({ error: "Contrasena incorrecta" });

    const token = signToken(u);
    res.json({
      token,
      user: {
        id_user: u.id_user,
        full_name: u.full_name,
        id_role: u.id_role,
        id_warehouse: u.id_warehouse,
        no_auto_logout: Number(u.no_auto_logout || 0),
        avatar_url: u.avatar_url || "",
      },
    });
  } catch (e) {
    console.error("Error en /api/auth/login:", e);
    return res.status(500).json({ error: "Error interno en login" });
  }
});

export default router;
