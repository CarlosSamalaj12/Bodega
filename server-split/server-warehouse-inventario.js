// server-warehouse-inventario.js  |  Bodegas: listado y detalle
import { pool, auth } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/bodegas", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT b.id_bodega,
            b.nombre_bodega,
            b.tipo_bodega,
            b.activo,
            b.telefono_contacto,
            b.direccion_contacto,
            cb.maneja_stock,
            cb.puede_recibir,
            cb.puede_despachar,
            cb.modo_despacho_auto,
            cb.id_bodega_destino_default,
            cb.permite_salida_conteo_final,
            cb.requiere_precio_salida
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE (:all=1 OR b.activo=1)
     ORDER BY b.nombre_bodega ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.get("/api/bodegas/:id", auth, async (req, res) => {
  const id_bodega = Number(req.params.id);
  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  const [rows] = await pool.query(
    `SELECT b.id_bodega,
            b.nombre_bodega,
            b.telefono_contacto,
            b.direccion_contacto,
            cb.requiere_precio_salida
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE b.id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );
  if (!rows.length) return res.status(404).json({ error: "No existe bodega" });
  res.json(rows[0]);
});

export default router;
