// server-admin-impresion.js  |  POS 80mm print routes (modular)
import { pool, auth, resolveStockScope, getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml, normalizeWarehouseIdList } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// -------------------------------------------------------
router.get("/api/print/order/:id/pos80", auth, async (req, res) => {
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
      .replace(/\"/g, "&quot;");
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

export default router;
