// server-catalog-productos.js  |  Products CRUD and stock routes
import { pool, auth, buildProductWarehouseVisibilityClause, normalizeWarehouseIdList, ensureProductWarehouseVisibilityTable, buildTokenizedLikeFilter, areWarehouseIdsValid, saveProductVisibleWarehouseIds, getProductVisibleWarehouseIds, setProductWarehouseVisibility, isProductVisibleInWarehouse, ensureCatalogCanDeactivate } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

router.get("/api/productos/search", auth, async (req, res) => {
  await ensureProductWarehouseVisibilityTable();
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const id_bodega = Number(req.query.warehouse || 0) || null;
  const qf = buildTokenizedLikeFilter(q, ["nombre_producto", "sku"], "psq");
  const visibilityClause = buildProductWarehouseVisibilityClause("productos.id_producto", "id_bodega");
  const [rows] = await pool.query(
    `SELECT id_producto, nombre_producto, sku
     FROM productos
     WHERE activo=1
       AND ${visibilityClause}
       AND ${qf.clause}
     ORDER BY nombre_producto ASC
     LIMIT 20`,
    { id_bodega, ...qf.params }
  );
  res.json(rows);
});

router.get("/api/productos", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "pq");
  const defaultLimit = qRaw ? 5 : 200;
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit || defaultLimit)));
  const id_bodega_usuario = Number(req.user?.id_warehouse || 0) || null;
  const [rows] = await pool.query(
    `SELECT p.id_producto,
            p.nombre_producto,
            p.sku,
            p.id_medida,
            p.id_categoria,
            p.id_subcategoria,
            p.activo,
            m.nombre_medida,
            c.nombre_categoria,
            s.nombre_subcategoria,
            COALESCE(pwv.total_bodegas_visibles, 0) AS total_bodegas_visibles,
            COALESCE(pwv.nombres_bodegas_visibles, '') AS nombres_bodegas_visibles,
            CASE
              WHEN :id_bodega_usuario IS NULL THEN 1
              WHEN NOT EXISTS (
                SELECT 1
                FROM producto_bodegas_visibilidad pbv_all
                WHERE pbv_all.id_producto=p.id_producto
              ) THEN 1
              WHEN EXISTS (
                SELECT 1
                FROM producto_bodegas_visibilidad pbv_me
                WHERE pbv_me.id_producto=p.id_producto
                  AND pbv_me.id_bodega=:id_bodega_usuario
                  AND pbv_me.visible=1
              ) THEN 1
              ELSE 0
            END AS visible_en_bodega_usuario
     FROM productos p
     JOIN medidas m ON m.id_medida=p.id_medida
     JOIN categorias c ON c.id_categoria=p.id_categoria
     LEFT JOIN subcategorias s ON s.id_subcategoria=p.id_subcategoria
     LEFT JOIN (
       SELECT pbv.id_producto,
              COUNT(*) AS total_bodegas_visibles,
              GROUP_CONCAT(b.nombre_bodega ORDER BY b.nombre_bodega ASC SEPARATOR ', ') AS nombres_bodegas_visibles
       FROM producto_bodegas_visibilidad pbv
       JOIN bodegas b ON b.id_bodega=pbv.id_bodega
       WHERE pbv.visible=1
       GROUP BY pbv.id_producto
     ) pwv ON pwv.id_producto=p.id_producto
     WHERE (:all=1 OR p.activo=1)
       AND ${qf.clause}
     ORDER BY p.nombre_producto ASC
     LIMIT ${limit}`,
    { all: all ? 1 : 0, id_bodega_usuario, ...qf.params }
  );
  res.json(rows);
});

router.post("/api/productos", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      nombre_producto,
      sku = null,
      id_medida,
      id_categoria,
      id_subcategoria = null,
      activo = 1,
      id_bodegas_visibles = [],
    } = req.body || {};

    if (!nombre_producto) return res.status(400).json({ error: "Falta nombre del producto" });
    if (!id_medida) return res.status(400).json({ error: "Falta medida" });
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const visibleWarehouseIds = normalizeWarehouseIdList(id_bodegas_visibles);

    await conn.beginTransaction();
    if (!(await areWarehouseIdsValid(conn, visibleWarehouseIds))) {
      await conn.rollback();
      return res.status(400).json({ error: "Una o mas bodegas visibles no son validas o no estan activas" });
    }

    const [r] = await conn.query(
      `INSERT INTO productos
       (nombre_producto, sku, id_medida, id_categoria, id_subcategoria, activo)
       VALUES (:nombre_producto, :sku, :id_medida, :id_categoria, :id_subcategoria, :activo)`,
      {
        nombre_producto,
        sku: sku || null,
        id_medida,
        id_categoria,
        id_subcategoria: id_subcategoria || null,
        activo: activo ? 1 : 0,
      }
    );
    await saveProductVisibleWarehouseIds(conn, r.insertId, visibleWarehouseIds);
    await conn.commit();
    res.json({ ok: true, id_producto: r.insertId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El producto ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.patch("/api/productos/:id", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_producto = Number(req.params.id || 0);
    const {
      nombre_producto,
      sku = null,
      id_medida,
      id_categoria,
      id_subcategoria = null,
      activo = 1,
      id_bodegas_visibles = [],
    } = req.body || {};

    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    if (!nombre_producto) return res.status(400).json({ error: "Falta nombre del producto" });
    if (!id_medida) return res.status(400).json({ error: "Falta medida" });
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const visibleWarehouseIds = normalizeWarehouseIdList(id_bodegas_visibles);
    if (!Number(activo)) {
      const chk = await ensureCatalogCanDeactivate(conn, { entity: "PRODUCTO", id: id_producto });
      if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    }
    if (!(await areWarehouseIdsValid(conn, visibleWarehouseIds))) {
      return res.status(400).json({ error: "Una o mas bodegas visibles no son validas o no estan activas" });
    }

    const [r] = await conn.query(
      `UPDATE productos
       SET nombre_producto=:nombre_producto,
           sku=:sku,
           id_medida=:id_medida,
           id_categoria=:id_categoria,
           id_subcategoria=:id_subcategoria,
           activo=:activo
       WHERE id_producto=:id_producto`,
      {
        id_producto,
        nombre_producto,
        sku: sku || null,
        id_medida,
        id_categoria,
        id_subcategoria: id_subcategoria || null,
        activo: activo ? 1 : 0,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Producto no existe" });
    await saveProductVisibleWarehouseIds(conn, id_producto, visibleWarehouseIds);
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El producto ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.get("/api/productos/:id/bodegas-visibles", auth, async (req, res) => {
  try {
    const id_producto = Number(req.params.id || 0);
    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    await ensureProductWarehouseVisibilityTable();
    const ids = await getProductVisibleWarehouseIds(id_producto);
    const [bodegas] = await pool.query(
      `SELECT pbv.id_bodega, b.nombre_bodega
       FROM producto_bodegas_visibilidad pbv
       JOIN bodegas b ON b.id_bodega=pbv.id_bodega
       WHERE pbv.id_producto=:id_producto
         AND pbv.visible=1
       ORDER BY b.nombre_bodega ASC, pbv.id_bodega ASC`,
      { id_producto }
    );
    res.json({ id_producto, ids, bodegas: bodegas || [] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/productos/:id/visibilidad-mi-bodega", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_producto = Number(req.params.id || 0);
    const id_bodega = Number(req.user?.id_warehouse || 0);
    const visible = Number(req.body?.visible) ? 1 : 0;
    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega asignada" });

    await conn.beginTransaction();
    await setProductWarehouseVisibility(conn, id_producto, id_bodega, visible);
    await conn.commit();
    const visibleEnBodega = await isProductVisibleInWarehouse(pool, id_producto, id_bodega);
    res.json({ ok: true, id_producto, id_bodega, visible: visibleEnBodega ? 1 : 0 });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(Number(e?.status || 500)).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.get("/api/medidas", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_medida, nombre_medida FROM medidas WHERE activo=1 ORDER BY nombre_medida ASC`
  );
  res.json(rows);
});

router.get("/api/productos/:id/stock", auth, async (req, res) => {
  const id_producto = Number(req.params.id);
  const id_bodega = Number(req.query.warehouse || req.user.id_warehouse || 0);
  if (!id_producto) return res.status(400).json({ error: "Falta producto" });
  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  if (!(await isProductVisibleInWarehouse(pool, id_producto, id_bodega))) {
    return res.status(404).json({ error: "Producto no disponible para esa bodega" });
  }

  const [rows] = await pool.query(
    `SELECT stock FROM v_stock_resumen WHERE id_bodega=:id_bodega AND id_producto=:id_producto LIMIT 1`,
    { id_bodega, id_producto }
  );
  const [priceRows] = await pool.query(
    `SELECT k.costo_unitario FROM kardex k WHERE k.id_bodega=:id_bodega AND k.id_producto=:id_producto AND k.delta_cantidad > 0 ORDER BY k.creado_en DESC, k.id_kardex DESC LIMIT 1`,
    { id_bodega, id_producto }
  );
  res.json({
    stock: rows[0]?.stock ?? 0,
    precio_sugerido: Number(priceRows[0]?.costo_unitario || 0),
  });
});

export default router;
