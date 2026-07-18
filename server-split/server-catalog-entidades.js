// server-catalog-entidades.js  |  Catalog entidades CRUD routes (limites, reglas, proveedores, motivos)
import { pool, auth, ensureCatalogCanDeactivate } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

/* =========================
   LIMITES
========================= */
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
       ON DUPLICATE KEY UPDATE minimo=VALUES(minimo), maximo=VALUES(maximo), activo=VALUES(activo)`,
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
      `UPDATE limites_producto_bodega SET minimo=:minimo, maximo=:maximo, activo=:activo WHERE id_bodega=:id_bodega AND id_producto=:id_producto`,
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
    const [r] = await pool.query(`UPDATE limites_producto_bodega SET activo=0 WHERE id_bodega=:id_bodega AND id_producto=:id_producto`, { id_bodega: idB, id_producto: idP });
    if (!r.affectedRows) return res.status(404).json({ error: "Limite no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   REGLAS SUBCATEGORIAS
========================= */
router.get("/api/reglas-subcategorias", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT r.id_subcategoria, r.max_dias_vida, r.dias_alerta_antes, r.activo, s.nombre_subcategoria, c.nombre_categoria
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
       ON DUPLICATE KEY UPDATE max_dias_vida=VALUES(max_dias_vida), dias_alerta_antes=VALUES(dias_alerta_antes), activo=VALUES(activo)`,
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
      `UPDATE reglas_subcategoria SET max_dias_vida=:max_dias_vida, dias_alerta_antes=:dias_alerta_antes, activo=:activo WHERE id_subcategoria=:id_subcategoria`,
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
    const [r] = await pool.query(`UPDATE reglas_subcategoria SET activo=0 WHERE id_subcategoria=:id_subcategoria`, { id_subcategoria: idSub });
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
      { nombre_proveedor, telefono: telefonoRaw || null, direccion: direccionRaw || null, activo }
    );
    res.json({ ok: true, id_proveedor: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "El proveedor ya existe" });
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.patch("/api/proveedores/:id_proveedor", auth, async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    const rawNombre = req.body?.nombre_proveedor;
    const nombre_proveedor = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const telefono = typeof req.body?.telefono === "undefined" || req.body?.telefono === null ? null : String(req.body.telefono || "").trim();
    const direccion = typeof req.body?.direccion === "undefined" || req.body?.direccion === null ? null : String(req.body.direccion || "").trim();
    const activo = typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    if (nombre_proveedor !== null && !nombre_proveedor) return res.status(400).json({ error: "Falta nombre de proveedor" });
    if (nombre_proveedor === null && telefono === null && direccion === null && activo === null) return res.status(400).json({ error: "Sin cambios para actualizar" });

    const [r] = await pool.query(
      `UPDATE proveedores
       SET nombre_proveedor=COALESCE(:nombre_proveedor, nombre_proveedor),
           telefono=CASE WHEN :telefono IS NULL THEN telefono ELSE :telefono END,
           direccion=CASE WHEN :direccion IS NULL THEN direccion ELSE :direccion END,
           activo=COALESCE(:activo, activo)
       WHERE id_proveedor=:id_proveedor`,
      { id_proveedor, nombre_proveedor, telefono, direccion, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "El proveedor ya existe" });
    return res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/proveedores/:id_proveedor/deactivate", auth, async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    const [r] = await pool.query(`UPDATE proveedores SET activo=0 WHERE id_proveedor=:id_proveedor`, { id_proveedor });
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   MOTIVOS
========================= */
router.get("/api/motivos", auth, async (req, res) => {
  const tipo = String(req.query.tipo || "").toUpperCase();
  const all = String(req.query.all || "") === "1";
  const whereTipo = tipo ? "AND tipo_movimiento=:tipo" : "";
  const [rows] = await pool.query(
    `SELECT id_motivo, nombre_motivo, tipo_movimiento, signo_cantidad, activo
     FROM motivos_movimiento
     WHERE (:all=1 OR activo=1) ${whereTipo}
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
    if (!["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) return res.status(400).json({ error: "Tipo de movimiento invalido" });
    const signo_cantidad = rawSigno === -1 ? -1 : 1;

    const [r] = await pool.query(
      `INSERT INTO motivos_movimiento (nombre_motivo, tipo_movimiento, signo_cantidad, activo)
       VALUES (:nombre_motivo, :tipo_movimiento, :signo_cantidad, :activo)`,
      { nombre_motivo, tipo_movimiento, signo_cantidad, activo }
    );
    res.json({ ok: true, id_motivo: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "El motivo ya existe" });
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
    const tipo_movimiento = typeof req.body?.tipo_movimiento === "string" && req.body.tipo_movimiento.trim()
      ? String(req.body.tipo_movimiento || "").trim().toUpperCase() : null;
    const activo = typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;
    const signo_cantidad = typeof req.body?.signo_cantidad === "undefined" || req.body?.signo_cantidad === null ? null : Number(req.body.signo_cantidad) === -1 ? -1 : 1;

    if (nombre_motivo !== null && !nombre_motivo) return res.status(400).json({ error: "Falta nombre de motivo" });
    if (tipo_movimiento && !["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) return res.status(400).json({ error: "Tipo de movimiento invalido" });
    if (nombre_motivo === null && tipo_movimiento === null && activo === null && signo_cantidad === null) return res.status(400).json({ error: "Sin cambios para actualizar" });
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
    if (e && e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "El motivo ya existe" });
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
    const [r] = await conn.query(`UPDATE motivos_movimiento SET activo=0 WHERE id_motivo=:id_motivo`, { id_motivo });
    if (!r.affectedRows) return res.status(404).json({ error: "Motivo no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

export default router;
