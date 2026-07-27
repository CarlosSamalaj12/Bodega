import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import api from '@/services/api';
import './ReporteSalidasPage.scss';

const RANGE_PRESETS = [
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '60 días', days: 60 },
  { label: '90 días', days: 90 },
];

export default function ReporteSalidasPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [documento, setDocumento] = useState('');
  const debouncedDocumento = useDebounce(documento, 350);
  const [lote, setLote] = useState('');
  const debouncedLote = useDebounce(lote, 350);
  const [rango, setRango] = useState(30);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(hace30);
  const [dateTo, setDateTo] = useState(hoy);
  const [categoriaId, setCategoriaId] = useState(null);
  const [subcategoriaId, setSubcategoriaId] = useState(null);
  const [motivoId, setMotivoId] = useState(null);
  const [warehouseId, setWarehouseId] = useState(null);
  const [bodegaDestinoId, setBodegaDestinoId] = useState(null);

  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Paginación server-side
  const [page, setPage] = useState(1);
  const limit = 20;
  const fetchIdRef = useRef(0);

  // Export column selector
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  useEffect(() => {
    Promise.all([
      catalogosService.getCategorias().catch(() => []),
      catalogosService.getSubcategorias().catch(() => []),
      catalogosService.getMotivos().catch(() => []),
      catalogosService.getBodegas().catch(() => []),
    ]).then(([cats, subs, mts, bgs]) => {
      setCategorias(cats || []);
      setSubcategorias(subs || []);
      setMotivos((mts || []).filter((m) =>
        ['SALIDA', 'AJUSTE', 'TRANSFERENCIA'].includes(String(m.tipo_movimiento || '').toUpperCase())
      ));
      setBodegas(bgs || []);
    });
  }, []);

  const handlePreset = (days) => {
    setRango(days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const fetchId = ++fetchIdRef.current;
    try {
      const params = { from: dateFrom, to: dateTo, limit, page };
      if (debouncedSearch) params.q = debouncedSearch;
      if (debouncedDocumento) params.documento = debouncedDocumento;
      if (debouncedLote) params.lote = debouncedLote;
      if (categoriaId) params.categoria = categoriaId;
      if (subcategoriaId) params.subcategoria = subcategoriaId;
      if (motivoId) params.motivo = motivoId;
      if (warehouseId) params.warehouse = warehouseId;
      if (bodegaDestinoId) params.warehouse_destino = bodegaDestinoId;

      const { data } = await api.get('/api/reportes/salidas', { params });
      if (fetchId !== fetchIdRef.current) return;
      if (data && Array.isArray(data.rows)) {
        setRows(data.rows);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } else {
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      }
    } catch (e) {
      if (fetchId === fetchIdRef.current) {
        toast.error('Error al cargar el reporte');
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo, debouncedSearch, debouncedDocumento, debouncedLote, categoriaId, subcategoriaId, motivoId, warehouseId, bodegaDestinoId, page, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totales = useMemo(() => {
    let totalCantidad = 0;
    let totalCosto = 0;
    for (const g of rows) {
      const lineas = g.lineas || [];
      for (const l of lineas) {
        totalCantidad += l.cantidad;
        totalCosto += l.total_linea;
      }
    }
    return { totalCantidad, totalCosto };
  }, [rows]);

  const subcategoriasFiltradas = useMemo(() => {
    if (!categoriaId) return subcategorias;
    return subcategorias.filter((s) => Number(s.id_categoria) === Number(categoriaId));
  }, [subcategorias, categoriaId]);

  const filteredMotivos = useMemo(() => {
    return motivos.filter((m) =>
      ['SALIDA', 'AJUSTE', 'TRANSFERENCIA'].includes(String(m.tipo_movimiento || '').toUpperCase())
    );
  }, [motivos]);

  // Aplanar datos agrupados para exportación
  const flatForExport = useMemo(() => {
    const flat = [];
    for (const m of rows) {
      for (const l of (m.lineas || [])) {
        flat.push({ ...m, ...l });
      }
    }
    return flat;
  }, [rows]);

  // Columnas disponibles para exportación
  const allExportColumns = [
    { key: 'id_movimiento', label: 'ID Mov.' },
    { key: 'fecha', label: 'Fecha' },
    { key: 'hora', label: 'Hora' },
    { key: 'nombre_motivo', label: 'Motivo' },
    { key: 'nombre_bodega_origen', label: 'B. Origen' },
    { key: 'nombre_bodega_destino', label: 'B. Destino' },
    { key: 'no_documento', label: 'Documento' },
    { key: 'usuario_creador', label: 'Usuario' },
    { key: 'solicitante_pedido', label: 'Solicitante' },
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_categoria', label: 'Categoría' },
    { key: 'nombre_subcategoria', label: 'Subcategoría' },
    { key: 'lote', label: 'Lote' },
    { key: 'fecha_vencimiento', label: 'Vencimiento' },
    { key: 'cantidad', label: 'Cantidad' },
    { key: 'costo_unitario', label: 'Costo U.' },
    { key: 'total_linea', label: 'Total' },
    { key: 'observaciones', label: 'Observaciones' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(flatForExport, {
      filename: `reporte_salidas_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'fecha') return String(row.creado_en || row.fecha || '').slice(0, 10);
        if (col.key === 'hora') return String(row.creado_en || row.fecha || '').slice(11, 16);
        if (col.key === 'fecha_vencimiento' && row.fecha_vencimiento) return String(row.fecha_vencimiento).slice(0, 10);
        if (['cantidad', 'costo_unitario', 'total_linea'].includes(col.key)) {
          return Number(row[col.key] || 0).toFixed(2);
        }
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  const [expandedMovs, setExpandedMovs] = useState(new Set());
  const toggleExpand = (id) => {
    setExpandedMovs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Header
        title="Reporte de Salidas"
        subtitle={`${total} movimiento${total === 1 ? '' : 's'} · Pág. ${page} de ${totalPages}`}
        actions={
          rows.length > 0 && !loading ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar
              </Button>
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                Refrescar
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="reporte-salidas">
        <Card>
          <div className="reporte-salidas__filters">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar producto o SKU…" />

            <div className="reporte-salidas__fecha-group">
              <input type="date" className="input reporte-salidas__date-input"
                value={dateFrom} max={dateTo}
                onChange={(e) => { setDateFrom(e.target.value); setRango(null); }} />
              <span className="reporte-salidas__fecha-sep">→</span>
              <input type="date" className="input reporte-salidas__date-input"
                value={dateTo} min={dateFrom} max={hoy}
                onChange={(e) => { setDateTo(e.target.value); setRango(null); }} />
            </div>

            <div className="reporte-salidas__rango">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  className={`reporte-salidas__rango-btn ${rango === p.days ? 'reporte-salidas__rango-btn--active' : ''}`}
                  onClick={() => handlePreset(p.days)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <select className="select" value={categoriaId ?? ''} onChange={(e) => { setCategoriaId(e.target.value ? Number(e.target.value) : null); setSubcategoriaId(null); }}>
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre_categoria}</option>)}
            </select>

            <select className="select" value={subcategoriaId ?? ''} onChange={(e) => setSubcategoriaId(e.target.value ? Number(e.target.value) : null)} disabled={!categoriaId}>
              <option value="">Todas las subcategorías</option>
              {subcategoriasFiltradas.map((s) => <option key={s.id_subcategoria} value={s.id_subcategoria}>{s.nombre_subcategoria}</option>)}
            </select>

            <select className="select" value={motivoId ?? ''} onChange={(e) => setMotivoId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todos los motivos</option>
              {filteredMotivos.map((m) => <option key={m.id_motivo} value={m.id_motivo}>{m.nombre_motivo}</option>)}
            </select>

            <input type="text" className="input" placeholder="No. Documento…"
              value={documento} onChange={(e) => setDocumento(e.target.value)} />

            <input type="text" className="input" placeholder="Lote…"
              value={lote} onChange={(e) => setLote(e.target.value)} />

            <select className="select" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Bodega origen</option>
              {bodegas.map((b) => <option key={b.id_bodega} value={b.id_bodega}>{b.nombre_bodega}</option>)}
            </select>

            <select className="select" value={bodegaDestinoId ?? ''} onChange={(e) => setBodegaDestinoId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Bodega destino</option>
              {bodegas.map((b) => <option key={b.id_bodega} value={b.id_bodega}>{b.nombre_bodega}</option>)}
            </select>
          </div>
        </Card>

        {loading ? (
          <div className="reporte-salidas__state"><Spinner size={20} label="Cargando reporte…" /></div>        ) : rows.length === 0 ? (
          <EmptyState
            icon="⇡"
            title="Sin datos"
            message="No hay salidas en el período seleccionado." />
        ) : (
          <>
          <div className="reporte-salidas__table-wrapper">
            <table className="table table--sm">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 80 }}>#</th>
                  <th>Fecha</th>
                  {!isMobile && <th>Motivo</th>}
                  <th>B. Origen</th>
                  {!isMobile && <th>B. Destino</th>}
                  {!isMobile && <th>Usuario</th>}
                  <th style={{ textAlign: 'right', width: 90 }}>Cant.</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((g) => {
                  const isOpen = expandedMovs.has(g.id_movimiento);
                  const sumCant = g.lineas.reduce((a, l) => a + l.cantidad, 0);
                  const sumTotal = g.lineas.reduce((a, l) => a + l.total_linea, 0);
                  const parentRow = (
                    <tr key={g.id_movimiento} className="reporte-salidas__mov-row">
                      <td>
                        <button type="button" className="reporte-salidas__expand-btn" onClick={() => toggleExpand(g.id_movimiento)}>
                          <span className={`reporte-salidas__chevron ${isOpen ? 'reporte-salidas__chevron--open' : ''}`}>▸</span>
                        </button>
                      </td>
                      <td><code>#{g.id_movimiento}</code></td>
                      <td className="reporte-salidas__date">
                        <span>{formatDate(g.fecha)}</span>
                        {!isMobile && <span className="reporte-salidas__time">{g.hora}</span>}
                      </td>
                      {!isMobile && <td>{g.nombre_motivo || '—'}</td>}
                      <td>{g.nombre_bodega_origen || '—'}</td>
                      {!isMobile && <td>{g.nombre_bodega_destino || '—'}</td>}
                      {!isMobile && <td className="reporte-salidas__user">{g.usuario_creador || '—'}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumCant.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>Q {sumTotal.toFixed(2)}</td>
                    </tr>
                  );
                  const detailRow = isOpen ? (
                    <tr key={`det-${g.id_movimiento}`} className="reporte-salidas__det-row">
                      <td colSpan={isMobile ? 6 : 9}>
                        <div className="reporte-salidas__detalle">
                          <table className="reporte-salidas__det-table">
                            <thead>
                              <tr>
                                <th>Producto</th>
                                <th style={{ width: 80 }}>SKU</th>
                                {!isMobile && <th style={{ width: 100 }}>Categoría</th>}
                                {!isMobile && <th style={{ width: 100 }}>Lote</th>}
                                <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
                                <th style={{ width: 90, textAlign: 'right' }}>Costo U.</th>
                                <th style={{ width: 100, textAlign: 'right' }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.lineas.map((l) => (
                                <tr key={l.id_detalle}>
                                  <td>{l.nombre_producto}</td>
                                  <td>{l.sku ? <code>{l.sku}</code> : '—'}</td>
                                  {!isMobile && <td>{l.nombre_categoria || '—'}</td>}
                                  {!isMobile && <td>{l.lote || '—'}</td>}
                                  <td style={{ textAlign: 'right' }}>{l.cantidad.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right' }}>Q {l.costo_unitario.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right' }}>Q {l.total_linea.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {g.observaciones && <div className="reporte-salidas__obs">{g.observaciones}</div>}
                        </div>
                      </td>
                    </tr>
                  ) : null;
                  return [parentRow, detailRow].filter(Boolean);
                })}
              </tbody>
              <tfoot>
                <tr className="reporte-salidas__total-row">
                  <td colSpan={isMobile ? 5 : 7} style={{ textAlign: 'right', fontWeight: 600 }}>Totales</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{totales.totalCantidad.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Q {totales.totalCosto.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} loading={loading} />
        </>)
        }
      </div>

      {/* === Selector de columnas para exportación === */}
      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-reporte-salidas"
        onConfirm={handleExportWithColumns}
      />
    </>
  );
}
