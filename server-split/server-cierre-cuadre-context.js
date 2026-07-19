// server-cierre-cuadre-context.js  |  Cuadre caja: context route + shared helpers
import { pool, auth, requirePermission } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// ======= Shared helpers (used by cuadre-crud and cuadre-print too) =======
export function isCuadreAllWarehousesRoleName(roleName) {
  const n = String(roleName || "").trim().toUpperCase();
  return n.includes("ADMIN") || n.includes("REPORTE");
}

export async function resolveCuadreScope(user) {
  const id_usuario = Number(user?.id_user || 0);
  const id_rol = Number(user?.id_role || 0);
  const id_bodega_usuario = Number(user?.id_warehouse || 0) || null;

  let roleName = "";
  if (id_rol > 0) {
    const [[roleRow]] = await pool.query(
      `SELECT nombre_rol
       FROM roles
       WHERE id_rol=:id_rol
       LIMIT 1`,
      { id_rol }
    );
    roleName = String(roleRow?.nombre_rol || "").trim();
  }

  const can_all_bodegas = isCuadreAllWarehousesRoleName(roleName);

  const [bodegas] = await pool.query(
    `SELECT id_bodega, nombre_bodega
     FROM bodegas
     WHERE activo=1
     ORDER BY nombre_bodega ASC`
  );
  const rows = Array.isArray(bodegas) ? bodegas : [];
  const ids = rows.map((b) => Number(b.id_bodega || 0)).filter((x) => x > 0);

  const id_bodega_default = id_bodega_usuario && ids.includes(id_bodega_usuario)
    ? id_bodega_usuario
    : (ids[0] || null);

  if (!can_all_bodegas) {
    if (id_bodega_usuario && ids.includes(id_bodega_usuario)) {
      return {
        id_usuario,
        can_all_bodegas,
        id_bodega_default,
        allowed_ids: [id_bodega_usuario],
        bodegas: rows.filter((b) => Number(b.id_bodega || 0) === id_bodega_usuario),
      };
    }
    return {
      id_usuario,
      can_all_bodegas,
      id_bodega_default: null,
      allowed_ids: [],
      bodegas: [],
    };
  }

  return {
    id_usuario,
    can_all_bodegas,
    id_bodega_default,
    allowed_ids: ids,
    bodegas: rows,
  };
}

// -------------------------------------------------------
router.get("/api/cuadre-caja/context", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    return res.json({
      ok: true,
      can_all_bodegas: scope.can_all_bodegas,
      id_bodega_default: scope.id_bodega_default,
      bodegas: scope.bodegas || [],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
