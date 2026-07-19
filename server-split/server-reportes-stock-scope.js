// server-reportes-stock-scope.js  |  Stock scope route
import { pool, auth, resolveStockScope, buildNamedInClause } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/reportes/stock-scope", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    let rows = [];
    if (!scope.can_view_existencias) {
      rows = [];
    } else if (scope.has_warehouse_restrictions) {
      const inClause = buildNamedInClause(scope.allowed_warehouse_ids, "sw");
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})
         ORDER BY nombre_bodega ASC`,
        inClause.params
      );
    } else if (scope.can_all_bodegas) {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
         ORDER BY nombre_bodega ASC`
      );
    } else {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega: scope.id_bodega }
      );
    }

    res.json({
      id_bodega_default: scope.id_bodega,
      maneja_stock: scope.maneja_stock,
      is_bodeguero: scope.is_bodeguero,
      can_close_day: scope.is_bodeguero,
      can_view_existencias: scope.can_view_existencias,
      can_all_bodegas: scope.can_all_bodegas,
      has_warehouse_restrictions: scope.has_warehouse_restrictions,
      bodegas: rows,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
