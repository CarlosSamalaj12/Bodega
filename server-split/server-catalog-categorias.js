// server-catalog-categorias.js  |  Categories and subcategories CRUD routes
import { pool, auth } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

router.get("/api/categories", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM categories ORDER BY category_name ASC`
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
      `UPDATE categorias SET activo=0 WHERE id_categoria=:id_categoria`,
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
      `UPDATE subcategorias SET activo=0 WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;
