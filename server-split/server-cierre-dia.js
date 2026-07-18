// server-cierre-dia.js  |  Cierre dia routes (modular)
import { pool, auth, resolveStockScope, getScopedWarehouseFilter, buildTokenizedLikeFilter, getWarehouseLogoDataUri } from '../server-shared.js';
import { Router } from 'express';
const router = Router();
// -------------------------------------------------------
router.get("/api/print/corte-diario", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).send("Usuario sin bodega");
  if (!scope.can_view_existencias) return res.status(403).send("Sin permiso");

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse, { fallbackToDefault: true });
  if (warehouseScope.denied || !warehouseScope.selected) return res.status(403).send("Sin permiso");
  const id_bodega = warehouseScope.selected;
  const printFormat = String(req.query.format || "carta").trim().toLowerCase() === "pos80" ? "pos80" : "carta";
  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "pcdq");
  const show_all = String(req.query.show_all || "") === "1" ? 1 : 0;
  const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 2000)));

  const [[bod]] = await pool.query(
    `SELECT nombre_bodega
     FROM bodegas
     WHERE id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );

  const [rows] = await pool.query(
    `SELECT p.nombre_producto,
            p.sku,
            COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
            COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
            COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
            COALESCE(SUM(k.delta_cantidad), 0) AS existencia_actual
     FROM productos p
     LEFT JOIN (
       SELECT k.*
       FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento AND me.estado<>'ANULADO'
     ) k
       ON k.id_producto=p.id_producto
      AND k.id_bodega=:id_bodega
     WHERE p.activo=1
       AND ${qf.clause}
     GROUP BY p.id_producto, p.nombre_producto, p.sku
     HAVING (:show_all=1
             OR ABS(existencia_ayer) > 0
             OR ABS(entradas_hoy) > 0
             OR ABS(salidas_hoy) > 0
             OR ABS(existencia_actual) > 0)
     ORDER BY p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, show_all, ...qf.params }
  );

  const fmtDate = (d) => {
    if (!d) return "";
    try {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "";
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    } catch {
      return "";
    }
  };
  const fmtQty = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const totalAyer = rows.reduce((a, x) => a + Number(x.existencia_ayer || 0), 0);
  const totalEnt = rows.reduce((a, x) => a + Number(x.entradas_hoy || 0), 0);
  const totalSal = rows.reduce((a, x) => a + Number(x.salidas_hoy || 0), 0);
  const totalAct = rows.reduce((a, x) => a + Number(x.existencia_actual || 0), 0);
  const logoSrc = await getWarehouseLogoDataUri(id_bodega);
  const isPos80 = printFormat === "pos80";
  const summaryHtml = isPos80
    ? `
    <div class="ticketSummary">
      <div class="ticketSummaryRow"><span>Existencia ayer</span><b>${fmtQty(totalAyer)}</b></div>
      <div class="ticketSummaryRow"><span>Entradas hoy</span><b>${fmtQty(totalEnt)}</b></div>
      <div class="ticketSummaryRow"><span>Salidas hoy</span><b>${fmtQty(totalSal)}</b></div>
      <div class="ticketSummaryRow"><span>Existencia actual</span><b>${fmtQty(totalAct)}</b></div>
    </div>
  `
    : `
    <div class="resume">
      <span>Existencia ayer: <b>${fmtQty(totalAyer)}</b></span>
      <span>Entradas hoy: <b>${fmtQty(totalEnt)}</b></span>
      <span>Salidas hoy: <b>${fmtQty(totalSal)}</b></span>
      <span>Existencia actual: <b>${fmtQty(totalAct)}</b></span>
    </div>
  `;
  const rowsHtml = isPos80
    ? `
      <div class="ticketSectionTitle">Detalle de productos</div>
      ${rows
        .map(
          (x) => `
        <div class="ticketItem">
          <div class="ticketItemName">${x.nombre_producto || ""}</div>
          <div class="ticketItemSku">SKU: ${x.sku || ""}</div>
          <div class="ticketQtyGrid">
            <div class="ticketMetric"><span>Ayer</span><b>${fmtQty(x.existencia_ayer)}</b></div>
            <div class="ticketMetric"><span>Entradas</span><b>${fmtQty(x.entradas_hoy)}</b></div>
            <div class="ticketMetric"><span>Salidas</span><b>${fmtQty(x.salidas_hoy)}</b></div>
            <div class="ticketMetric"><span>Actual</span><b>${fmtQty(x.existencia_actual)}</b></div>
          </div>
        </div>
      `
        )
        .join("")}
    `
    : `
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>SKU</th>
            <th>Existencia ayer</th>
            <th>Entradas hoy</th>
            <th>Salidas hoy</th>
            <th>Existencia actual</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (x) => `
            <tr>
              <td>${x.nombre_producto || ""}</td>
              <td>${x.sku || ""}</td>
              <td class="n">${fmtQty(x.existencia_ayer)}</td>
              <td class="n">${fmtQty(x.entradas_hoy)}</td>
              <td class="n">${fmtQty(x.salidas_hoy)}</td>
              <td class="n">${fmtQty(x.existencia_actual)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;

  const html = `
<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Corte diario</title>
<style>
  *{box-sizing:border-box;}
  body{
    font-family: Arial, sans-serif;
    padding:${isPos80 ? "4px" : "16px"};
    margin:0;
    color:#111;
    background:${isPos80 ? "#fff" : "#fff"};
    font-variant-numeric:tabular-nums;
  }
  .page{width:${isPos80 ? "76mm" : "100%"}; margin:0 auto;}
  .headLogo{display:block; margin:0 auto ${isPos80 ? "6px" : "10px"}; max-height:${isPos80 ? "15mm" : "64px"}; width:auto; max-width:100%; object-fit:contain;}
  .headTitle{margin:4px 0 0; text-align:center; font-size:${isPos80 ? "15px" : "22px"}; line-height:1.15;}
  .muted{color:#666; font-size:${isPos80 ? "9px" : "12px"}; text-align:center; margin-top:4px; line-height:1.25;}
  table{width:100%; border-collapse:collapse; margin-top:12px;}
  th,td{border:1px solid #ddd; padding:${isPos80 ? "3px 4px" : "4px 6px"}; font-size:${isPos80 ? "9px" : "11px"}; line-height:1.2; vertical-align:top;}
  th{background:#f5f5f5;}
  td.n{text-align:right;}
  .resume{margin-top:8px; display:flex; gap:${isPos80 ? "4px" : "10px"}; flex-wrap:wrap; justify-content:center;}
  .resume span{font-size:${isPos80 ? "9px" : "12px"}; border:1px solid #ddd; border-radius:${isPos80 ? "8px" : "999px"}; padding:${isPos80 ? "3px 6px" : "4px 10px"};}
  .ticketSummary{
    margin-top:8px;
    border-top:1px dashed #888;
    border-bottom:1px dashed #888;
    padding:6px 0;
  }
  .ticketSummaryRow{
    display:flex;
    justify-content:space-between;
    gap:8px;
    font-size:10px;
    line-height:1.35;
    padding:1px 0;
  }
  .ticketSummaryRow b{font-size:10.5px;}
  .ticketSectionTitle{
    margin-top:8px;
    padding:4px 0 5px;
    border-bottom:1px solid #222;
    font-size:10px;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:.4px;
  }
  .ticketItem{
    border-bottom:1px dashed #b9b9b9;
    padding:6px 0;
    page-break-inside:avoid;
  }
  .ticketItemName{
    font-size:10.5px;
    font-weight:700;
    line-height:1.25;
    word-break:break-word;
    margin-bottom:2px;
  }
  .ticketItemSku{
    font-size:8.5px;
    color:#555;
    margin-bottom:5px;
    word-break:break-all;
  }
  .ticketQtyGrid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:4px 8px;
  }
  .ticketMetric{
    display:flex;
    justify-content:space-between;
    gap:6px;
    min-width:0;
    font-size:9px;
    line-height:1.25;
  }
  .ticketMetric span{color:#555;}
  .ticketMetric b{
    font-size:9.5px;
    color:#000;
    white-space:nowrap;
  }
  @media print{
    @page{ size: ${isPos80 ? "80mm auto" : "letter portrait"}; margin: ${isPos80 ? "2mm" : "10mm"}; }
    body{padding:0;}
    .page{width:auto;}
  }
</style>
</head><body>
  <div class="page">
    <img class="headLogo" src="${logoSrc}" alt="Hotel Jardines del Lago" />
    <h2 class="headTitle">Corte diario de inventario</h2>
    <div class="muted">Formato: ${isPos80 ? "POS 80 mm" : "Carta"}</div>
    <div class="muted">Bodega: ${bod?.nombre_bodega || `#${id_bodega}`}</div>
    <div class="muted">Ayer: ${fmtDate(new Date(Date.now() - 24 * 60 * 60 * 1000))} | Hoy: ${fmtDate(new Date())}</div>
    ${summaryHtml}
    ${rowsHtml}
  </div>
  <script>window.print()</script>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});


export default router;
