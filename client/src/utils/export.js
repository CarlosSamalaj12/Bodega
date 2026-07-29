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
 */
export function downloadPDF(rows, opts = {}) {
  const { filename = 'export', columns, format } = opts;
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

    // Título
    const title = filename.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    doc.setFontSize(14);
    doc.text(title, 14, 18);

    // Subtítulo con fecha y total de filas
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(`${rows.length} registros · ${new Date().toLocaleDateString()}`, 14, 24);

    // Tabla (nueva API: autoTable como función, no como método del doc)
    autoTable(doc, {
      startY: 28,
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
        fillColor: [245, 245, 245],
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

