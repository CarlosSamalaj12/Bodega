// server-lib/pins.js  —  Device key and PIN utilities
import { pool, bcrypt } from "./core.js";

function normalizeDeviceKey(v) { return String(v || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""); }

function getSharedDeviceKeys() { return String(process.env.SHARED_DEVICE_KEYS || "").split(",").map((x) => normalizeDeviceKey(x)).filter(Boolean); }

function isValidOrderPin(pin) { return /^\d{6,12}$/.test(String(pin || "")); }

function isValidSupervisorPin(pin) { return /^\d{6,12}$/.test(String(pin || "")); }

async function findOrderPinCollision(pin, excludeUserId = 0, conn = pool, onlyActive = false) {
  const safePin = String(pin || "").trim();
  if (!safePin) return null;
  const excluded = Number(excludeUserId || 0);
  const activeClause = onlyActive ? " AND u.activo=1" : "";
  const [rows] = await conn.query(
    `SELECT upp.id_usuario, u.usuario, u.nombre_completo${activeClause}
     FROM usuario_pin_pedido upp
     JOIN usuarios u ON u.id_usuario=upp.id_usuario
     WHERE upp.id_usuario!=:excluded${activeClause}`,
    { excluded }
  );
  for (const r of rows || []) {
    const match = await bcrypt.compare(safePin, r.pin_hash || "");
    if (match) return r;
  }
  return null;
}

export { normalizeDeviceKey, getSharedDeviceKeys, isValidOrderPin, isValidSupervisorPin, findOrderPinCollision };
