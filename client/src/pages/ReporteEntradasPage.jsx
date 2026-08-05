import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStockScope } from '@/hooks/useStockScope';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import api from '@/services/api';
import './ReporteEntradasPage.scss';

const RANGE_PRESETS = [
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '60 días', days: 60 },
  { label: '90 días', days: 90 },
];

export default function ReporteEntradasPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Scope de bodega del usuario: si NO tiene acceso a todas las bodegas,
  // ocultamos el selector y forzamos la bodega del usuario.
  const { scope: stockScope, bodegas: scopeBodegas } = useStockScope();
  const canPickWarehouse = Boolean(stockScope?.can_all_bodegas);
  const fixedBodegaId = Number(stockScope?.id_bodega_default || 0);
  const fixedBodegaName = useMemo(() => {
    if (!stockScope) return '';
    const list = Array.isArray(scopeBodegas) ? scopeBodegas : stockScope.bodegas || [];
    const hit = list.find((b) => Number(b.id_bodega) === fixedBodegaId);
    return hit?.nombre_bodega || '';
  }, [stockScope, scopeBodegas, fixedBodegaId]);

  // Filtros — búsqueda de producto seleccionado
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [documento, setDocumento] = useState('');
  const [committedDocumento, setCommittedDocumento] = useState('');
  const [lote, setLote] = useState('');
  const [committedLote, setCommittedLote] = useState('');
  const [rango, setRango] = useState(30);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(hace30);
  const [dateTo, setDateTo] = useState(hoy);
  const [categoriaId, setCategoriaId] = useState(null);
  const [subcategoriaId, setSubcategoriaId] = useState(null);
  const [motivoId, setMotivoId] = useState(null);
  // Si el usuario solo puede ver su propia bodega, forzamos warehouseId a esa
  // bodega y bloqueamos el selector; si tiene acceso a varias, parte en null
  // (= "Todas las bodegas" cuando can_all_bodegas).
  const [warehouseId, setWarehouseId] = useState(() => null);

  // Catálogos
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  // Datos
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Paginación server-side
  const [page, setPage] = useState(1);
  const limit = 20;
  const fetchIdRef = useRef(0);

  // Ref con filtros actuales para evitar recrear fetchData
  const filtersRef = useRef({});

  // Export column selector
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Si el scope ya cargó y el usuario NO puede elegir bodega, fijamos su
  // bodega en el filtro. Esto garantiza que la query siempre lleve el
  // id_bodega correcto aunque el dropdown quede oculto.
  useEffect(() => {
    if (stockScope && !canPickWarehouse && fixedBodegaId > 0) {
      setWarehouseId((prev) => (prev === fixedBodegaId ? prev : fixedBodegaId));
    }
  }, [stockScope, canPickWarehouse, fixedBodegaId]);

  // Cargar catálogos
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
        ['ENTRADA', 'AJUSTE', 'TRANSFERENCIA'].includes(String(m.tipo_movimiento || '').toUpperCase())
      ));
      setBodegas(bgs || []);
    });
  }, []);

  // Al hacer clic en un preset, actualizar las fechas
  const handlePreset = (days) => {
    setRango(days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  // Dispara la búsqueda con los términos escritos
  const handleSearch = () => {
    setCommittedDocumento(documento);
    setCommittedLote(lote);
    setPage(1);
  };

  // Mantener ref actualizada con los filtros (no triggea re-renders).
  // Se actualiza en un efecto (declarado ANTES del efecto de fetch) y no
  // durante el render, que React puede descartar o repetir.
  useEffect(() => {
    filtersRef.current = { dateFrom, dateTo, selectedProduct, committedDocumento, committedLote, categoriaId, subcategoriaId, motivoId, warehouseId };
  }, [dateFrom, dateTo, selectedProduct, committedDocumento, committedLote, categoriaId, subcategoriaId, motivoId, warehouseId]);

  // Cargar reporte (server-side pagination)
  const fetchData = useCallback(async () => {
    setLoading(true);
    const fetchId = ++fetchIdRef.current;
    try {
      const f = filtersRef.current;
      const params = {
        from: f.dateFrom,
        to: f.dateTo,
        limit,
        page,
      };
      if (f.selectedProduct?.id_producto) params.id_producto = f.selectedProduct.id_producto;
      if (f.committedDocumento) params.documento = f.committedDocumento;
      if (f.committedLote) params.lote = f.committedLote;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.subcategoriaId) params.subcategoria = f.subcategoriaId;
      if (f.motivoId) params.motivo = f.motivoId;
      if (f.warehouseId) params.warehouse = f.warehouseId;

      const { data } = await api.get('/api/reportes/entradas', { params });
      if (fetchId !== fetchIdRef.current) return; // stale
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
  }, [page, limit]);

  // Re-fetch cuando cambian los filtros (leídos del ref) o la paginación
  useEffect(() => { fetchData(); }, [
    fetchData,
    selectedProduct,
    dateFrom,
    dateTo,
    committedDocumento,
    committedLote,
    categoriaId,
    subcategoriaId,
    motivoId,
    warehouseId,
  ]);

  useEffect(() => { setPage(1); }, [selectedProduct, categoriaId, subcategoriaId, motivoId, warehouseId, committedDocumento, committedLote, dateFrom, dateTo]);

  // Agrupar líneas planas del server por id_movimiento
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const id = r.id_movimiento;
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, {
          id_movimiento: id,
          fecha: r.creado_en || r.fecha,
          hora: r.hora,
          nombre_bodega: r.nombre_bodega,
          nombre_motivo: r.nombre_motivo,
          no_documento: r.no_documento,
          usuario_creador: r.usuario_creador,
          observaciones: r.observaciones,
          tipo_entrada: r.tipo_entrada,
          lineas: [],
        });
      }
      map.get(id).lineas.push({
        id_detalle: r.id_detalle,
        id_producto: r.id_producto,
        nombre_producto: r.nombre_producto,
        sku: r.sku,
        nombre_categoria: r.nombre_categoria,
        nombre_subcategoria: r.nombre_subcategoria,
        lote: r.lote,
        fecha_vencimiento: r.fecha_vencimiento,
        cantidad: Number(r.cantidad || 0),
        costo_unitario: Number(r.costo_unitario || 0),
        total_linea: Number(r.total_linea || 0),
      });
    }
    return Array.from(map.values());
  }, [rows]);

  // Totales sobre los datos actuales
  const totales = useMemo(() => {
    let totalCantidad = 0;
    let totalCosto = 0;
    for (const g of grouped) {
      for (const l of g.lineas || []) {
        totalCantidad += l.cantidad;
        totalCosto += l.total_linea;
      }
    }
    return { totalCantidad, totalCosto };
  }, [grouped]);

  // Subcategorías filtradas por categoría
  const subcategoriasFiltradas = useMemo(() => {
    if (!categoriaId) return subcategorias;
    return subcategorias.filter((s) => Number(s.id_categoria) === Number(categoriaId));
  }, [subcategorias, categoriaId]);

  // Motivos filtrados
  const filteredMotivos = useMemo(() => {
    return motivos.filter((m) =>
      ['ENTRADA', 'AJUSTE', 'TRANSFERENCIA'].includes(String(m.tipo_movimiento || '').toUpperCase())
    );
  }, [motivos]);

  // Aplanar datos agrupados para exportación
  const flatForExport = useMemo(() => {
    const flat = [];
    for (const m of grouped) {
      for (const l of (m.lineas || [])) {
        flat.push({ ...m, ...l });
      }
    }
    return flat;
  }, [grouped]);

  // Columnas disponibles para exportación
  const allExportColumns = [
    { key: 'id_movimiento', label: 'ID Mov.' },
    { key: 'fecha', label: 'Fecha' },
    { key: 'hora', label: 'Hora' },
    { key: 'nombre_motivo', label: 'Motivo' },
    { key: 'nombre_bodega', label: 'Bodega' },
    { key: 'no_documento', label: 'Documento' },
    { key: 'usuario_creador', label: 'Usuario' },
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
    { key: 'tipo_entrada', label: 'Tipo Entrada' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(flatForExport, {
      filename: `reporte_entradas_${new Date().toISOString().slice(0, 10)}`,
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

  // Helper para mostrar productos en la fila principal
  const renderProductos = (g) => {
    const nombres = [...new Set(g.lineas.map((l) => l.nombre_producto).filter(Boolean))];
    if (nombres.length === 0) return <span className="reporte-entradas__muted">—</span>;
    return (
      <div className="reporte-entradas__productos-list">
        {nombres.slice(0, 2).map((n, i) => (
          <span key={i} className="reporte-entradas__productos-name">{n}{i === 0 && nombres.length > 2 ? ',' : ''}</span>
        ))}
        {nombres.length > 2 && <span className="reporte-entradas__productos-more">+{nombres.length - 2}</span>}
      </div>
    );
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
        title="Reporte de Entradas"
        subtitle={`${total} movimiento${total === 1 ? '' : 's'} · Pág. ${page} de ${totalPages}`}
        actions={
          grouped.length > 0 && !loading ? (
            <div className="reporte-entradas__header-actions">
              {!isMobile && (
                <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                  Exportar
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                Refrescar
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="reporte-entradas">
        <Card>
          <div className="reporte-entradas__filters">
            <div className="reporte-entradas__filter-item reporte-entradas__filter-item--span-2">
              <ProductPicker
                value={selectedProduct}
                onChange={(p) => { setSelectedProduct(p); setPage(1); }}
                placeholder="Buscar producto o SKU…" />
            </div>

            <div className="reporte-entradas__filter-item">
              <div className="reporte-entradas__fecha-group">
                <input type="date" className="input"
                  value={dateFrom} max={dateTo}
                  onChange={(e) => { setDateFrom(e.target.value); setRango(null); }} />
                <span className="reporte-entradas__fecha-sep">→</span>
                <input type="date" className="input"
                  value={dateTo} min={dateFrom} max={hoy}
                  onChange={(e) => { setDateTo(e.target.value); setRango(null); }} />
              </div>
            </div>

            <div className="reporte-entradas__filter-item">
              <div className="reporte-entradas__rango">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={`ent-pdays-${p.days}`}
                    type="button"
                    className={`reporte-entradas__rango-btn ${rango === p.days ? 'reporte-entradas__rango-btn--active' : ''}`}
                    onClick={() => handlePreset(p.days)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="reporte-entradas__filter-item">
              <select className="select" value={categoriaId ?? ''} onChange={(e) => { setCategoriaId(e.target.value ? Number(e.target.value) : null); setSubcategoriaId(null); }}>
                <option value="">Todas las categorías</option>
                {categorias.map((c) => <option key={`ent-cat-${c.id_categoria}`} value={c.id_categoria}>{c.nombre_categoria}</option>)}
              </select>
            </div>

            <div className="reporte-entradas__filter-item">
              <select className="select" value={subcategoriaId ?? ''} onChange={(e) => setSubcategoriaId(e.target.value ? Number(e.target.value) : null)} disabled={!categoriaId}>
                <option value="">Todas las subcategorías</option>
                {subcategoriasFiltradas.map((s) => <option key={`ent-sub-${s.id_subcategoria}`} value={s.id_subcategoria}>{s.nombre_subcategoria}</option>)}
              </select>
            </div>

            <div className="reporte-entradas__filter-item">
              <select className="select" value={motivoId ?? ''} onChange={(e) => setMotivoId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todos los motivos</option>
                {filteredMotivos.map((m) => <option key={`ent-mot-${m.id_motivo}`} value={m.id_motivo}>{m.nombre_motivo}</option>)}
              </select>
            </div>

            <div className="reporte-entradas__filter-item">
              <input type="text" className="input" placeholder="No. Documento…"
                value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </div>

            <div className="reporte-entradas__filter-item">
              <input type="text" className="input" placeholder="Lote…"
                value={lote} onChange={(e) => setLote(e.target.value)} />
            </div>

            <div className="reporte-entradas__filter-item">
              {canPickWarehouse ? (
                <select className="select" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Todas las bodegas</option>
                  {bodegas.map((b) => <option key={`ent-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>)}
                </select>
              ) : (
                <div className="reporte-entradas__bodega-fija" title="Solo puedes ver entradas de tu bodega">
                  <span className="reporte-entradas__bodega-fija-label">Bodega</span>
                  <span className="reporte-entradas__bodega-fija-value">{fixedBodegaName || `#${fixedBodegaId}`}</span>
                </div>
              )}
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="reporte-entradas__state"><Spinner size={20} label="Cargando reporte…" /></div>        ) : grouped.length === 0 ? (
          <EmptyState
            icon="⇣"
            title="Sin datos"
            message="No hay entradas en el período seleccionado." />
        ) : (
          <>
          <div className="reporte-entradas__table-wrapper">
            <table className="table table--sm">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 80 }}>#</th>
                  <th>Fecha</th>
                  {!isMobile && <th>Motivo</th>}
                  <th>Bodega</th>
                  <th>Productos</th>
                  {!isMobile && <th>Documento</th>}
                  {!isMobile && <th>Usuario</th>}
                  <th style={{ textAlign: 'right', width: 90 }}>Cant.</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap((g) => {
                  const isOpen = expandedMovs.has(g.id_movimiento);
                  const sumCant = g.lineas.reduce((a, l) => a + l.cantidad, 0);
                  const sumTotal = g.lineas.reduce((a, l) => a + l.total_linea, 0);
                  const parentRow = (
                    <tr key={`ent-${g.id_movimiento}`} className="reporte-entradas__mov-row">
                      <td>
                        <button type="button" className="reporte-entradas__expand-btn" onClick={() => toggleExpand(g.id_movimiento)}>
                          <span className={`reporte-entradas__chevron ${isOpen ? 'reporte-entradas__chevron--open' : ''}`}>▸</span>
                        </button>
                      </td>
                      <td><code>#{g.id_movimiento}</code></td>
                      <td className="reporte-entradas__date">
                        <span>{formatDate(g.fecha)}</span>
                        {!isMobile && <span className="reporte-entradas__time">{g.hora}</span>}
                      </td>
                      {!isMobile && <td>{g.nombre_motivo || '—'}</td>}
                      <td>{g.nombre_bodega || '—'}</td>
                      <td>{renderProductos(g)}</td>
                      {!isMobile && <td>{g.no_documento || '—'}</td>}
                      {!isMobile && <td className="reporte-entradas__user">{g.usuario_creador || '—'}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumCant.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>Q {sumTotal.toFixed(2)}</td>
                    </tr>
                  );
                  const detailRow = isOpen ? (
                    <tr key={`ent-det-${g.id_movimiento}`} className="reporte-entradas__det-row">
                      <td colSpan={isMobile ? 7 : 10}>
                        <div className="reporte-entradas__detalle">
                          <table className="reporte-entradas__det-table">
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
                                <tr key={`ent-${l.id_detalle}`}>
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
                          {g.observaciones && <div className="reporte-entradas__obs">{g.observaciones}</div>}
                          {g.tipo_entrada && (
                            <div className="reporte-entradas__obs" style={{ marginTop: '8px' }}>
                              <strong>Tipo de entrada:</strong> {g.tipo_entrada}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null;
                  return [parentRow, detailRow].filter(Boolean);
                })}
              </tbody>
              <tfoot>
                <tr className="reporte-entradas__total-row">
                  <td colSpan={isMobile ? 3 : 7} style={{ fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{totales.totalCantidad.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Q {totales.totalCosto.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {totalPages > 1 && (
            <Card compact>
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={(p) => setPage(p)}
                label={`${total} movimiento${total === 1 ? '' : 's'}`}
              />
            </Card>
          )}
        </>
        )}
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-reporte-entradas"
        onConfirm={handleExportWithColumns}
      />
    </>
  );
}
