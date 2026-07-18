// server-admin-config.js  |  Config routes (modular)
import { pool, auth } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
/* =========================
   BODEGAS (EDITAR)
========================= */
router.patch("/api/bodegas/:id", auth, async (req, res) => {
  const id_bodega = Number(req.params.id || 0);
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

  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  if (!nombre_bodega) return res.status(400).json({ error: "Falta nombre" });
  if (!tipo_bodega) return res.status(400).json({ error: "Falta tipo" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [up] = await conn.query(
      `UPDATE bodegas
       SET nombre_bodega=:nombre_bodega,
           tipo_bodega=:tipo_bodega,
           activo=:activo,
           telefono_contacto=:telefono_contacto,
           direccion_contacto=:direccion_contacto
       WHERE id_bodega=:id_bodega`,
      {
        id_bodega,
        nombre_bodega,
        tipo_bodega,
        activo: activo ? 1 : 0,
        telefono_contacto: String(telefono_contacto || "").trim() || null,
        direccion_contacto: String(direccion_contacto || "").trim() || null,
      }
    );
    if (!up.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: "Bodega no existe" });
    }

    await conn.query(
      `INSERT INTO configuracion_bodega
       (id_bodega, maneja_stock, puede_recibir, puede_despachar, modo_despacho_auto, id_bodega_destino_default, permite_salida_conteo_final, requiere_precio_salida)
       VALUES (:id_bodega, :maneja_stock, :puede_recibir, :puede_despachar, :modo_despacho_auto, :id_bodega_destino_default, :permite_salida_conteo_final, :requiere_precio_salida)
       ON DUPLICATE KEY UPDATE
         maneja_stock=VALUES(maneja_stock),
         puede_recibir=VALUES(puede_recibir),
         puede_despachar=VALUES(puede_despachar),
         modo_despacho_auto=VALUES(modo_despacho_auto),
         id_bodega_destino_default=VALUES(id_bodega_destino_default),
         permite_salida_conteo_final=VALUES(permite_salida_conteo_final),
         requiere_precio_salida=VALUES(requiere_precio_salida)`,
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
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Ya existe una bodega con ese nombre" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

export default router;
