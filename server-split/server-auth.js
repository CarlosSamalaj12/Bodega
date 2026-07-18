// server-auth.js  |  Auth routes (modular)
import { app, pool, auth, bcrypt, signToken, normalizeDeviceKey, getSharedDeviceKeys, isAvatarTableMissingError, getUserWarehouseAccessIds } from '../server-shared.js';
// -------------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Falta usuario o contrasena" });

    // Tabla/columnas en espanol -> alias a nombres usados por la app
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

app.get("/api/auth/users", async (req, res) => {
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

app.get("/api/session-policy", auth, async (req, res) => {
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

/* =========================
   HELPERS CRUD
========================= */
async function listActive(table, nameField) {
  const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY ${nameField} ASC`);
  return rows;
}

async function softDelete(table, idField, id) {
  await pool.query(`UPDATE ${table} SET active=0 WHERE ${idField}=:id`, { id });
}

/* =========================
   LOCAL HELPERS
========================= */
