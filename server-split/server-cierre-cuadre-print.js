// server-cierre-cuadre-print.js  |  Cuadre caja: impresion (POS 80mm / Carta)
import { pool, auth, requirePermission, getWarehouseLogoDataUri, normalizeCuadrePayload, CUADRE_DENOMINACIONES, CUADRE_DOLAR_DENOM_USD, CUADRE_DOLAR_TIPO_CAMBIO, normalizeYmdInput, ymd, dmy } from '../server-shared.js';
import { Router } from 'express';
import { resolveCuadreScope } from './server-cierre-cuadre-context.js';
const router = Router();
// -------------------------------------------------------
router.all("/api/print/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "imprimir cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    const fechaSource = req.method === "POST" ? (req.body?.fecha || req.query.fecha) : req.query.fecha;
    const fechaRaw = String(fechaSource || "").trim();
    const fecha = normalizeYmdInput(fechaRaw) || ymd(new Date()) || "";
    if (fechaRaw && !fecha) {
      return res.status(400).send("Fecha invalida. Formato esperado: YYYY-MM-DD");
    }

    const warehouseSource = req.method === "POST" ? (req.body?.warehouse || req.query.warehouse) : req.query.warehouse;
    const requested = Number(warehouseSource || 0) || 0;
    const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
    if (!id_bodega) return res.status(400).send("No hay bodega disponible para el usuario");
    if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
      return res.status(403).send("Sin acceso a la bodega solicitada");
    }

    const formatSource = req.method === "POST" ? (req.body?.format || req.query.format) : req.query.format;
    const formatRaw = String(formatSource || "carta").trim().toLowerCase();
    const format = formatRaw === "pos" ? "pos" : "carta";
    const payloadOverrideRaw = req.method === "POST"
      ? String(req.body?.payload_override || "").trim()
      : String(req.query.payload_override || "").trim();

    const [[bod]] = await pool.query(
      `SELECT nombre_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );

    const [[row]] = await pool.query(
      `SELECT id_cuadre,
              sede,
              responsable,
              payload_json,
              total_efectivo,
              total_cobro,
              total_venta_ambiente,
              gran_total_reporte,
              actualizado_en
       FROM cuadre_caja
       WHERE fecha=:fecha
         AND id_bodega=:id_bodega
       LIMIT 1`,
      { fecha, id_bodega }
    );

    let parsedPayload = {};
    if (row?.payload_json) {
      try {
        parsedPayload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        parsedPayload = {};
      }
    }

    let payloadOverride = null;
    if (payloadOverrideRaw) {
      try {
        const parsed = JSON.parse(payloadOverrideRaw);
        if (parsed && typeof parsed === "object") payloadOverride = parsed;
      } catch {}
    }

    const normalized = normalizeCuadrePayload(payloadOverride || parsedPayload, {
      sede: row?.sede || bod?.nombre_bodega || "",
      responsable: row?.responsable || "",
      payload_json: parsedPayload,
    });

    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const fmtMoney = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQty = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

    const p = normalized.payload || {};
    const monedas = p.monedas || {};
    const pagos = p.pagos || {};
    const ventas = p.ventas || {};
    const ventasRows = Array.isArray(p.ventas_rows) && p.ventas_rows.length
      ? p.ventas_rows
      : [
          { ambiente: "Flor de Cafe", monto: Number(ventas.flor_cafe || 0) },
          { ambiente: "Restaurante", monto: Number(ventas.restaurante || 0) },
          { ambiente: "Nilas", monto: Number(ventas.nilas || 0) },
          { ambiente: "ElDeck", monto: Number(ventas.eldeck || 0) },
          { ambiente: "Cactus", monto: Number(ventas.cactus || 0) },
          { ambiente: "Gelato", monto: Number(ventas.gelato || 0) },
          { ambiente: "Jazmin", monto: Number(ventas.jazmin || 0) },
        ];
    const extras = p.extras || {};
    const detalle = Array.isArray(p.detalle) ? p.detalle : [];
    const logoSrc = await getWarehouseLogoDataUri(id_bodega);

    const baseCss = format === "pos"
      ? `
        @page { size: 80mm auto; margin: 2mm; }
        body {
          width: auto;
          margin: 0;
          padding: 0 2.8mm 0 0.8mm;
          font-family: "DejaVu Sans Mono", "Consolas", "Lucida Console", monospace;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.3;
          color: #111;
          -webkit-font-smoothing: none;
          text-rendering: optimizeLegibility;
          box-sizing: border-box;
        }
        h1 { font-size: 15px; margin: 4px 0 5px; text-align: center; letter-spacing: .2px; }
        .meta { text-align: center; font-size: 11px; margin-bottom: 7px; line-height: 1.3; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
        th, td { border-bottom: 1px dashed #bbb; padding: 3px 3px 3px 4px; vertical-align: top; }
        th { text-align: left; font-size: 11px; }
        td.n { text-align: right; white-space: nowrap; padding-right: 1px; }
        .section { margin-top: 8px; font-weight: bold; border-top: 1px solid #000; padding: 4px 0 0 1px; }
        .tot { font-weight: bold; border-top: 1px solid #000; }
        .logo { display:block; margin:0 auto 4px; max-width:48mm; max-height:18mm; }
      `
      : `
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
        h1 { font-size: 20px; margin: 6px 0 2px; text-align: center; }
        .meta { text-align: center; font-size: 12px; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d8d8d8; padding: 5px 6px; vertical-align: top; }
        th { background:#f4f4f4; text-align:left; }
        td.n { text-align: right; white-space: nowrap; }
        .section { margin-top: 12px; font-weight: bold; }
        .tot { font-weight: bold; background:#f9f9f9; }
        .logo { display:block; margin:0 auto 8px; max-width:130px; max-height:56px; }
      `;

    const html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cuadre de caja</title>
  <style>${baseCss}</style>
</head>
<body>
  <img class="logo" src="${logoSrc}" alt="Logo" />
  <h1>Cuadre de Caja</h1>
  <div class="meta">${esc(p.sede || bod?.nombre_bodega || "-")} | Fecha: ${esc(dmy(fecha))} | Responsable: ${esc(p.responsable || "-")}</div>

  <div class="section">Efectivo por denominacion</div>
  <table>
    <thead><tr><th>Cantidad</th><th>Detalle</th><th class="n">Total</th></tr></thead>
    <tbody>
      ${CUADRE_DENOMINACIONES.map((d) => {
        const key = String(d);
        const qty = Number(monedas[key] || 0);
        const line = qty * Number(d);
        return `<tr><td>${fmtQty(qty)}</td><td>Q ${fmtMoney(d)}</td><td class="n">Q ${fmtMoney(line)}</td></tr>`;
      }).join("")}
      <tr><td>${fmtQty(pagos.dolares_cantidad || 0)}</td><td>$ ${fmtMoney(CUADRE_DOLAR_DENOM_USD)} x Q ${fmtMoney(CUADRE_DOLAR_TIPO_CAMBIO)}</td><td class="n">$ ${fmtMoney(pagos.dolares_total || 0)}</td></tr>
      <tr><td colspan="2">Dolares a quetzales</td><td class="n">Q ${fmtMoney(pagos.dolares_quetzales || 0)}</td></tr>
      <tr class="tot"><td colspan="2">Total efectivo</td><td class="n">Q ${fmtMoney(normalized.total_efectivo)}</td></tr>
      <tr><td colspan="2">Visa</td><td class="n">Q ${fmtMoney(pagos.visa || 0)}</td></tr>
      <tr><td colspan="2">Bancos</td><td class="n">Q ${fmtMoney(pagos.bancos || 0)}</td></tr>
      <tr><td colspan="2">CXC Trabajadores</td><td class="n">Q ${fmtMoney(pagos.cxc_trabajadores || 0)}</td></tr>
      <tr><td colspan="2">CXC Habitaciones</td><td class="n">Q ${fmtMoney(pagos.cxc_habitaciones || 0)}</td></tr>
      <tr><td colspan="2">PASE CONSUMIBLE</td><td class="n">Q ${fmtMoney(pagos.pase_consumible || 0)}</td></tr>
      <tr class="tot"><td colspan="2">TOTAL COBRO</td><td class="n">Q ${fmtMoney(normalized.total_cobro)}</td></tr>
    </tbody>
  </table>

  <div class="section">Ventas por ambiente</div>
  <table>
    <tbody>
      ${ventasRows
        .map((r) => `<tr><td>${esc(r.ambiente || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td></tr>`)
        .join("")}
      <tr class="tot"><td>TOTAL VENTA POR AMBIENTE</td><td class="n">Q ${fmtMoney(normalized.total_venta_ambiente)}</td></tr>
      <tr><td>Pedidos Nilas</td><td class="n">Q ${fmtMoney(extras.pedidos_nilas || 0)}</td></tr>
      <tr><td>Cortesias</td><td class="n">Q ${fmtMoney(extras.cortesias || 0)}</td></tr>
      <tr class="tot"><td>GRAN TOTAL DE REPORTE</td><td class="n">Q ${fmtMoney(normalized.gran_total_reporte)}</td></tr>
    </tbody>
  </table>

  <div class="section">Detalle funcionarios / cortesia</div>
  <table>
    <thead><tr><th>Descrip</th><th>Nombre</th><th class="n">Monto</th><th>Check</th></tr></thead>
    <tbody>
      ${detalle.length
        ? detalle
            .map((r) => `<tr><td>${esc(r.descripcion || "")}</td><td>${esc(r.nombre || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td><td>${esc(r.check_no || "")}</td></tr>`)
            .join("")
        : `<tr><td colspan="4">Sin detalle</td></tr>`}
    </tbody>
  </table>

  <div class="meta" style="margin-top:8px">Actualizado: ${esc(payloadOverride ? "Vista previa actual" : (row?.actualizado_en ? String(row.actualizado_en) : "-"))}</div>
  <script>window.print()</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    return res.status(500).send(String(e.message || e));
  }
});

export default router;
