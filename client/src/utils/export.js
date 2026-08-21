/**
 * Preparar datos tabulares: aplica formato y devuelve { header, data }.
 */
function prepareData(rows, { columns, format }) {
  const header = columns.map((c) => c.label);
  const data = rows.map((row) =>
    columns.map((col) => {
      const val = format ? format(row, col) : row[col.key];
      return val == null ? '' : val;
    })
  );
  return { header, data };
}

/** Disparar descarga desde un Blob */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Descargar datos como archivo CSV.
 *
 * @param {object[]} rows - Arreglo de objetos a exportar
 * @param {object} options
 * @param {string} options.filename - Nombre del archivo (sin extensión)
 * @param {object[]} options.columns - Definición de columnas: { key, label }
 * @param {function} [options.format] - (row, col) => valor formateado
 */
export function downloadCSV(rows, opts = {}) {
  const { filename = 'export', columns, format } = opts;
  if (!rows?.length || !columns?.length) return;
  const { header, data } = prepareData(rows, { columns, format });

  const esc = (v) => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = `\uFEFF${header.map(esc).join(',')}\n${data.map((r) => r.map(esc).join(',')).join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filename}.csv`);
}

/**
 * Descargar datos como archivo Excel (.xlsx).
 *
 * @param {object[]} rows
 * @param {object} options
 * @param {string} options.filename
 * @param {object[]} options.columns - { key, label }
 * @param {function} [options.format] - (row, col) => valor formateado
 */
export function downloadXLSX(rows, opts = {}) {
  const { filename = 'export', columns, format } = opts;
  if (!rows?.length || !columns?.length) return;
  const { header, data } = prepareData(rows, { columns, format });

  // Import dinámico de SheetJS para mantener el bundle inicial pequeño
  import('xlsx').then((XLSX) => {
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

    // Autoajuste de ancho de columnas
    const colWidths = columns.map((col, i) => {
      const headerLen = String(col.label).length;
      const maxDataLen = data.reduce((max, row) => {
        const valLen = String(row[i] || '').length;
        return Math.max(max, valLen);
      }, 0);
      return { wch: Math.max(headerLen, maxDataLen) + 3 };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, `${filename}.xlsx`);
  }).catch(() => {
    // Fallback a CSV si falla la carga de xlsx
    downloadCSV(rows, opts);
  });
}

/**
 * Descargar datos como archivo PDF con tabla.
 *
 * @param {object[]} rows
 * @param {object} options
 * @param {string} options.filename
 * @param {object[]} options.columns - { key, label }
 * @param {function} [options.format] - (row, col) => valor formateado
 * @param {string} [options.logoDataUri] - Logo en data URI (image/png o image/jpeg)
 *   para mostrar arriba a la izquierda del PDF.
 * @param {string} [options.warehouseName] - Nombre de la bodega, se muestra al
 *   lado del logo como subtítulo.
 */
export function downloadPDF(rows, opts = {}) {
  const { filename = 'export', columns, format, logoDataUri, warehouseName } = opts;
  if (!rows?.length || !columns?.length) return;
  const { header, data } = prepareData(rows, { columns, format });

  // Import dinámico de jspdf + jspdf-autotable.
  // A partir de jspdf-autotable v5, `autoTable` es un named export y ya no
  // se monta como side-effect en el prototipo de jsPDF. Hay que invocarlo
  // explícitamente: `autoTable(doc, options)`.
  Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]).then(([jspdfMod, autotableMod]) => {
    const jsPDF = jspdfMod.jsPDF || jspdfMod.default;
    // Soportar tanto `export const autoTable` como `export default autoTable`
    // según la versión empaquetada.
    const autoTable = autotableMod.autoTable || autotableMod.default;

    if (!jsPDF || !autoTable) {
      throw new Error('jsPDF o autoTable no se cargaron correctamente');
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

    // Layout: si hay logo, ocupa la izquierda (max 30mm de ancho × 14mm de alto)
    // y el título + bodega se corren a la derecha. Si no hay logo, queda como
    // antes (título pegado al margen izquierdo).
    const LOGO_MAX_W = 30;
    const LOGO_MAX_H = 14;
    const hasLogo = Boolean(logoDataUri) && /^data:image\/(png|jpe?g);base64,/i.test(logoDataUri);
    const textX = hasLogo ? LOGO_MAX_W + 6 : 14;
    const titleY = 18;

    if (hasLogo) {
      try {
        // Detectar formato por el data URI. jsPDF soporta PNG y JPEG nativos.
        const fmt = /\/png/i.test(logoDataUri) ? 'PNG' : 'JPEG';
        doc.addImage(logoDataUri, fmt, 14, 6, LOGO_MAX_W, LOGO_MAX_H, undefined, 'FAST');
      } catch (imgErr) {
        // Si addImage falla (formato no soportado, base64 corrupto, etc.),
        // seguimos sin logo en vez de romper la exportación.
        console.warn('No se pudo incrustar el logo en el PDF:', imgErr);
      }
    }

    // Título
    const title = filename.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text(title, textX, titleY);

    // Subtítulo: nombre de bodega (si viene) arriba, y fecha/registros abajo
    let subY = 24;
    if (warehouseName) {
      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text(warehouseName, textX, subY);
      subY += 5;
    }
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${rows.length} registros · ${new Date().toLocaleDateString()}`, textX, subY);

    // Tabla (nueva API: autoTable como función, no como método del doc).
    // Si hay logo, bajamos el startY para que la tabla no se solape con él.
    const startY = hasLogo ? Math.max(subY + 4, 24) : 28;
    autoTable(doc, {
      startY,
      head: [header],
      body: data,
      styles: {
        fontSize: 7,
        cellPadding: 1.5,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [60, 60, 60],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      alternateRowStyles: {
        // Gris azulado claro para zebra visible pero sin gritar.
        // El header sigue siendo gris oscuro (#3c3c3c) para que la
        // jerarquía visual sea header > filas claras/impares > filas
        // alternas. Antes era #f5f5f5 (demasiado cerca del blanco).
        fillColor: [233, 240, 248],
      },
      margin: { left: 14, right: 14 },
    });

    doc.save(`${filename}.pdf`);
  }).catch((err) => {
    // Mostrar el error real en consola para diagnóstico, y caer a CSV
    // como plan B para que el usuario no se quede sin descarga.
    console.error('Fallo al generar PDF:', err);
    downloadCSV(rows, opts);
  });
}

