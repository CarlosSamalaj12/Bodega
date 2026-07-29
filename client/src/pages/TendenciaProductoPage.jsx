import { useEffect, useState, useMemo, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { toast } from '@/components/ui/Toast';
import api from '@/services/api';
import { catalogosService } from '@/services/catalogos.service';
import './TendenciaProductoPage.scss';

// ─── Helpers ────────────────────────────────────────────────────────
function fmtMoney(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? `Q ${n.toFixed(2)}` : 'Q 0.00';
}

function fmtDateDMY(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function shortDateLabel(ymd) {
  if (!ymd) return '—';
  const d = new Date(ymd + 'T00:00:00');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function monthLabel(periodo) {
  if (!periodo) return '—';
  // Formato: YYYY-MM
  const [y, m] = periodo.split('-');
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${months[Number(m) - 1]} ${y}`;
}

// ─── Bar Chart Component ────────────────────────────────────────────
function TrendBarChart({ data, valueKey, labelFmt, valueFmt, barColorClass = 'tendencia__bar--accent', height = 160 }) {
  if (!data || data.length === 0) {
    return <div className="tendencia__chart-empty">Sin datos para mostrar</div>;
  }

  const maxVal = Math.max(...data.map((r) => Math.abs(Number(r[valueKey] || 0))), 1);

  return (
    <div className="tendencia__chart" style={{ height }}>
      {data.map((r, i) => {
        const val = Number(r[valueKey] || 0);
        const pct = (val / maxVal) * 100;
        const barH = Math.max(4, pct * 0.9); // 90% del contenedor
        return (
          <div key={`ten-${i}`} className="tendencia__bar-wrap" title={`${labelFmt(r)}: ${valueFmt(val)}`}>
            <div className={`tendencia__bar ${barColorClass}`} style={{ height: `${barH}%` }} />
            <div className="tendencia__bar-value">{valueFmt(val)}</div>
            <div className="tendencia__bar-label">{labelFmt(r)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Demand Group Options ──────────────────────────────────────────
const DEMAND_GROUP_OPTIONS = [
  { value: null, label: 'Por día' },
  { value: 7, label: '7 días' },
  { value: 14, label: '14 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
];

// ─── Status Badge ───────────────────────────────────────────────────
function PriceStatusBadge({ status }) {
  if (!status || status === 'sin_datos' || status === 'se_mantuvo') {
    return <span className="tendencia__badge tendencia__badge--info">Sin cambios</span>;
  }
  if (status === 'subio') {
    return <span className="tendencia__badge tendencia__badge--up">Subió de precio</span>;
  }
  return <span className="tendencia__badge tendencia__badge--info">{status}</span>;
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function TendenciaProductoPage() {
  const hoy = new Date().toISOString().slice(0, 10);
  const mesPasado = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── Filters ──
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [warehouseId, setWarehouseId] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [dateFrom, setDateFrom] = useState(mesPasado);
  const [dateTo, setDateTo] = useState(hoy);

  // ── Categorías ──
  const [categorias, setCategorias] = useState([]);
  const [categoriaId, setCategoriaId] = useState(null);

  // ── Data ──
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [searched, setSearched] = useState(false);

  // ── Cargar bodegas ──
  useEffect(() => {
    api.get('/api/cuadre-caja/context')
      .then(({ data: ctx }) => {
        if (ctx?.bodegas) setWarehouses(ctx.bodegas);
        if (ctx?.id_bodega_default) setWarehouseId(Number(ctx.id_bodega_default));
      })
      .catch(() => {});

    catalogosService.getCategorias().then(setCategorias).catch(() => {});
  }, []);

  // ── Seleccionar producto ──
  const handleSelectProduct = (p) => {
    setSelectedProduct(p);
    setData(null);
    setSearched(false);
  };

  const handleClearProduct = () => {
    setSelectedProduct(null);
    setData(null);
    setSearched(false);
  };

  // ── Buscar tendencia ──
  const handleSearch = useCallback(async () => {
    if (!selectedProduct?.id_producto) {
      toast.error('Selecciona un producto');
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const params = { producto: selectedProduct.id_producto };
      if (warehouseId) params.warehouse_base = warehouseId;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const { data: res } = await api.get('/api/reportes/tendencia-producto', { params });
      setData(res);
    } catch (e) {
      const msg = e?.response?.data?.error || 'Error al cargar tendencia';
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedProduct, warehouseId, dateFrom, dateTo]);

  // ── Agrupación de demanda ──
  const [groupDays, setGroupDays] = useState(null);

  // Agrupar datos de demanda por período de días
  const groupedDemand = useMemo(() => {
    const raw = data?.demand_by_date;
    if (!raw || raw.length === 0) return [];
    if (!groupDays) return raw; // sin agrupar

    const sorted = [...raw].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const groups = [];
    let currentGroup = null;

    for (const r of sorted) {
      const d = new Date(r.fecha + 'T00:00:00');
      if (!currentGroup || d >= currentGroup.endDate) {
        // Iniciar nuevo grupo
        const start = new Date(d);
        const end = new Date(start);
        end.setDate(end.getDate() + groupDays);
        currentGroup = {
          startDate: start,
          endDate: end,
          label: `${shortDateLabel(start.toISOString().slice(0, 10))} − ${shortDateLabel(end.toISOString().slice(0, 10))}`,
          cantidad_solicitada: 0,
          pedidos: 0,
          fecha: start.toISOString().slice(0, 10),
        };
        groups.push(currentGroup);
      }
      currentGroup.cantidad_solicitada += Number(r.cantidad_solicitada || 0);
      currentGroup.pedidos += Number(r.pedidos || 0);
    }

    return groups;
  }, [data?.demand_by_date, groupDays]);

  const demandData = groupedDemand.length > 0 ? groupedDemand : (data?.demand_by_date || []);
  const demandLabel = groupDays
    ? `Cantidad agrupada cada ${groupDays} días (${demandData.length} períodos)`
    : `Cantidad solicitada por día (${demandData.length} días con movimiento)`;

  // ── Exportar PDF ──
  const handleExportPdf = async () => {
    if (!data) return;
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;
      let y = 18;

      // ── Title ──
      doc.setFontSize(16);
      doc.text('Tendencia de Producto', margin, y);
      y += 7;

      doc.setFontSize(11);
      doc.text(data.producto?.nombre_producto || '—', margin, y);
      y += 5;

      doc.setFontSize(8);
      doc.setTextColor(100);
      if (data.producto?.sku) doc.text(`SKU: ${data.producto.sku}`, margin, y);
      if (data.producto?.sku) y += 4;
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, margin, y);
      doc.setTextColor(0);
      y += 8;

      // ── Summary Stats ──
      if (stats) {
        const statLines = [
          `Cambios de precio: ${stats.priceChanges}`,
          `Meses con datos: ${stats.priceMonths}`,
          `Total demanda: ${stats.totalDemand.toFixed(1)}`,
          `Precio actual: Q ${Number(stats.currentPrice || 0).toFixed(2)}`,
          stats.avgPrice ? `Precio promedio: Q ${stats.avgPrice.toFixed(2)}` : '',
          stats.maxDemandDate ? `Pico demanda: ${stats.maxDemand.toFixed(1)} (${fmtDateDMY(stats.maxDemandDate)})` : '',
        ].filter(Boolean);

        doc.setFontSize(9);
        statLines.forEach((line, i) => {
          const col = i % 2 === 0 ? margin : margin + pageW / 2 - margin;
          const row = Math.floor(i / 2);
          doc.text(line, col, y + row * 4.5);
        });
        y += Math.ceil(statLines.length / 2) * 4.5 + 6;
      }

      // ── Price Monthly Table ──
      if (data.price_monthly?.length > 0) {
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Historial de Precios', margin, y);
        y += 5;
        doc.setFont(undefined, 'normal');

        const priceRows = data.price_monthly.map((r) => [
          monthLabel(r.periodo),
          `Q ${Number(r.precio || 0).toFixed(2)}`,
          r.pct_change != null
            ? `${Number(r.pct_change) > 0 ? '+' : ''}${Number(r.pct_change).toFixed(1)}%`
            : '—',
        ]);

        autoTable(doc, {
          startY: y,
          head: [['Período', 'Precio', 'Variación']],
          body: priceRows,
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255], fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { halign: 'right', cellWidth: 30 },
            2: { halign: 'right', cellWidth: 25 },
          },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── Price Increases Table ──
      if (data.price_increases?.length > 0) {
        if (y > 240) { doc.addPage(); y = 18; }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Incrementos Registrados', margin, y);
        y += 5;
        doc.setFont(undefined, 'normal');

        const incRows = data.price_increases.map((r) => [
          fmtDateDMY(r.fecha),
          `Q ${Number(r.precio_anterior || 0).toFixed(2)}`,
          `Q ${Number(r.precio_nuevo || 0).toFixed(2)}`,
          `+${Number(r.pct_up || 0).toFixed(1)}%`,
        ]);

        autoTable(doc, {
          startY: y,
          head: [['Fecha', 'Anterior', 'Nuevo', 'Incremento']],
          body: incRows,
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255], fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { halign: 'right', cellWidth: 25 },
            2: { halign: 'right', cellWidth: 25 },
            3: { halign: 'right', cellWidth: 25 },
          },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 8;
      }

      // ── Demand Table ──
      if (data.demand_by_date?.length > 0) {
        if (y > 240) { doc.addPage(); y = 18; }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Demanda / Consumo', margin, y);
        y += 5;
        doc.setFont(undefined, 'normal');

        const demRows = data.demand_by_date.map((r) => [
          fmtDateDMY(r.fecha),
          Number(r.cantidad_solicitada || 0).toFixed(2),
          String(Number(r.pedidos || 0)),
        ]);

        autoTable(doc, {
          startY: y,
          head: [['Fecha', 'Cantidad', 'Pedidos']],
          body: demRows,
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [60, 60, 60], textColor: [255, 255, 255], fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { halign: 'right', cellWidth: 25 },
            2: { halign: 'right', cellWidth: 20 },
          },
          margin: { left: margin, right: margin },
        });
      }

      // ── Footer ──
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          `Página ${i} de ${totalPages}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 8,
          { align: 'center' }
        );
      }

      const filename = `tendencia_${(data.producto?.sku || data.producto?.nombre_producto || 'producto').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch {
      toast.error('Error al generar el PDF');
    }
  };

  // ── Computed stats ──
  const stats = useMemo(() => {
    if (!data) return null;

    const priceMonths = data.price_monthly || [];
    const demands = data.demand_by_date || [];
    const increases = data.price_increases || [];

    const totalDemand = demands.reduce((a, r) => a + Number(r.cantidad_solicitada || 0), 0);
    const maxDemand = demands.reduce((a, r) => Math.max(a, Number(r.cantidad_solicitada || 0)), 0);
    const maxDemandItem = demands.find((r) => Number(r.cantidad_solicitada || 0) === maxDemand);

    const currentPrice = priceMonths.length > 0
      ? priceMonths[priceMonths.length - 1].precio
      : null;

    const avgPrice = priceMonths.length > 0
      ? priceMonths.reduce((a, r) => a + Number(r.precio || 0), 0) / priceMonths.length
      : null;

    return {
      totalDemand,
      maxDemand,
      maxDemandDate: maxDemandItem?.fecha || null,
      currentPrice,
      avgPrice,
      priceChanges: increases.length,
      priceMonths: priceMonths.length,
      demandDays: demands.length,
    };
  }, [data]);

  // ── Render ──
  return (
    <>
      <Header
        title="Tendencia de Producto"
        subtitle={selectedProduct
          ? `${selectedProduct.nombre_producto}${selectedProduct.sku ? ` (${selectedProduct.sku})` : ''}`
          : 'Selecciona un producto para ver su tendencia'}
      />

      <div className="tendencia">
        {/* ── Filters Card ── */}
        <Card>
          <div className="tendencia__filters">
            {/* Product search */}
            <div className="tendencia__product-search">
              <label className="tendencia__filter-label">Producto</label>
              <ProductPicker
                value={selectedProduct}
                onChange={handleSelectProduct}
                placeholder="Buscar producto por nombre o SKU…"
              />
            </div>

            {/* Category */}
            <div className="tendencia__filter-group">
              <label className="tendencia__filter-label">Categoría</label>
              <select
                className="select"
                value={categoriaId ?? ''}
                onChange={(e) => {
                  setCategoriaId(e.target.value ? Number(e.target.value) : null);
                  handleClearProduct();
                }}
              >
                <option value="">Todas las categorías</option>
                {categorias.map((c) => (
                  <option key={`ten-cat-${c.id_categoria}`} value={c.id_categoria}>
                    {c.nombre_categoria}
                  </option>
                ))}
              </select>
            </div>

            {/* Warehouse */}
            <div className="tendencia__filter-group">
              <label className="tendencia__filter-label">Bodega</label>
              <select
                className="select"
                value={warehouseId ?? ''}
                onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Todas las bodegas</option>
                {warehouses.map((w) => (
                  <option key={`ten-${w.id_bodega}`} value={w.id_bodega}>{w.nombre_bodega}</option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div className="tendencia__filter-group">
              <label className="tendencia__filter-label">Desde</label>
              <input
                type="date"
                className="input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="tendencia__filter-group">
              <label className="tendencia__filter-label">Hasta</label>
              <input
                type="date"
                className="input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="tendencia__filter-group tendencia__filter-group--action">
              <Button variant="primary" onClick={handleSearch} disabled={loading || !selectedProduct}>
                {loading ? 'Buscando…' : '🔍 Buscar'}
              </Button>
              {data && !loading && (
                <Button variant="ghost" size="sm" onClick={handleExportPdf}>
                  📄 PDF
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* ── Loading ── */}
        {loading && (
          <div className="tendencia__state">
            <Spinner size={24} label="Cargando tendencia…" />
          </div>
        )}

        {/* ── Results ── */}
        {!loading && data && (
          <>
            {/* Product info + summary */}
            <Card>
              <div className="tendencia__resume">
                <div className="tendencia__resume-product">
                  <h2 className="tendencia__resume-title">{data.producto?.nombre_producto}</h2>
                  <div className="tendencia__resume-meta">
                    {data.producto?.sku && <code>SKU: {data.producto.sku}</code>}
                    <PriceStatusBadge status={data.price_status} />
                  </div>
                </div>

                {stats && (
                  <div className="tendencia__stats">
                    <div className="tendencia__stat">
                      <span className="tendencia__stat-value">{stats.priceChanges}</span>
                      <span className="tendencia__stat-label">Cambios de precio</span>
                    </div>
                    <div className="tendencia__stat">
                      <span className="tendencia__stat-value">{stats.priceMonths}</span>
                      <span className="tendencia__stat-label">Meses con datos</span>
                    </div>
                    <div className="tendencia__stat">
                      <span className="tendencia__stat-value">{stats.totalDemand.toFixed(1)}</span>
                      <span className="tendencia__stat-label">Total demanda</span>
                    </div>
                    <div className="tendencia__stat">
                      <span className="tendencia__stat-value">{Number(stats.currentPrice || 0).toFixed(2)}</span>
                      <span className="tendencia__stat-label">Precio actual</span>
                    </div>
                    {stats.avgPrice && (
                      <div className="tendencia__stat">
                        <span className="tendencia__stat-value">{stats.avgPrice.toFixed(2)}</span>
                        <span className="tendencia__stat-label">Precio promedio</span>
                      </div>
                    )}
                    {stats.maxDemandDate && (
                      <div className="tendencia__stat">
                        <span className="tendencia__stat-value">{stats.maxDemand.toFixed(1)}</span>
                        <span className="tendencia__stat-label">Pico demanda ({shortDateLabel(stats.maxDemandDate)})</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* ── Price History Chart ── */}
            <Card>
              <div className="tendencia__section">
                <h3 className="tendencia__section-title">Historial de Precios</h3>
                <div className="tendencia__section-desc">
                  {data.price_monthly?.length > 0
                    ? `Evolución del precio mensual (${data.price_monthly.length} meses)`
                    : 'Sin datos de precio histórico'}
                </div>
                {data.price_monthly?.length > 0 && (
                  <>
                    <TrendBarChart
                      data={data.price_monthly}
                      valueKey="precio"
                      labelFmt={(r) => monthLabel(r.periodo)}
                      valueFmt={(v) => fmtMoney(v)}
                      barColorClass="tendencia__bar--accent"
                      height={180}
                    />
                    {/* Tabla de precios mensual */}
                    <div className="tendencia__table-wrap">
                      <table className="table table--sm">
                        <thead>
                          <tr>
                            <th>Período</th>
                            <th style={{ textAlign: 'right' }}>Precio</th>
                            <th style={{ textAlign: 'right' }}>Variación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.price_monthly.map((r, i) => (
                            <tr key={`ten-${i}`}>
                              <td>{monthLabel(r.periodo)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {fmtMoney(r.precio)}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {r.pct_change != null ? (
                                  <span className={`tendencia__pct ${Number(r.pct_change) > 0 ? 'tendencia__pct--up' : Number(r.pct_change) < 0 ? 'tendencia__pct--down' : ''}`}>
                                    {Number(r.pct_change) > 0 ? '+' : ''}{Number(r.pct_change).toFixed(1)}%
                                  </span>
                                ) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* Incrementos de precio */}
                {data.price_increases?.length > 0 && (
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <h4 className="tendencia__subtitle">Incrementos registrados</h4>
                    <div className="tendencia__table-wrap">
                      <table className="table table--sm">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th style={{ textAlign: 'right' }}>Anterior</th>
                            <th style={{ textAlign: 'right' }}>Nuevo</th>
                            <th style={{ textAlign: 'right' }}>Incremento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.price_increases.map((r, i) => (
                            <tr key={`ten-${i}`}>
                              <td>{fmtDateDMY(r.fecha)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMoney(r.precio_anterior)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMoney(r.precio_nuevo)}</td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="tendencia__pct tendencia__pct--up">
                                  +{Number(r.pct_up).toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* ── Demand / Consumption Chart ── */}
            <Card>
              <div className="tendencia__section">
                <div className="tendencia__section-header">
                  <h3 className="tendencia__section-title">Demanda / Consumo</h3>
                  {data.demand_by_date?.length > 0 && (
                    <div className="tendencia__group-selector">
                      {DEMAND_GROUP_OPTIONS.map((opt) => (
                        <button
                          key={`ten-${opt.label}`}
                          type="button"
                          className={`tendencia__group-chip ${groupDays === opt.value ? 'tendencia__group-chip--active' : ''}`}
                          onClick={() => setGroupDays(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tendencia__section-desc">
                  {demandData.length > 0 ? demandLabel : 'Sin datos de demanda'}
                </div>
                {demandData.length > 0 && (
                  <>
                    <TrendBarChart
                      data={demandData}
                      valueKey="cantidad_solicitada"
                      labelFmt={(r) => groupDays ? r.label : shortDateLabel(r.fecha)}
                      valueFmt={(v) => Number(v).toFixed(1)}
                      barColorClass="tendencia__bar--secondary"
                      height={160}
                    />
                    <div className="tendencia__table-wrap">
                      <table className="table table--sm">
                        <thead>
                          <tr>
                            <th>{groupDays ? 'Período' : 'Fecha'}</th>
                            <th style={{ textAlign: 'right' }}>Cantidad</th>
                            <th style={{ textAlign: 'right' }}>Pedidos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demandData.map((r, i) => (
                            <tr key={`ten-${i}`}>
                              <td>{groupDays ? r.label : fmtDateDMY(r.fecha)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {Number(r.cantidad_solicitada || 0).toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                {Number(r.pedidos || 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </>
        )}

        {/* ── Empty state (searched but no data) ── */}
        {!loading && searched && !data && (
          <EmptyState
            icon="📈"
            title="Sin resultados"
            message="No se encontraron datos de tendencia para el producto y filtros seleccionados."
          />
        )}

        {/* ── Initial state ── */}
        {!loading && !searched && !data && (
          <EmptyState
            icon="📊"
            title="Tendencia de Producto"
            message="Selecciona un producto, ajusta los filtros y presiona Buscar para ver su evolución de precios y demanda."
          />
        )}
      </div>
    </>
  );
}
