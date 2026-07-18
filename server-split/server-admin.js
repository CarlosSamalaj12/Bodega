// server-admin.js  |  Admin routes (modular)
import { app, pool, auth, resolveStockScope, requirePermission, isAvatarTableMissingError, getUserPermissionsMap, canManageUserPermissions, userHasPermission, PERM_CATALOG, opsMetrics, normalizeDeviceKey, getSharedDeviceKeys, isValidOrderPin, isValidSupervisorPin, findOrderPinCollision } from '../server-shared.js';
// -------------------------------------------------------
app.get("/api/print/order/:id/pos80", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  const [[oh]] = await pool.query(
    `SELECT p.*, u.nombre_completo AS requester_name, bs.nombre_bodega AS req_wh, bd.nombre_bodega AS from_wh,
            bs.telefono_contacto AS req_wh_phone, bs.direccion_contacto AS req_wh_address,
            bd.telefono_contacto AS from_wh_phone, bd.direccion_contacto AS from_wh_address,
            ua.nombre_completo AS approver_name
     FROM pedido_encabezado p
     JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
     JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
     JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
     LEFT JOIN usuarios ua ON ua.id_usuario=p.aprobado_por
     WHERE p.id_pedido=:id_pedido`,
    { id_pedido }
  );
  if (!oh) return res.status(404).send("Pedido no existe");
  const orderWarehouses = [Number(oh.id_bodega_solicita || 0), Number(oh.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).send("Sin permiso");
    }
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).send("Sin permiso");
  }
  const [lines] = await pool.query(
    `SELECT d.*, pr.nombre_producto
     FROM pedido_detalle d
     JOIN productos pr ON pr.id_producto=d.id_producto
     WHERE d.id_pedido=:id_pedido
     ORDER BY pr.nombre_producto ASC`,
    { id_pedido }
  );

  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const fmtQty = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const fmtDate = (d) => {
    if (!d) return "";
    try {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "";
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      const hh = String(dt.getHours()).padStart(2, "0");
      const mi = String(dt.getMinutes()).padStart(2, "0");
      const ss = String(dt.getSeconds()).padStart(2, "0");
      return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`;
    } catch {
      return "";
    }
  };
  const totalSolicitado = (lines || []).reduce((a, x) => a + Number(x.cantidad_solicitada || 0), 0);
  const totalDespachado = (lines || []).reduce((a, x) => a + Number(x.cantidad_surtida || 0), 0);
  const logoSrc = await getPreferredWarehousePrintLogoDataUri(oh.id_bodega_solicita, oh.id_bodega_surtidor);
  const footerHtml = buildWarehouseFooterHtml(
    { telefono_contacto: oh.req_wh_phone, direccion_contacto: oh.req_wh_address },
    { telefono_contacto: oh.from_wh_phone, direccion_contacto: oh.from_wh_address }
  );

  const html = `
<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Pedido #${id_pedido} - POS 80mm</title>
<style>
  :root{ --paper-width:80mm; }
  *{ box-sizing:border-box; }
  body{
    margin:0;
    background:#eef2f7;
    font-family:Arial,"Helvetica Neue",Helvetica,"Liberation Sans","Noto Sans",sans-serif;
    color:#0f172a;
  }
  .toolbar{
    position:sticky;
    top:0;
    z-index:5;
    background:#0f172a;
    color:#fff;
    padding:8px 10px;
    display:flex;
    justify-content:center;
    gap:8px;
  }
  .toolbar button{
    border:1px solid #334155;
    background:#1e293b;
    color:#fff;
    border-radius:8px;
    padding:6px 10px;
    font-size:14px;
    cursor:pointer;
  }
  .paper{
    width:var(--paper-width);
    margin:14px auto;
    background:#fff;
    border:1px solid #dbe2ea;
    border-radius:8px;
    padding:8px 8px 10px;
    box-shadow:0 10px 28px rgba(2,6,23,.16);
    font-size:13px;
    line-height:1.35;
      font-variant-numeric:tabular-nums;
  }
  .center{ text-align:center; }
  .logoWrap{
    width:52mm;
    height:18mm;
    margin:0 auto 3px;
    display:flex;
    align-items:center;
    justify-content:center;
  }
  .logo{
    max-width:52mm;
    max-height:18mm;
    width:auto;
    height:auto;
    display:block;
    object-fit:contain;
  }
  .sep{
    border-top:1px dashed #334155;
    margin:6px 0;
  }
  .row{
    display:flex;
    justify-content:space-between;
    gap:6px;
  }
  .muted{ color:#475569; }  .tableHead{ padding:0 2px 5px; border-bottom:2px solid #475569; margin-bottom:5px; }
  .line{ margin:7px 0; padding:7px 6px; border:2px solid #64748b; border-left:4px solid #0f172a; border-radius:4px; font-size:14px; }
  .lineMain{ display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .productName{ flex:1; font-weight:700; line-height:1.25; word-break:break-word; }
  .qtyWrap{ min-width:22mm; padding-left:6px; padding-right:4.2mm; border-left:2px dashed #64748b; text-align:right; margin-right:0; }
  .qtyLabel{ color:#0f172a; font-size:12px; line-height:1.15; font-weight:800; letter-spacing:.1px; }
  .qtyValue{ font-size:16px; font-weight:900; line-height:1.15; color:#000; }
  .qtyNum{ font-size:16px; font-weight:900; line-height:1.1; color:#000; }
  .lineNote{ margin-top:5px; padding-top:4px; border-top:2px dashed #94a3b8; color:#334155; font-size:12px; white-space:pre-wrap; }
  .n{ text-align:right; white-space:nowrap; padding-right:0; }
  .tableHead .n{ color:#0f172a; font-weight:900; padding-right:4.2mm; }
  .sign{ margin-top:36px; text-align:center; color:#334155; font-size:12px; }
  .signLine{ width:85%; margin:0 auto 6px; border-top:1px solid #64748b; }
  .foot{
    margin-top:8px;
    text-align:center;
    color:#334155;
    font-size:12px;
  }
  @media print{
    @page{ size:80mm auto; margin:2mm; }
    body{ background:#fff; }
    .toolbar{ display:none !important; }
    .paper{
      width:auto;
      margin:0;
      border:0;
      border-radius:0;
      box-shadow:none;
      padding:0 2.8mm 0 0.8mm;
      font-size:12px;
    }
  }
</style>
</head><body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Imprimir</button>
    <button type="button" onclick="window.close()">Cerrar</button>
  </div>

  <div class="paper">
    <div class="center">
      <div class="logoWrap">
        <img class="logo" src="${logoSrc}" alt="Hotel Jardines del Lago" />
      </div>
      <div class="muted">Pedido #${esc(id_pedido)}</div>
    </div>
    <div class="sep"></div>

    <div><b>Solicita:</b> ${esc(oh.requester_name || "")}</div>
    <div><b>Bodega solicita:</b> ${esc(oh.req_wh || "")}</div>
    <div><b>Bodega surtidor:</b> ${esc(oh.from_wh || "")}</div>
    <div><b>Fecha:</b> ${esc(fmtDate(oh.creado_en))}</div>
    <div><b>Estado:</b> ${esc(oh.estado || "")}</div>
    ${oh.observaciones ? `<div><b>Notas:</b> ${esc(oh.observaciones)}</div>` : ``}

    <div class="sep"></div>
    <div class="row muted tableHead"><div>Producto</div><div class="n">Sol/Desp</div></div>
    ${(lines || [])
      .map(
        (x) => `
      <div class="line">
        <div class="lineMain">
          <div class="productName">${esc(x.nombre_producto || "")}</div>
          <div class="qtyWrap">
            <div class="qtyLabel">Sol: <b>${esc(fmtQty(x.cantidad_solicitada))}</b></div>
            <div class="qtyLabel">Desp:</div>
            <div class="qtyValue">${esc(fmtQty(x.cantidad_surtida))}</div>
          </div>
        </div>
        ${x.observacion_producto ? `<div class="lineNote">${esc(x.observacion_producto)}</div>` : ``}
      </div>`
      )
      .join("")}<div class="sep"></div>
    <div class="row"><div><b>Total solicitado</b></div><div class="n"><b>${esc(fmtQty(totalSolicitado))}</b></div></div>
    <div class="row"><div><b>Total despachado</b></div><div class="n"><b>${esc(fmtQty(totalDespachado))}</b></div></div>
    <div class="sign">
      <div class="signLine"></div>
      <div>Firma Encargado de Despacho</div>
    </div>
    <div class="foot">
      ${footerHtml ? `${footerHtml}<br/>` : ``}
      Generado: ${esc(fmtDate(new Date().toISOString()))}
    </div>
  </div>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/* =========================
   ROLES (LISTA)
========================= */
app.get("/api/roles", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_rol AS id_role, nombre_rol AS role_name
     FROM roles
     WHERE activo=1
     ORDER BY nombre_rol ASC`
  );
  res.json(rows);
});

/* =========================
   USUARIOS (CREAR)
========================= */
app.post("/api/usuarios", auth, async (req, res) => {
  try {
    const {
      username,
      full_name,
      password,
      order_pin = null,
      can_supervisor = 0,
      no_auto_logout = 0,
      id_role,
      id_warehouse = null,
      active = 1,
      avatar_data = null,
    } = req.body || {};

    const user = String(username || "").trim();
    const name = String(full_name || "").trim();
    const pass = String(password || "");
    const pinPedido = String(order_pin || "").trim();
    const canSupervisor = Number(can_supervisor) ? 1 : 0;
    const roleId = Number(id_role || 0);
    const warehouseId = Number(id_warehouse || 0) || null;
    const isActive = Number(active) ? 1 : 0;
    const noAutoLogout = Number(no_auto_logout) ? 1 : 0;
    const avatarData = normalizeAvatarData(avatar_data);

    if (!user) return res.status(400).json({ error: "Falta usuario" });
    if (!name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });
    if (pinPedido && !isValidOrderPin(pinPedido)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });
    if (!roleId) return res.status(400).json({ error: "Falta rol" });
    if (pinPedido) {
      const duplicatedPinOwner = await findOrderPinCollision(pinPedido, 0, pool, false);
      if (duplicatedPinOwner) {
        return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
      }
    }

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `INSERT INTO usuarios
       (usuario, nombre_completo, contrasena_hash, id_rol, id_bodega, activo, no_auto_logout)
       VALUES (:usuario, :nombre_completo, :contrasena_hash, :id_rol, :id_bodega, :activo, :no_auto_logout)`,
      {
        usuario: user,
        nombre_completo: name,
        contrasena_hash: passHash,
        id_rol: roleId,
        id_bodega: warehouseId,
        activo: isActive,
        no_auto_logout: noAutoLogout,
      }
    );

    if (avatarData) {
      try {
        await pool.query(
          `INSERT INTO usuario_avatar (id_usuario, avatar_data)
           VALUES (:id_usuario, :avatar_data)
           ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
          { id_usuario: r.insertId, avatar_data: avatarData }
        );
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    if (pinPedido) {
      const pinHash = await bcrypt.hash(pinPedido, 10);
      await pool.query(
        `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
         VALUES (:id_usuario, :pin_hash)
         ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
        { id_usuario: r.insertId, pin_hash: pinHash }
      );
    }
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: r.insertId, activo: canSupervisor }
    );

    res.json({ ok: true, id_user: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   BODEGAS (EDITAR)
========================= */
app.patch("/api/bodegas/:id", auth, async (req, res) => {
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

/* =========================
   USUARIOS (RESET PASSWORD)
========================= */
app.post("/api/usuarios/:id/reset-password", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pass = String(req.body?.password || "");
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `UPDATE usuarios
       SET contrasena_hash=:contrasena_hash
       WHERE id_usuario=:id_usuario`,
      { contrasena_hash: passHash, id_usuario: id_user }
    );

    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/usuarios/:id/reset-order-pin", auth, requirePermission("action.manage_permissions", "restablecer PIN de pedidos"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pin = String(req.body?.pin || "").trim();
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!isValidOrderPin(pin)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });

    const [usr] = await pool.query(
      `SELECT id_usuario
       FROM usuarios
       WHERE id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: id_user }
    );
    if (!usr.length) return res.status(404).json({ error: "Usuario no existe" });
    const duplicatedPinOwner = await findOrderPinCollision(pin, id_user, pool, false);
    if (duplicatedPinOwner) {
      return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query(
      `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
       VALUES (:id_usuario, :pin_hash)
       ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
      { id_usuario: id_user, pin_hash: pinHash }
    );

    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (EDITAR)
========================= */
app.patch("/api/usuarios/:id", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const username = String(req.body?.username || "").trim();
    const full_name = String(req.body?.full_name || "").trim();
    const id_role = Number(req.body?.id_role || 0);
    const id_warehouse = Number(req.body?.id_warehouse || 0) || null;
    const active = Number(req.body?.active) ? 1 : 0;
    const no_auto_logout = Number(req.body?.no_auto_logout) ? 1 : 0;
    const can_supervisor = Number(req.body?.can_supervisor) ? 1 : 0;
    const hasAvatarField = Object.prototype.hasOwnProperty.call(req.body || {}, "avatar_data");
    const avatarData = normalizeAvatarData(req.body?.avatar_data);

    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!username) return res.status(400).json({ error: "Falta usuario" });
    if (!full_name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!id_role) return res.status(400).json({ error: "Falta rol" });

    const [r] = await pool.query(
      `UPDATE usuarios
       SET usuario=:usuario,
           nombre_completo=:nombre_completo,
           id_rol=:id_rol,
           id_bodega=:id_bodega,
           activo=:activo,
           no_auto_logout=:no_auto_logout
       WHERE id_usuario=:id_usuario`,
      {
        usuario: username,
        nombre_completo: full_name,
        id_rol: id_role,
        id_bodega: id_warehouse,
        activo: active,
        no_auto_logout,
        id_usuario: id_user,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: id_user, activo: can_supervisor }
    );

    if (hasAvatarField) {
      try {
        if (avatarData) {
          await pool.query(
            `INSERT INTO usuario_avatar (id_usuario, avatar_data)
             VALUES (:id_usuario, :avatar_data)
             ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
            { id_usuario: id_user, avatar_data: avatarData }
          );
        } else {
          await pool.query(`DELETE FROM usuario_avatar WHERE id_usuario=:id_usuario`, { id_usuario: id_user });
        }
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (DESACTIVAR)
========================= */
app.post("/api/usuarios/:id/deactivate", auth, async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (Number(req.user?.id_user || 0) === id_user) {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
    }
    const [r] = await pool.query(
      `UPDATE usuarios
       SET activo=0
       WHERE id_usuario=:id_usuario`,
      { id_usuario: id_user }
    );
    if (!r.affectedRows) {
      const [chk] = await pool.query(
        `SELECT id_usuario FROM usuarios WHERE id_usuario=:id_usuario LIMIT 1`,
        { id_usuario: id_user }
      );
      if (!chk.length) return res.status(404).json({ error: "Usuario no existe" });
    }
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (LISTA)
========================= */
app.get("/api/usuarios", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  let rows = [];
  try {
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              ua.avatar_data AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  } catch (e) {
    if (!isAvatarTableMissingError(e)) throw e;
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              '' AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  }
  res.json(rows);
});

app.get("/api/permisos/catalogo", auth, async (req, res) => {
  res.json(PERM_CATALOG);
});

app.get("/api/me/permisos", auth, async (req, res) => {
  try {
    const id_usuario = Number(req.user?.id_user || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    const scope = await resolveStockScope(req.user);
    res.json({
      permisos: map,
      catalogo: PERM_CATALOG,
      is_admin_role: Number(scope?.is_admin_role ? 1 : 0),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/usuarios/:id/permisos", auth, async (req, res) => {
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    res.json({ id_usuario, permisos: map, catalogo: PERM_CATALOG });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/usuarios/:id/bodegas-acceso", auth, async (req, res) => {
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });

    const [rows] = await pool.query(
      `SELECT uba.id_bodega, b.nombre_bodega
       FROM usuario_bodegas_acceso uba
       JOIN bodegas b ON b.id_bodega=uba.id_bodega
       WHERE uba.id_usuario=:id_usuario
       ORDER BY b.nombre_bodega ASC, uba.id_bodega ASC`,
      { id_usuario }
    );
    res.json({
      id_usuario,
      bodegas: rows || [],
      ids: normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega)),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/usuarios/:id/bodegas-acceso", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const ids = normalizeWarehouseIdList(req.body?.id_bodegas || []);

    const [[userRow]] = await conn.query(
      `SELECT u.id_usuario, r.nombre_rol
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario }
    );
    if (!userRow) return res.status(404).json({ error: "Usuario no existe" });

    const roleName = String(userRow?.nombre_rol || "").trim().toUpperCase();
    const isReportRole = roleName.includes("REPORTE");
    const isAdminRole = roleName.includes("ADMIN");
    if (!isReportRole || isAdminRole) {
      return res.status(400).json({ error: "Solo usuarios de reportes no administradores pueden tener este filtro" });
    }

    if (ids.length) {
      const inClause = buildNamedInClause(ids, "uba");
      const [validRows] = await conn.query(
        `SELECT id_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})`,
        inClause.params
      );
      const validIds = normalizeWarehouseIdList((validRows || []).map((r) => r.id_bodega));
      if (validIds.length !== ids.length) {
        return res.status(400).json({ error: "Una o mas bodegas no son validas o no estan activas" });
      }
    }

    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM usuario_bodegas_acceso
       WHERE id_usuario=:id_usuario`,
      { id_usuario }
    );
    for (const id_bodega of ids) {
      await conn.query(
        `INSERT INTO usuario_bodegas_acceso (id_usuario, id_bodega)
         VALUES (:id_usuario, :id_bodega)`,
        { id_usuario, id_bodega }
      );
    }
    await conn.commit();
    res.json({ ok: true, id_usuario, id_bodegas: ids });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.put("/api/usuarios/:id/permisos", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const input = req.body?.permisos || {};
    const map = permissionDefaults();

    if (Array.isArray(input)) {
      for (const it of input) {
        const k = String(it?.permiso || "");
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        map[k] = Number(it?.activo) ? 1 : 0;
      }
    } else if (input && typeof input === "object") {
      for (const k of Object.keys(map)) {
        if (Object.prototype.hasOwnProperty.call(input, k)) {
          map[k] = Number(input[k]) ? 1 : 0;
        }
      }
    } else {
      return res.status(400).json({ error: "Formato de permisos invalido" });
    }

    await conn.beginTransaction();
    for (const k of Object.keys(map)) {
      await conn.query(
        `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
         VALUES (:id_usuario, :permiso, :activo)
         ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
        { id_usuario, permiso: k, activo: map[k] }
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/ops/metrics", auth, requirePermission("action.manage_permissions", "ver metricas operativas"), async (req, res) => {
  try {
    const alerts = buildOperationalAlerts();
    const avgApiLatency =
      opsMetrics.api.total > 0 ? Number((opsMetrics.api.total_latency_ms / opsMetrics.api.total).toFixed(2)) : 0;
    const avgDbLatency =
      opsMetrics.db.total_queries > 0 ? Number((opsMetrics.db.total_latency_ms / opsMetrics.db.total_queries).toFixed(2)) : 0;
    res.json({
      ok: true,
      started_at: opsMetrics.started_at,
      api: {
        total: opsMetrics.api.total,
        errors_4xx: opsMetrics.api.errors_4xx,
        errors_5xx: opsMetrics.api.errors_5xx,
        avg_latency_ms: avgApiLatency,
        max_latency_ms: opsMetrics.api.max_latency_ms,
      },
      db: {
        total_queries: opsMetrics.db.total_queries,
        failures: opsMetrics.db.failures,
        avg_latency_ms: avgDbLatency,
        max_latency_ms: opsMetrics.db.max_latency_ms,
        recent_failures_5m: opsMetrics.db.recent_failures.length,
        last_error: opsMetrics.db.last_error,
      },
      pin_failures: {
        order_15m: opsMetrics.pin_failures.order.length,
        supervisor_15m: opsMetrics.pin_failures.supervisor.length,
      },
      sensitive_actions: opsMetrics.sensitive_actions,
      alerts,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/ops/backup/status", auth, requirePermission("action.manage_permissions", "ver estado de backups"), async (req, res) => {
  try {
    const [[lastBackup]] = await pool.query(
      `SELECT id_backup, backup_date, trigger_type, status, file_path, bytes_written, creado_en, finalizado_en, error_message
       FROM backup_audit
       ORDER BY id_backup DESC
       LIMIT 1`
    );
    const [[lastRecovery]] = await pool.query(
      `SELECT id_test, trigger_type, status, source_file, creado_en, finalizado_en, error_message
       FROM recovery_test_audit
       ORDER BY id_test DESC
       LIMIT 1`
    );
    res.json({
      ok: true,
      backup_auto_enabled: OPS_BACKUP_AUTO_ENABLED,
      backup_interval_ms: OPS_BACKUP_INTERVAL_MS,
      backup_dir: OPS_BACKUP_BASE_DIR,
      last_backup: lastBackup || null,
      last_recovery_test: lastRecovery || null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/ops/backup/run", auth, requirePermission("action.manage_permissions", "ejecutar backup"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await createLogicalBackup({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo generar backup" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/ops/backup/recovery-test", auth, requirePermission("action.manage_permissions", "ejecutar prueba de recovery"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await runRecoveryDryTest({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo ejecutar prueba de recovery" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const db_ping_ms = Date.now() - t0;
    const alerts = buildOperationalAlerts();
    res.json({ ok: true, db_ping_ms, alerts });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e.message || e),
      alerts: buildOperationalAlerts(),
    });
  }
});


