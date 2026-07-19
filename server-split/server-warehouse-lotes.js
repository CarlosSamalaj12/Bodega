// server-warehouse-lotes.js  |  Logos e imagenes de bodega
import { pool, auth, requirePermission, normalizeLogoData, getWarehouseCustomLogoRow, ensureWarehouseLogoTable, getPrintLogoDataUri } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/bodegas/:id/logo", auth, async (req, res) => {
  try {
    const id_bodega = Number(req.params.id || 0);
    if (!id_bodega) return res.status(400).json({ error: "Bodega invalida" });
    const row = await getWarehouseCustomLogoRow(id_bodega);
    const effective_logo_data = (row?.print || await getPrintLogoDataUri());
    res.json({
      id_bodega,
      logo_data: row?.legacy || "",
      logo_app_data: row?.app || "",
      logo_print_data: row?.print || "",
      effective_logo_data,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.put("/api/bodegas/:id/logo", auth, requirePermission("action.create_update", "actualizar logo de bodega"), async (req, res) => {
  try {
    const id_bodega = Number(req.params.id || 0);
    if (!id_bodega) return res.status(400).json({ error: "Bodega invalida" });
    await ensureWarehouseLogoTable();

    const legacyLogo = normalizeLogoData(req.body?.logo_data);
    const hasApp = Object.prototype.hasOwnProperty.call(req.body || {}, "logo_app_data");
    const hasPrint = Object.prototype.hasOwnProperty.call(req.body || {}, "logo_print_data");
    const logo_app_data = hasApp ? normalizeLogoData(req.body?.logo_app_data) : legacyLogo;
    const logo_print_data = hasPrint ? normalizeLogoData(req.body?.logo_print_data) : legacyLogo;
    if (logo_app_data || logo_print_data || legacyLogo) {
      await pool.query(
        `INSERT INTO bodega_logo (id_bodega, logo_data, logo_app_data, logo_print_data)
         VALUES (:id_bodega, :logo_data, :logo_app_data, :logo_print_data)
         ON DUPLICATE KEY UPDATE
           logo_data=VALUES(logo_data),
           logo_app_data=VALUES(logo_app_data),
           logo_print_data=VALUES(logo_print_data)`,
        {
          id_bodega,
          logo_data: legacyLogo,
          logo_app_data,
          logo_print_data,
        }
      );
    } else {
      await pool.query(
        `DELETE FROM bodega_logo
         WHERE id_bodega=:id_bodega`,
        { id_bodega }
      );
    }

    res.json({ ok: true, id_bodega });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
