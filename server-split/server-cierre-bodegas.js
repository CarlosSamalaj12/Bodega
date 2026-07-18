// server-cierre-bodegas.js  |  Bodegas / categories / stock routes (modular)
import { pool, auth, softDelete } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   BODEGAS (CREAR)
========================= */
router.post("/api/bodegas", auth, async (req, res) => {
  const {
    nombre_bodega,
    tipo_bodega,
    activo = 1,
    maneja_stock = 1,
    puede_recibir = 1,
    puede_despachar = 1,
    modo_despacho_auto = "SALIDA",
    id_bodega_destino_default = null,
    permite_salida_conteo_final = 0,
    requiere_precio_salida = 0,
    telefono_contacto = null,
    direccion_contacto = null,
  } = req.body || {};

  if (!nombre_bodega) return res.status(400).json({ error: "Falta nombre" });
  if (!tipo_bodega) return res.status(400).json({ error: "Falta tipo" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO bodegas (nombre_bodega, tipo_bodega, activo, telefono_contacto, direccion_contacto)
       VALUES (:nombre_bodega, :tipo_bodega, :activo, :telefono_contacto, :direccion_contacto)`,
      {
        nombre_bodega,
        tipo_bodega,
        activo: activo ? 1 : 0,
        telefono_contacto: String(telefono_contacto || "").trim() || null,
        direccion_contacto: String(direccion_contacto || "").trim() || null,
      }
    );
    const id_bodega = r.insertId;

    await conn.query(
      `INSERT INTO configuracion_bodega
       (id_bodega, maneja_stock, puede_recibir, puede_despachar, modo_despacho_auto, id_bodega_destino_default, permite_salida_conteo_final, requiere_precio_salida)
       VALUES (:id_bodega, :maneja_stock, :puede_recibir, :puede_despachar, :modo_despacho_auto, :id_bodega_destino_default, :permite_salida_conteo_final, :requiere_precio_salida)`,
      {
        id_bodega,
        maneja_stock: maneja_stock ? 1 : 0,
        puede_recibir: puede_recibir ? 1 : 0,
        puede_despachar: puede_despachar ? 1 : 0,
        modo_despacho_auto,
        id_bodega_destino_default: id_bodega_destino_default || null,
        permite_salida_conteo_final: permite_salida_conteo_final ? 1 : 0,
        requiere_precio_salida: requiere_precio_salida ? 1 : 0,
      }
    );

    await conn.commit();
    res.json({ ok: true, id_bodega });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   CATEGORIES (INGLES)
========================= */
router.post("/api/categories", auth, async (req, res) => {
  const { category_name } = req.body || {};
  if (!category_name) return res.status(400).json({ error: "Falta nombre" });
  await pool.query("INSERT INTO categories(category_name, active) VALUES(:category_name, 1)", { category_name });
  res.json({ ok: true });
});

router.put("/api/categories/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const { category_name, active } = req.body || {};
  await pool.query(
    "UPDATE categories SET category_name=COALESCE(:category_name, category_name), active=COALESCE(:active, active) WHERE id_category=:id",
    { id, category_name: category_name ?? null, active: typeof active === "number" ? active : null }
  );
  res.json({ ok: true });
});

router.delete("/api/categories/:id", auth, async (req, res) => {
  await softDelete("categories", "id_category", Number(req.params.id));
  res.json({ ok: true });
});

/* =========================
   STOCK (solo con stock + no vencido opcional)
========================= */
router.get("/api/stock", auth, async (req, res) => {
  const id_warehouse = Number(req.query.warehouse || req.user.id_warehouse || 0);
  const onlyWithStock = String(req.query.onlyWithStock || "1") === "1";
  const includeLots = String(req.query.includeLots || "1") === "1";
  const notExpiredOnly = String(req.query.notExpiredOnly || "1") === "1";

  if (!id_warehouse) return res.status(400).json({ error: "Falta bodega" });

  if (includeLots) {
    const [rows] = await pool.query(
      `
      SELECT
        v.id_producto, p.nombre_producto, p.sku,
        v.lote, v.fecha_vencimiento,
        v.stock
      FROM v_stock_por_lote v
      JOIN productos p ON p.id_producto=v.id_producto
      WHERE v.id_bodega=:id_bodega
        ${onlyWithStock ? "AND v.stock > 0" : ""}
        ${notExpiredOnly ? "AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())" : ""}
      ORDER BY p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
      `,
      { id_bodega: id_warehouse }
    );
    return res.json(rows);
  } else {
    const [rows] = await pool.query(
      `
      SELECT
        s.id_producto, p.nombre_producto, p.sku,
        s.stock
      FROM v_stock_resumen s
      JOIN productos p ON p.id_producto=s.id_producto
      WHERE s.id_bodega=:id_bodega
        ${onlyWithStock ? "AND s.stock > 0" : ""}
      ORDER BY p.nombre_producto ASC
      `,
      { id_bodega: id_warehouse }
    );
    return res.json(rows);
  }
});

export default router;
