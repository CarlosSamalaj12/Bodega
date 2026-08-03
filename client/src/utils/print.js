/**
 * Escapa HTML en valores dinámicos antes de inyectarlos en la plantilla de
 * impresión (document.write). Evita XSS si un campo (producto, observaciones,
 * nombres) contiene caracteres/HTML malicioso.
 */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * printPedidoPos80mm — Abre una ventana de impresión con formato
 * para impresora térmica POS de 80mm.
 *
 * @param {object} pedido - Datos del pedido (al menos: id_pedido, creado_en, estado, lines, etc.)
 * @param {object} [opts]
 * @param {string} [opts.title='Pedido'] - Título del documento
 * @param {boolean} [opts.autoPrint=true] - Disparar print() automáticamente
 */
export function printPedidoPos80mm(pedido, opts = {}) {
  const {
    title = 'Pedido',
    autoPrint = true,
  } = opts;

  if (!pedido) return;

  const lines = Array.isArray(pedido.lines) ? pedido.lines : [];

  const formatoFecha = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  // Construir HTML del ticket
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)} #${pedido.id_pedido}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      width: 302px;
      max-width: 302px;
      padding: 20px 12px 40px;
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-size: 16px;
      font-weight: bold;
      line-height: 1.3;
      color: #000;
      background: #fff;
    }

    .ticket {
      width: 100%;
    }

    .header {
      text-align: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 3px dashed #000;
    }

    .header h1 {
      font-size: 22px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

    .header .sub {
      font-size: 14px;
    }

    .info-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 16px;
    }

    .info-table td {
      padding: 6px 0;
      vertical-align: top;
    }

    .info-table .label {
      font-weight: bold;
      width: 100px;
    }

    .info-table .value {
      word-break: break-word;
    }

    .separator {
      border-top: 2px dashed #000;
      margin: 12px 0;
    }

    .lines-title {
      font-weight: bold;
      font-size: 17px;
      margin-bottom: 8px;
    }

    .lines-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      table-layout: fixed;
    }

    .lines-table th {
      text-align: left;
      font-weight: bold;
      font-size: 13px;
      padding: 3px 2px;
      border-bottom: 2px solid #000;
      border-top: 2px solid #000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
    }

    .lines-table th.right {
      text-align: right;
    }

    .lines-table th:nth-child(1) { width: auto; }
    .lines-table th:nth-child(2),
    .lines-table th:nth-child(3),
    .lines-table th:nth-child(4) {
      width: 13mm;
    }

    .lines-table tr {
      border-bottom: 2px solid #000;
    }

    .lines-table td {
      padding: 4px 2px;
      vertical-align: top;
      overflow: hidden;
    }

    .lines-table td.product-name {
      word-break: break-word;
      white-space: normal;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .line-note {
      display: block;
      margin-top: 2px;
      font-size: 11px;
      font-style: italic;
      font-weight: normal;
      color: #444;
      line-height: 1.15;
      white-space: normal;
      word-break: break-word;
    }
    .line-note::before {
      content: "Nota: ";
      font-style: normal;
      font-weight: bold;
    }

    .lines-table td.right {
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
    }

    .totals-section {
      font-size: 15px;
      margin-top: 8px;
    }

    .totals-section div {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }

    .footer {
      text-align: center;
      margin-top: 20px;
      padding-top: 15px;
      border-top: 3px dashed #000;
      font-size: 14px;
    }

    .estado-badge {
      font-weight: bold;
      text-transform: uppercase;
    }

    @media print {
      @page {
        size: 80mm auto;
        margin: 0 !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        left: 0 !important;
      }
      body {
        width: 80mm !important;
        max-width: 80mm !important;
        min-width: 80mm !important;
        padding: 5mm 0 10mm 0 !important;
        font-size: 16px !important;
        text-align: left !important;
      }
      .ticket { margin: 0 !important; padding: 0 0.5mm !important; }
      .lines-table { width: calc(100% + 1.5mm) !important; margin-left: -1.5mm !important; }
      .header { margin-bottom: 5mm; padding-bottom: 4mm; }
      .info-table { margin-bottom: 4mm; }
      .info-table td { padding: 1.5mm 0; }
      .info-table .label { width: 24mm; }
      .separator { margin: 3mm 0; }
      .lines-title { margin-bottom: 2mm; }
      .lines-table th, .lines-table td { padding: 1mm 0.5mm; }
      .lines-table th:nth-child(2),
      .lines-table th:nth-child(3),
      .lines-table th:nth-child(4) { width: 11mm; }
      .lines-table tr { border-bottom: 2px solid #000; }
      .totals-section { margin-top: 2mm; }
      .totals-section div { padding: 1mm 0; }
      .footer { margin-top: 5mm; padding-top: 4mm; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <h1>Pedido #${pedido.id_pedido}</h1>
      <div class="sub">${formatoFecha(pedido.creado_en)}</div>
    </div>

    <table class="info-table">
      <tr>
        <td class="label">Estado:</td>
        <td class="value"><span class="estado-badge">${esc(pedido.estado) || '—'}</span></td>
      </tr>
      <tr>
        <td class="label">Solicitante:</td>
        <td class="value">${esc(pedido.requester_name) || '—'}</td>
      </tr>
      <tr>
        <td class="label">Bodega solicita:</td>
        <td class="value">${esc(pedido.requester_warehouse) || '—'}</td>
      </tr>
      <tr>
        <td class="label">Bodega surtidor:</td>
        <td class="value">${esc(pedido.from_warehouse) || esc(pedido.nombre_bodega_surtidor) || '—'}</td>
      </tr>
      ${pedido.observaciones ? `
      <tr>
        <td class="label">Observaciones:</td>
        <td class="value">${esc(pedido.observaciones)}</td>
      </tr>` : ''}
    </table>

    ${lines.length > 0 ? `
    <div class="separator"></div>
    <div class="lines-title">Líneas del pedido</div>
    <table class="lines-table">
      <thead>
        <tr>
          <th>Producto</th>
          <th class="right">Solic.</th>
          <th class="right">Desp.</th>
          <th class="right">Pend.</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(l => `
        <tr>
          <td class="product-name">${esc(l.nombre_producto) || '—'}${l.observacion_producto ? `<span class="line-note">${esc(l.observacion_producto)}</span>` : ''}</td>
          <td class="right">${Number(l.cantidad_solicitada || 0)}</td>
          <td class="right">${Number(l.cantidad_surtida || 0) || ''}</td>
          <td class="right">${Number(l.pendiente || 0)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}

    ${lines.length > 0 ? `
    <div class="separator"></div>
    <div class="totals-section">
      <div>
        <span>Total líneas:</span>
        <span>${lines.length}</span>
      </div>
      <div>
        <span>Total solicitado:</span>
        <span>${lines.reduce((a, l) => a + Number(l.cantidad_solicitada || 0), 0)}</span>
      </div>
      <div>
        <span>Total despachado:</span>
        <span>${lines.reduce((a, l) => a + Number(l.cantidad_surtida || 0), 0)}</span>
      </div>
      <div>
        <span>Pendiente:</span>
        <span>${lines.reduce((a, l) => a + Number(l.pendiente || 0), 0)}</span>
      </div>
    </div>` : ''}

    <div class="footer">
      <p>Bodega · Sistema de Inventario</p>
      <p style="margin-top: 1mm;">Impreso: ${new Date().toLocaleString('es-GT')}</p>
    </div>
  </div>

  <script>
    ${autoPrint ? `
    window.onload = function() {
      // Maximizar la ventana para ver el contenido
      if (window.screen) {
        window.moveTo(0, 0);
        window.resizeTo(window.screen.availWidth, window.screen.availHeight);
      }
      setTimeout(function() {
        window.print();
      }, 500);
    };
    window.onafterprint = function() {
      window.close();
    };
    ` : ''}
  </script>
</body>
</html>`;

  try {
    const win = window.open('', '_blank', '');
    if (!win) {
      // Fallback si el popup fue bloqueado
      alert('Por favor permite las ventanas emergentes para imprimir');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (err) {
    console.error('Error al imprimir:', err);
    alert('Error al abrir la ventana de impresión');
  }
}

/**
 * printPedidoLetterSize — Abre una ventana de impresión con formato
 * tamaño CARTA vertical, con logo, datos del pedido, tabla de líneas
 * y espacios para firmas (quién despacha, quién entrega, quién solicita).
 *
 * @param {object} pedido - Datos completos del pedido (incluyendo lines)
 * @param {object} [opts]
 * @param {string} [opts.logoApp=''] - Logo en base64 para mostrar en el encabezado
 * @param {string} [opts.title='Vale de Entrega'] - Título del documento
 * @param {string} [opts.dispatcherName=''] - Nombre de quien despacha
 * @param {string} [opts.dispatcherRole=''] - Cargo de quien despacha
 * @param {string} [opts.warehouseName=''] - Nombre de la bodega (ej. Bodega Principal)
 * @param {boolean} [opts.autoPrint=true] - Disparar print() automáticamente
 */
export function printPedidoLetterSize(pedido, opts = {}) {
  const {
    logoApp = '',
    title = 'Vale de Entrega',
    dispatcherName = '',
    dispatcherRole = '',
    warehouseName = '',
    autoPrint = true,
  } = opts;

  if (!pedido) return;

  const lines = Array.isArray(pedido.lines) ? pedido.lines : [];

  const formatearFecha = (val) => {
    if (!val) return '_______________';
    const d = new Date(val);
    return d.toLocaleDateString('es-GT', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const today = new Date().toLocaleDateString('es-GT', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const totalSolicitado = lines.reduce((a, l) => a + Number(l.cantidad_solicitada || 0), 0);
  const totalSurtido = lines.reduce((a, l) => a + Number(l.cantidad_surtida || 0), 0);
  const totalPendiente = lines.reduce((a, l) => a + Number(l.pendiente || 0), 0);

  const logoHtml = logoApp
    ? `<img src="${esc(logoApp)}" alt="Logo" class="logo" />`
    : '<div class="logo-placeholder">B</div>';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)} - Pedido #${pedido.id_pedido}</title>
  <style>
    @page {
      size: letter;
      margin: 10mm 12mm 12mm;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.35;
      color: #1a1a1a;
      background: #fff;
    }

    .page {
      max-width: 100%;
    }

    /* ===== Encabezado compacto ===== */
    .header {
      display: flex;
      align-items: center;
      gap: 8pt;
      padding-bottom: 6pt;
      border-bottom: 2px solid #1a1a1a;
      margin-bottom: 8pt;
    }

    .logo {
      width: 40pt;
      height: 40pt;
      object-fit: contain;
      flex-shrink: 0;
    }

    .logo-placeholder {
      width: 40pt;
      height: 40pt;
      background: #1a1a1a;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18pt;
      font-weight: bold;
      flex-shrink: 0;
      border-radius: 3pt;
    }

    .header-text {
      flex: 1;
    }

    .header-text h1 {
      font-size: 13pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
      margin-bottom: 1pt;
    }

    .header-text .subtitle {
      font-size: 7.5pt;
      color: #666;
    }

    .header-right {
      text-align: right;
      font-size: 7.5pt;
      color: #666;
      white-space: nowrap;
      line-height: 1.4;
    }

    .header-right strong {
      color: #1a1a1a;
    }

    /* ===== Info ===== */
    .info-section {
      margin-bottom: 6pt;
    }

    .info-section h2 {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4pt;
      color: #1a1a1a;
      margin-bottom: 3pt;
      padding-bottom: 2pt;
      border-bottom: 1px solid #ccc;
    }

    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2pt 8pt;
      font-size: 8.5pt;
    }

    .info-grid .label {
      font-weight: 600;
      color: #555;
      white-space: nowrap;
    }

    .info-grid .value {
      color: #1a1a1a;
    }

    /* ===== Tabla ===== */
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6pt;
      font-size: 8pt;
    }

    table.items thead th {
      background: #1a1a1a;
      color: #fff;
      padding: 3pt 4pt;
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3pt;
    }

    table.items thead th.r {
      text-align: right;
    }

    table.items tbody td {
      padding: 2.5pt 4pt;
      border-bottom: 1px solid #ddd;
      vertical-align: top;
    }

    table.items tbody td.r {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    table.items tfoot td {
      padding: 3pt 4pt;
      font-weight: 700;
      border-top: 2px solid #1a1a1a;
      font-size: 8pt;
    }

    table.items tfoot td.r {
      text-align: right;
    }

    .obs-text {
      font-size: 8pt;
      color: #555;
      margin-bottom: 6pt;
      padding: 4pt 6pt;
      background: #f5f5f5;
      border-left: 3px solid #1a1a1a;
      border-radius: 2pt;
    }

    /* Observacion por linea de pedido (debajo del nombre del producto) */
    .line-note {
      display: block;
      margin-top: 2pt;
      font-size: 7.5pt;
      font-style: italic;
      color: #555;
      line-height: 1.2;
    }
    .line-note::before {
      content: "Nota: ";
      font-style: normal;
      font-weight: 600;
      color: #1a1a1a;
    }

    /* ===== Firmas ===== */
    .signatures {
      margin-top: 10pt;
      padding-top: 5pt;
      border-top: 2px solid #1a1a1a;
    }

    .signatures h2 {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 8pt;
      letter-spacing: 0.5pt;
    }

    .signatures-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8pt;
    }

    .signature-block {
      text-align: center;
    }

    .signature-block .sig-title {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4pt;
      margin-bottom: 3pt;
      padding-bottom: 2pt;
      border-bottom: 1px solid #ccc;
    }

    .signature-block .sig-line {
      margin: 30pt auto 3pt;
      width: 85%;
      border-top: 1px solid #1a1a1a;
    }

    .signature-block .sig-label {
      font-size: 7pt;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }

    .signature-block .sig-name {
      font-size: 8pt;
      font-weight: 600;
      margin-top: 2pt;
    }

    .signature-block .sig-role {
      font-size: 7.5pt;
      color: #555;
      margin-top: 1pt;
    }

    .signature-block .sig-date {
      font-size: 7pt;
      color: #888;
      margin-top: 2pt;
    }

    /* ===== Footer ===== */
    .footer {
      text-align: center;
      margin-top: 8pt;
      padding-top: 4pt;
      border-top: 1px solid #ccc;
      font-size: 7pt;
      color: #888;
    }

    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }

    .no-print {
      text-align: center;
      margin-bottom: 6pt;
    }

    .no-print button {
      padding: 4pt 14pt;
      font-size: 9pt;
      cursor: pointer;
      background: #1a1a1a;
      color: #fff;
      border: none;
      border-radius: 3pt;
    }

    .no-print button:hover {
      background: #333;
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨 Imprimir</button>
    <button onclick="window.close()" style="background:#888;margin-left:4pt;">✕ Cerrar</button>
  </div>

  <div class="page">
    <!-- ===== Encabezado compacto ===== -->
    <div class="header">
      ${logoHtml}
      <div class="header-text">
        <h1>${esc(title)}</h1>
        <div class="subtitle">Sistema de Inventario · ${esc(warehouseName) || 'Bodega'}</div>
      </div>
      <div class="header-right">
        <strong>Pedido #${pedido.id_pedido}</strong><br />
        ${formatearFecha(pedido.creado_en)}<br />
        Estado: <strong>${esc(pedido.estado) || '—'}</strong>
      </div>
    </div>

    <!-- ===== Información ===== -->
    <div class="info-section">
      <h2>Datos del Pedido</h2>
      <div class="info-grid">
        <span class="label">Solicitante:</span>
        <span class="value">${esc(pedido.requester_name) || '—'}</span>
        <span class="label">Bodega solicita:</span>
        <span class="value">${esc(pedido.requester_warehouse) || '—'}</span>
        <span class="label">Bodega despacha:</span>
        <span class="value">${esc(pedido.from_warehouse) || esc(pedido.nombre_bodega_surtidor) || '—'}</span>
        <span class="label">Impreso:</span>
        <span class="value">${today}</span>
      </div>
    </div>

    ${pedido.observaciones ? `
    <div class="obs-text">
      <strong>Obs.:</strong> ${esc(pedido.observaciones)}
    </div>` : ''}

    <!-- ===== Tabla de productos ===== -->
    <div class="info-section">
      <h2>Productos · ${lines.length} línea${lines.length !== 1 ? 's' : ''}</h2>
      <table class="items">
        <thead>
          <tr>
            <th style="width:30pt;">#</th>
            <th>Producto</th>
            <th class="r" style="width:42pt;">Solicitado</th>
            <th class="r" style="width:42pt;">Despachado</th>
            <th class="r" style="width:42pt;">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${esc(l.nombre_producto) || '—'}${l.observacion_producto ? `<span class="line-note">${esc(l.observacion_producto)}</span>` : ''}</td>
            <td class="r">${Number(l.cantidad_solicitada || 0)}</td>
            <td class="r">${Number(l.cantidad_surtida || 0) || ''}</td>
            <td class="r">${Number(l.pendiente || 0) || ''}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Totales</td>
            <td class="r">${totalSolicitado}</td>
            <td class="r">${totalSurtido}</td>
            <td class="r">${totalPendiente}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ===== Firmas ===== -->
    <div class="signatures">
      <h2>Firmas</h2>
      <div class="signatures-grid">
        <div class="signature-block">
          <div class="sig-title">Quién Despacha / Entrega</div>
          <div class="sig-line"></div>
          <div class="sig-label">Firma</div>
          <div class="sig-name">${esc(dispatcherName) || '______________________'}</div>
          <div class="sig-role">${esc(dispatcherRole) || '______________________'}</div>
          <div class="sig-date">Fecha: ${today}</div>
        </div>
        <div class="signature-block">
          <div class="sig-title">Quién Solicita</div>
          <div class="sig-line"></div>
          <div class="sig-label">Firma</div>
          <div class="sig-name">${esc(pedido.requester_name) || '______________________'}</div>
          <div class="sig-role">${esc(pedido.requester_warehouse) || '______________________'}</div>
          <div class="sig-date">Fecha: ______________</div>
        </div>
      </div>
    </div>

    <div class="footer">
      Bodega · Sistema de Inventario — ${today}
    </div>
  </div>

  <script>
    ${autoPrint ? `
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
      window.onafterprint = function() { window.close(); };
    };
    ` : ''}
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
  if (!win) {
    const a = document.createElement('a');
    a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    a.download = `vale_entrega_${pedido.id_pedido}.html`;
    a.click();
    return;
  }
  win.document.write(html);
  win.document.close();
}

/**
 * printOrderListPos80mm — Imprime una lista resumen de pedidos
 * en formato POS 80mm.
 *
 * @param {Array} pedidos - Lista de pedidos
 * @param {object} [opts]
 * @param {string} [opts.title='Pedidos por despachar']
 */
export function printOrderListPos80mm(pedidos = [], opts = {}) {
  const { title = 'Pedidos por despachar' } = opts;

  if (!pedidos.length) return;

  const formatoFecha = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 80mm; max-width: 80mm;
      padding: 4mm; font-family: 'Courier New', monospace;
      font-size: 10px; font-weight: bold; line-height: 1.4; color: #000; background: #fff;
    }
    h1 { text-align: center; font-size: 14px; margin-bottom: 3mm; text-transform: uppercase; }
    .sep { border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { text-align: left; font-weight: bold; border-bottom: 1px solid #000; padding: 0.5mm 1mm; white-space: nowrap; }
    td { padding: 0.5mm 1mm; vertical-align: top; }
    .r { text-align: right; }
    .c { text-align: center; }
    .footer { text-align: center; margin-top: 3mm; font-size: 9px; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div style="text-align:center;font-size:9px;margin-bottom:3mm;">${new Date().toLocaleString('es-GT')}</div>
  <div class="sep"></div>
  <table>
    <thead><tr>
      <th style="width:10mm">#</th>
      <th>Solicitante</th>
      <th style="width:10mm" class="r">Líneas</th>
      <th style="width:18mm">Estado</th>
    </tr></thead>
    <tbody>
      ${pedidos.map(p => `
      <tr>
        <td>${esc(p.id_pedido)}</td>
        <td>${esc(p.requester_name) || '—'}</td>
        <td class="r">${esc(p.total_lineas) || '—'}</td>
        <td class="c">${esc(p.estado) || '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="sep"></div>
  <div style="display:flex;justify-content:space-between;font-weight:bold;">
    <span>Total:</span>
    <span>${pedidos.length} pedido${pedidos.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="footer">Bodega · Sistema de Inventario</div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); window.onafterprint = function() { window.close(); }; }, 300); };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=400,height=500');
  if (!win) {
    const a = document.createElement('a');
    a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    a.download = `${title.toLowerCase().replace(/\\s+/g, '_')}.html`;
    a.click();
    return;
  }
  win.document.write(html);
  win.document.close();
}
