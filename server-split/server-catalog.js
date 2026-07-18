// server-catalog.js  |  Catalog CRUD routes (modular)
import { pool, auth, listActive, softDelete, buildProductWarehouseVisibilityClause, buildNamedInClause, normalizeWarehouseIdList, getUserWarehouseAccessIds, ensureProductWarehouseVisibilityTable, getActiveWarehouseIds, buildTokenizedLikeFilter, areWarehouseIdsValid, saveProductVisibleWarehouseIds, getProductVisibleWarehouseIds, setProductWarehouseVisibility, isProductVisibleInWarehouse, ensureCatalogCanDeactivate } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/categories", auth, async (req, res) => {
  res.json(await listActive("categories", "category_name"));
});

/* =========================
   PRODUCTOS (BUSQUEDA)
========================= */
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
    try {
      await conn.rollback();
    } catch {}
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
    res.json({
      id_producto,
      ids,
      bodegas: bodegas || [],
    });
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
    try {
      await conn.rollback();
    } catch {}
    res.status(Number(e?.status || 500)).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.get("/api/medidas", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_medida, nombre_medida
     FROM medidas
     WHERE activo=1
     ORDER BY nombre_medida ASC`
  );
  res.json(rows);
});

router.get("/api/categorias", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT id_categoria, nombre_categoria, activo
     FROM categorias
     WHERE (:all=1 OR activo=1)
     ORDER BY nombre_categoria ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/categorias", auth, async (req, res) => {
  try {
    const nombre_categoria = String(req.body?.nombre_categoria || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;
    if (!nombre_categoria) return res.status(400).json({ error: "Falta nombre de categoria" });

    const [r] = await pool.query(
      `INSERT INTO categorias (nombre_categoria, activo)
       VALUES (:nombre_categoria, :activo)`,
      { nombre_categoria, activo }
    );
    res.json({ ok: true, id_categoria: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La categoria ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/categorias/:id_categoria", auth, async (req, res) => {
  try {
    const id_categoria = Number(req.params.id_categoria || 0);
    const rawNombre = req.body?.nombre_categoria;
    const nombre_categoria = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (nombre_categoria !== null && !nombre_categoria) {
      return res.status(400).json({ error: "Falta nombre de categoria" });
    }
    if (nombre_categoria === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE categorias
       SET nombre_categoria=COALESCE(:nombre_categoria, nombre_categoria),
           activo=COALESCE(:activo, activo)
       WHERE id_categoria=:id_categoria`,
      { id_categoria, nombre_categoria, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Categoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La categoria ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/categorias/:id_categoria/deactivate", auth, async (req, res) => {
  try {
    const id_categoria = Number(req.params.id_categoria || 0);
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const [r] = await pool.query(
      `UPDATE categorias
       SET activo=0
       WHERE id_categoria=:id_categoria`,
      { id_categoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Categoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.get("/api/subcategorias", auth, async (req, res) => {
  const id_categoria = Number(req.query.categoria || 0) || null;
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT s.id_subcategoria,
            s.id_categoria,
            s.nombre_subcategoria,
            s.activo,
            c.nombre_categoria
     FROM subcategorias s
     JOIN categorias c ON c.id_categoria=s.id_categoria
     WHERE (:all=1 OR s.activo=1)
       AND (:id_categoria IS NULL OR s.id_categoria=:id_categoria)
     ORDER BY c.nombre_categoria ASC, s.nombre_subcategoria ASC`,
    { id_categoria, all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/subcategorias", auth, async (req, res) => {
  try {
    const id_categoria = Number(req.body?.id_categoria || 0);
    const nombre_subcategoria = String(req.body?.nombre_subcategoria || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (!nombre_subcategoria) return res.status(400).json({ error: "Falta nombre de subcategoria" });

    const [r] = await pool.query(
      `INSERT INTO subcategorias (id_categoria, nombre_subcategoria, activo)
       VALUES (:id_categoria, :nombre_subcategoria, :activo)`,
      { id_categoria, nombre_subcategoria, activo }
    );
    res.json({ ok: true, id_subcategoria: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La subcategoria ya existe en esa categoria" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/subcategorias/:id_subcategoria", auth, async (req, res) => {
  try {
    const id_subcategoria = Number(req.params.id_subcategoria || 0);
    const id_categoria =
      typeof req.body?.id_categoria === "undefined" || req.body?.id_categoria === null
        ? null
        : Number(req.body.id_categoria || 0);
    const rawNombre = req.body?.nombre_subcategoria;
    const nombre_subcategoria = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_subcategoria) return res.status(400).json({ error: "Falta subcategoria" });
    if (id_categoria !== null && !id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (nombre_subcategoria !== null && !nombre_subcategoria) {
      return res.status(400).json({ error: "Falta nombre de subcategoria" });
    }
    if (id_categoria === null && nombre_subcategoria === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE subcategorias
       SET id_categoria=COALESCE(:id_categoria, id_categoria),
           nombre_subcategoria=COALESCE(:nombre_subcategoria, nombre_subcategoria),
           activo=COALESCE(:activo, activo)
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria, id_categoria, nombre_subcategoria, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La subcategoria ya existe en esa categoria" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/subcategorias/:id_subcategoria/deactivate", auth, async (req, res) => {
  try {
    const id_subcategoria = Number(req.params.id_subcategoria || 0);
    if (!id_subcategoria) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE subcategorias
       SET activo=0
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.get("/api/limites", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000)));
  const [rows] = await pool.query(
    `SELECT l.id_bodega,
            l.id_producto,
            l.minimo,
            l.maximo,
            l.activo,
            b.nombre_bodega,
            p.nombre_producto,
            p.sku
     FROM limites_producto_bodega l
     JOIN bodegas b ON b.id_bodega=l.id_bodega
     JOIN productos p ON p.id_producto=l.id_producto
     WHERE (:all=1 OR l.activo=1)
     ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC
     LIMIT ${limit}`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/limites", auth, async (req, res) => {
  try {
    const { id_bodega, id_producto, minimo = 0, maximo = 0, activo = 1 } = req.body || {};
    const idB = Number(id_bodega || 0);
    const idP = Number(id_producto || 0);
    const min = Number(minimo || 0);
    const max = Number(maximo || 0);
    const isActive = Number(activo) ? 1 : 0;
    if (!idB) return res.status(400).json({ error: "Falta bodega" });
    if (!idP) return res.status(400).json({ error: "Falta producto" });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return res.status(400).json({ error: "Minimo y maximo deben ser numericos" });
    if (min < 0 || max < 0) return res.status(400).json({ error: "Minimo y maximo no pueden ser negativos" });
    if (max > 0 && min > max) return res.status(400).json({ error: "Minimo mayor que maximo" });

    await pool.query(
      `INSERT INTO limites_producto_bodega (id_bodega, id_producto, minimo, maximo, activo)
       VALUES (:id_bodega, :id_producto, :minimo, :maximo, :activo)
       ON DUPLICATE KEY UPDATE
         minimo=VALUES(minimo),
         maximo=VALUES(maximo),
         activo=VALUES(activo)`,
      { id_bodega: idB, id_producto: idP, minimo: min, maximo: max, activo: isActive }
    );
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/limites/:id_bodega/:id_producto", auth, async (req, res) => {
  try {
    const idB = Number(req.params.id_bodega || 0);
    const idP = Number(req.params.id_producto || 0);
    const min = Number(req.body?.minimo || 0);
    const max = Number(req.body?.maximo || 0);
    const isActive = Number(req.body?.activo) ? 1 : 0;
    if (!idB || !idP) return res.status(400).json({ error: "Faltan llaves del limite" });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return res.status(400).json({ error: "Minimo y maximo deben ser numericos" });
    if (min < 0 || max < 0) return res.status(400).json({ error: "Minimo y maximo no pueden ser negativos" });
    if (max > 0 && min > max) return res.status(400).json({ error: "Minimo mayor que maximo" });
    const [r] = await pool.query(
      `UPDATE limites_producto_bodega
       SET minimo=:minimo, maximo=:maximo, activo=:activo
       WHERE id_bodega=:id_bodega AND id_producto=:id_producto`,
      { id_bodega: idB, id_producto: idP, minimo: min, maximo: max, activo: isActive }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Limite no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/limites/:id_bodega/:id_producto/deactivate", auth, async (req, res) => {
  try {
    const idB = Number(req.params.id_bodega || 0);
    const idP = Number(req.params.id_producto || 0);
    if (!idB || !idP) return res.status(400).json({ error: "Faltan llaves del limite" });
    const [r] = await pool.query(
      `UPDATE limites_producto_bodega
       SET activo=0
       WHERE id_bodega=:id_bodega AND id_producto=:id_producto`,
      { id_bodega: idB, id_producto: idP }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Limite no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.get("/api/reglas-subcategorias", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT r.id_subcategoria,
            r.max_dias_vida,
            r.dias_alerta_antes,
            r.activo,
            s.nombre_subcategoria,
            c.nombre_categoria
     FROM reglas_subcategoria r
     JOIN subcategorias s ON s.id_subcategoria=r.id_subcategoria
     JOIN categorias c ON c.id_categoria=s.id_categoria
     WHERE (:all=1 OR r.activo=1)
     ORDER BY c.nombre_categoria ASC, s.nombre_subcategoria ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/reglas-subcategorias", auth, async (req, res) => {
  try {
    const { id_subcategoria, max_dias_vida = 0, dias_alerta_antes = 0, activo = 1 } = req.body || {};
    const idSub = Number(id_subcategoria || 0);
    const max = Math.max(0, Number(max_dias_vida || 0));
    const alert = Math.max(0, Number(dias_alerta_antes || 0));
    const isActive = Number(activo) ? 1 : 0;
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });

    await pool.query(
      `INSERT INTO reglas_subcategoria (id_subcategoria, max_dias_vida, dias_alerta_antes, activo)
       VALUES (:id_subcategoria, :max_dias_vida, :dias_alerta_antes, :activo)
       ON DUPLICATE KEY UPDATE
         max_dias_vida=VALUES(max_dias_vida),
         dias_alerta_antes=VALUES(dias_alerta_antes),
         activo=VALUES(activo)`,
      { id_subcategoria: idSub, max_dias_vida: max, dias_alerta_antes: alert, activo: isActive }
    );
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/reglas-subcategorias/:id_subcategoria", auth, async (req, res) => {
  try {
    const idSub = Number(req.params.id_subcategoria || 0);
    const max = Math.max(0, Number(req.body?.max_dias_vida || 0));
    const alert = Math.max(0, Number(req.body?.dias_alerta_antes || 0));
    const isActive = Number(req.body?.activo) ? 1 : 0;
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE reglas_subcategoria
       SET max_dias_vida=:max_dias_vida, dias_alerta_antes=:dias_alerta_antes, activo=:activo
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria: idSub, max_dias_vida: max, dias_alerta_antes: alert, activo: isActive }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Regla no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/reglas-subcategorias/:id_subcategoria/deactivate", auth, async (req, res) => {
  try {
    const idSub = Number(req.params.id_subcategoria || 0);
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE reglas_subcategoria
       SET activo=0
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria: idSub }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Regla no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   PROVEEDORES
========================= */
router.get("/api/proveedores", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT id_proveedor, nombre_proveedor, telefono, direccion, activo
     FROM proveedores
     WHERE (:all=1 OR activo=1)
     ORDER BY nombre_proveedor ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/proveedores", auth, async (req, res) => {
  try {
    const nombre_proveedor = String(req.body?.nombre_proveedor || "").trim();
    const telefonoRaw = String(req.body?.telefono || "").trim();
    const direccionRaw = String(req.body?.direccion || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;

    if (!nombre_proveedor) return res.status(400).json({ error: "Falta nombre de proveedor" });

    const [r] = await pool.query(
      `INSERT INTO proveedores (nombre_proveedor, telefono, direccion, activo)
       VALUES (:nombre_proveedor, :telefono, :direccion, :activo)`,
      {
        nombre_proveedor,
        telefono: telefonoRaw || null,
        direccion: direccionRaw || null,
        activo,
      }
    );
    res.json({ ok: true, id_proveedor: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El proveedor ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/proveedores/:id_proveedor", auth, async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    const rawNombre = req.body?.nombre_proveedor;
    const nombre_proveedor = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const telefono =
      typeof req.body?.telefono === "undefined" || req.body?.telefono === null
        ? null
        : String(req.body.telefono || "").trim();
    const direccion =
      typeof req.body?.direccion === "undefined" || req.body?.direccion === null
        ? null
        : String(req.body.direccion || "").trim();
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    if (nombre_proveedor !== null && !nombre_proveedor) {
      return res.status(400).json({ error: "Falta nombre de proveedor" });
    }
    if (nombre_proveedor === null && telefono === null && direccion === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE proveedores
       SET nombre_proveedor=COALESCE(:nombre_proveedor, nombre_proveedor),
           telefono=CASE WHEN :telefono IS NULL THEN telefono ELSE :telefono END,
           direccion=CASE WHEN :direccion IS NULL THEN direccion ELSE :direccion END,
           activo=COALESCE(:activo, activo)
       WHERE id_proveedor=:id_proveedor`,
      {
        id_proveedor,
        nombre_proveedor,
        telefono,
        direccion,
        activo,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El proveedor ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/proveedores/:id_proveedor/deactivate", auth, async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    const [r] = await pool.query(
      `UPDATE proveedores
       SET activo=0
       WHERE id_proveedor=:id_proveedor`,
      { id_proveedor }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   MOTIVOS (LISTA)
========================= */
router.get("/api/motivos", auth, async (req, res) => {
  const tipo = String(req.query.tipo || "").toUpperCase();
  const all = String(req.query.all || "") === "1";
  const whereTipo = tipo ? "AND tipo_movimiento=:tipo" : "";
  const [rows] = await pool.query(
    `SELECT id_motivo, nombre_motivo, tipo_movimiento, signo_cantidad, activo
     FROM motivos_movimiento
     WHERE (:all=1 OR activo=1)
     ${whereTipo}
     ORDER BY nombre_motivo ASC`,
    tipo ? { tipo, all: all ? 1 : 0 } : { all: all ? 1 : 0 }
  );
  res.json(rows);
});

router.post("/api/motivos", auth, async (req, res) => {
  try {
    const nombre_motivo = String(req.body?.nombre_motivo || "").trim();
    const tipo_movimiento = String(req.body?.tipo_movimiento || "").trim().toUpperCase();
    const activo = Number(req.body?.activo) ? 1 : 0;
    const rawSigno = Number(req.body?.signo_cantidad);
    if (!nombre_motivo) return res.status(400).json({ error: "Falta nombre de motivo" });
    if (!["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) {
      return res.status(400).json({ error: "Tipo de movimiento invalido" });
    }
    const signo_cantidad = rawSigno === -1 ? -1 : 1;

    const [r] = await pool.query(
      `INSERT INTO motivos_movimiento (nombre_motivo, tipo_movimiento, signo_cantidad, activo)
       VALUES (:nombre_motivo, :tipo_movimiento, :signo_cantidad, :activo)`,
      { nombre_motivo, tipo_movimiento, signo_cantidad, activo }
    );
    res.json({ ok: true, id_motivo: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El motivo ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/motivos/:id_motivo", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_motivo = Number(req.params.id_motivo || 0);
    if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });

    const rawNombre = req.body?.nombre_motivo;
    const nombre_motivo = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const tipo_movimiento =
      typeof req.body?.tipo_movimiento === "string" && req.body.tipo_movimiento.trim()
        ? String(req.body.tipo_movimiento || "").trim().toUpperCase()
        : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;
    const signo_cantidad =
      typeof req.body?.signo_cantidad === "undefined" || req.body?.signo_cantidad === null
        ? null
        : Number(req.body.signo_cantidad) === -1
          ? -1
          : 1;

    if (nombre_motivo !== null && !nombre_motivo) return res.status(400).json({ error: "Falta nombre de motivo" });
    if (tipo_movimiento && !["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) {
      return res.status(400).json({ error: "Tipo de movimiento invalido" });
    }
    if (nombre_motivo === null && tipo_movimiento === null && activo === null && signo_cantidad === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }
    if (activo === 0) {
      const chk = await ensureCatalogCanDeactivate(conn, { entity: "MOTIVO", id: id_motivo });
      if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    }

    const [r] = await conn.query(
      `UPDATE motivos_movimiento
       SET nombre_motivo=COALESCE(:nombre_motivo, nombre_motivo),
           tipo_movimiento=COALESCE(:tipo_movimiento, tipo_movimiento),
           signo_cantidad=COALESCE(:signo_cantidad, signo_cantidad),
           activo=COALESCE(:activo, activo)
       WHERE id_motivo=:id_motivo`,
      { id_motivo, nombre_motivo, tipo_movimiento, signo_cantidad, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Motivo no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El motivo ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

router.post("/api/motivos/:id_motivo/deactivate", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_motivo = Number(req.params.id_motivo || 0);
    if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });
    const chk = await ensureCatalogCanDeactivate(conn, { entity: "MOTIVO", id: id_motivo });
    if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    const [r] = await conn.query(
      `UPDATE motivos_movimiento
       SET activo=0
       WHERE id_motivo=:id_motivo`,
      { id_motivo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Motivo no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   STOCK ACTUAL POR PRODUCTO
========================= */
router.get("/api/productos/:id/stock", auth, async (req, res) => {
  const id_producto = Number(req.params.id);
  const id_bodega = Number(req.query.warehouse || req.user.id_warehouse || 0);
  if (!id_producto) return res.status(400).json({ error: "Falta producto" });
  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  if (!(await isProductVisibleInWarehouse(pool, id_producto, id_bodega))) {
    return res.status(404).json({ error: "Producto no disponible para esa bodega" });
  }

  const [rows] = await pool.query(
    `SELECT stock
     FROM v_stock_resumen
     WHERE id_bodega=:id_bodega AND id_producto=:id_producto
     LIMIT 1`,
    { id_bodega, id_producto }
  );
  const [priceRows] = await pool.query(
    `SELECT k.costo_unitario
     FROM kardex k
     WHERE k.id_bodega=:id_bodega
       AND k.id_producto=:id_producto
       AND k.delta_cantidad > 0
     ORDER BY k.creado_en DESC, k.id_kardex DESC
     LIMIT 1`,
    { id_bodega, id_producto }
  );
  res.json({
    stock: rows[0]?.stock ?? 0,
    precio_sugerido: Number(priceRows[0]?.costo_unitario || 0),
  });
});

export default router;

/* =========================
   BODEGA DEL USUARIO
========================= */
