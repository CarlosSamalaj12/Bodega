// server-auth-middleware.js  |  Session policy route (compartido/dispositivo)
import { pool, auth, normalizeDeviceKey, getSharedDeviceKeys } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/session-policy", auth, async (req, res) => {
  try {
    const headerKey = normalizeDeviceKey(req.headers["x-device-key"]);
    const sharedKeys = getSharedDeviceKeys();
    const shared = !!headerKey && sharedKeys.includes(headerKey);
    const idUser = Number(req.user?.id_user || 0);
    let userNoAutoLogout = false;
    if (idUser) {
      const [[u]] = await pool.query(
        `SELECT no_auto_logout
         FROM usuarios
         WHERE id_usuario=:id_usuario
         LIMIT 1`,
        { id_usuario: idUser }
      );
      userNoAutoLogout = Number(u?.no_auto_logout || 0) === 1;
    }
    const noAutoLogout = shared || userNoAutoLogout;
    res.json({
      shared_device: shared,
      no_auto_logout: noAutoLogout,
      inactivity_logout_ms: noAutoLogout ? 0 : 30 * 60 * 1000,
      device_key: headerKey || null,
      by_user_policy: userNoAutoLogout,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
