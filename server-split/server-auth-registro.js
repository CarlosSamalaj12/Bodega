// server-auth-registro.js  |  Users listing for login (registro de usuarios)
import { pool, isAvatarTableMissingError } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/auth/users", async (req, res) => {
  try {
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT u.usuario AS username,
                u.nombre_completo AS full_name,
                ua.avatar_data AS avatar_url
         FROM usuarios u
         LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
         WHERE u.activo=1
         ORDER BY u.nombre_completo ASC`
      );
    } catch (e) {
      if (!isAvatarTableMissingError(e)) throw e;
      [rows] = await pool.query(
        `SELECT u.usuario AS username,
                u.nombre_completo AS full_name,
                '' AS avatar_url
         FROM usuarios u
         WHERE u.activo=1
         ORDER BY u.nombre_completo ASC`
      );
    }
    res.json(
      (rows || []).map((u) => ({
        username: String(u.username || ""),
        full_name: String(u.full_name || ""),
        avatar_url: String(u.avatar_url || ""),
      }))
    );
  } catch (e) {
    res.status(500).json({ error: "No se pudo cargar usuarios para login" });
  }
});

export default router;
