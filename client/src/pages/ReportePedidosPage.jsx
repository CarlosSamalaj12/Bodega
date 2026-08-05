import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useStockScope } from '@/hooks/useStockScope';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { printPedidoPos80mm } from '@/utils/print';
import { catalogosService } from '@/services/catalogos.service';
import api from '@/services/api';
import './ReportePedidosPage.scss';

const RANGE_PRESETS = [
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '60 días', days: 60 },
  { label: '90 días', days: 90 },
];

const ESTADOS = ['PENDIENTE', 'APROBADO', 'PARCIAL', 'COMPLETADO', 'COMPLETADO_JUSTIFICADO', 'CANCELADO'];

const ESTADO_BADGE = {
  PENDIENTE: 'info',
  APROBADO: 'warning',
  PARCIAL: 'warning',
  COMPLETADO: 'success',
  COMPLETADO_JUSTIFICADO: 'success',
  CANCELADO: 'danger',
};

export default function ReportePedidosPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Scope de bodega. Para pedidos, el bodeguero solo ve movimientos donde
  // su bodega es solicitante o surtidora, así que ambos filtros se bloquean
  // a su bodega cuando no tiene acceso a todas.
  const { scope: stockScope, bodegas: scopeBodegas } = useStockScope();
  const canPickWarehouse = Boolean(stockScope?.can_all_bodegas);
  const fixedBodegaId = Number(stockScope?.id_bodega_default || 0);
  const fixedBodegaName = useMemo(() => {
    if (!stockScope) return '';
    const list = Array.isArray(scopeBodegas) ? scopeBodegas : stockScope.bodegas || [];
    const hit = list.find((b) => Number(b.id_bodega) === fixedBodegaId);
    return hit?.nombre_bodega || '';
  }, [stockScope, scopeBodegas, fixedBodegaId]);

  // Filtros — búsqueda diferida (Enter o botón Buscar)
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [rango, setRango] = useState(30);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(hace30);
  const [dateTo, setDateTo] = useState(hoy);
  const [estado, setEstado] = useState('');
  const [categoriaId, setCategoriaId] = useState(null);
  const [subcategoriaId, setSubcategoriaId] = useState(null);
  const [bodegaSolicitaId, setBodegaSolicitaId] = useState(null);
  const [bodegaDespachoId, setBodegaDespachoId] = useState(null);

  // Si el usuario no puede elegir bodega, fijamos ambos filtros a su bodega.
  useEffect(() => {
    if (stockScope && !canPickWarehouse && fixedBodegaId > 0) {
      setBodegaSolicitaId((prev) => (prev === fixedBodegaId ? prev : fixedBodegaId));
      setBodegaDespachoId((prev) => (prev === fixedBodegaId ? prev : fixedBodegaId));
    }
  }, [stockScope, canPickWarehouse, fixedBodegaId]);
  const [dateMode, setDateMode] = useState('PEDIDO');

  // Catálogos
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
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

  // Export
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Cargar catálogos
  useEffect(() => {
    Promise.all([
      catalogosService.getCategorias().catch(() => []),
      catalogosService.getSubcategorias().catch(() => []),
      catalogosService.getBodegas().catch(() => []),
    ]).then(([cats, subs, bgs]) => {
      setCategorias(cats || []);
      setSubcategorias(subs || []);
      setBodegas(bgs || []);
    });
  }, []);

  // Al hacer clic en un preset
  const handlePreset = (days) => {
    setRango(days);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  const handleSearch = () => {
    setCommittedSearch(search);
    setPage(1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Mantener ref actualizada con los filtros (no triggea re-renders).
  // Se actualiza en un efecto (declarado ANTES del efecto de fetch) y no
  // durante el render, que React puede descartar o repetir.
  useEffect(() => {
    filtersRef.current = { dateFrom, dateTo, dateMode, committedSearch, estado, categoriaId, subcategoriaId, bodegaSolicitaId, bodegaDespachoId };
  }, [dateFrom, dateTo, dateMode, committedSearch, estado, categoriaId, subcategoriaId, bodegaSolicitaId, bodegaDespachoId]);

  // Cargar reporte (server-side pagination)
  const fetchData = useCallback(async () => {
    setLoading(true);
    const fetchId = ++fetchIdRef.current;
    try {
      const f = filtersRef.current;
      const params = {
        from: f.dateFrom,
        to: f.dateTo,
        date_mode: f.dateMode,
        limit,
        page,
      };
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.estado) params.estado = f.estado;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.subcategoriaId) params.subcategoria = f.subcategoriaId;
      if (f.bodegaSolicitaId) params.warehouse_requester = f.bodegaSolicitaId;
      if (f.bodegaDespachoId) params.warehouse_dispatch = f.bodegaDespachoId;

      const { data } = await api.get('/api/reportes/pedidos', { params });
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
  }, [page, limit]); // Solo cambia cuando cambia page o limit

  // Re-fetch cuando cambian los filtros (leídos del ref) o la paginación
  useEffect(() => { fetchData(); }, [
    fetchData,
    dateFrom,
    dateTo,
    dateMode,
    committedSearch,
    estado,
    categoriaId,
    subcategoriaId,
    bodegaSolicitaId,
    bodegaDespachoId,
  ]);

  useEffect(() => { setPage(1); }, [committedSearch, estado, categoriaId, subcategoriaId, bodegaSolicitaId, bodegaDespachoId, dateFrom, dateTo, dateMode]);

  // Totales
  const totales = useMemo(() => {
    let totalSolicitado = 0, totalSurtido = 0, totalPendiente = 0, totalCosto = 0;
    for (const g of rows) {
      const lineas = g.lineas || [];
      for (const l of lineas) {
        totalSolicitado += l.cantidad_solicitada;
        totalSurtido += l.cantidad_surtida;
        totalPendiente += l.pendiente;
        totalCosto += l.total_linea;
      }
    }
    return { totalSolicitado, totalSurtido, totalPendiente, totalCosto };
  }, [rows]);

  // Subcategorías filtradas por categoría
  const subcategoriasFiltradas = useMemo(() => {
    if (!categoriaId) return subcategorias;
    return subcategorias.filter((s) => Number(s.id_categoria) === Number(categoriaId));
  }, [subcategorias, categoriaId]);

  // Columnas exportación
  const allExportColumns = [
    { key: 'id_pedido', label: 'Pedido #' },
    { key: 'fecha_pedido', label: 'Fecha Pedido' },
    { key: 'hora_pedido', label: 'Hora' },
    { key: 'estado', label: 'Estado' },
    { key: 'solicitante', label: 'Solicitante' },
    { key: 'bodega_solicitante', label: 'Bodega solicita' },
    { key: 'bodega_despacho', label: 'Bodega despacho' },
    { key: 'usuario_aprobador', label: 'Aprobador' },
    { key: 'fecha_despacho', label: 'Fecha Despacho' },
    { key: 'hora_despacho', label: 'Hora Despacho' },
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_categoria', label: 'Categoría' },
    { key: 'nombre_subcategoria', label: 'Subcategoría' },
    { key: 'cantidad_solicitada', label: 'Solicitado' },
    { key: 'cantidad_surtida', label: 'Surtido' },
    { key: 'pendiente', label: 'Pendiente' },
    { key: 'total_linea', label: 'Total' },
    { key: 'observaciones', label: 'Observaciones' },
  ];

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

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(flatForExport, {
      filename: `reporte_pedidos_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'fecha_pedido')
          return String(row.fecha_pedido || row.creado_en || '').slice(0, 10);
        if (col.key === 'fecha_despacho')
          return String(row.fecha_despacho || row.aprobado_en || '').slice(0, 10);
        if (col.key === 'hora_pedido')
          return row.hora_pedido || String(row.creado_en || '').slice(11, 16);
        if (col.key === 'hora_despacho')
          return row.hora_despacho || String(row.aprobado_en || '').slice(11, 16);
        if (['cantidad_solicitada', 'cantidad_surtida', 'pendiente', 'total_linea'].includes(col.key))
          return Number(row[col.key] || 0).toFixed(2);
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  const [expandedPeds, setExpandedPeds] = useState(new Set());
  const toggleExpand = (id) => {
    setExpandedPeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Header
        title="Reporte de Pedidos"
        subtitle={`${total} pedido${total === 1 ? '' : 's'} · Pág. ${page} de ${totalPages}`}
        actions={
          rows.length > 0 && !loading ? (
            <div className="reporte-pedidos__header-actions">
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

      <div className="reporte-pedidos">
        <Card>
          <div className="reporte-pedidos__filters">
            <SearchInput value={search} onChange={setSearch} onKeyDown={handleKeyDown} onSearch={handleSearch} activeLabel={committedSearch || undefined} placeholder="Buscar producto, SKU o solicitante…" />

            <div className="reporte-pedidos__fecha-group">
              <input type="date" className="input reporte-pedidos__date-input"
                value={dateFrom} max={dateTo}
                onChange={(e) => { setDateFrom(e.target.value); setRango(null); }} />
              <span className="reporte-pedidos__fecha-sep">→</span>
              <input type="date" className="input reporte-pedidos__date-input"
                value={dateTo} min={dateFrom} max={hoy}
                onChange={(e) => { setDateTo(e.target.value); setRango(null); }} />
            </div>

            <div className="reporte-pedidos__rango">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={`rep-pdays-${p.days}`}
                  type="button"
                  className={`reporte-pedidos__rango-btn ${rango === p.days ? 'reporte-pedidos__rango-btn--active' : ''}`}
                  onClick={() => handlePreset(p.days)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <select className="select" value={dateMode} onChange={(e) => setDateMode(e.target.value)}>
              <option value="PEDIDO">Fecha pedido</option>
              <option value="DESPACHO">Fecha despacho</option>
            </select>

            <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              {ESTADOS.map((e) => (
                <option key={`rep-${e}`} value={e}>{e.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <select className="select" value={categoriaId ?? ''} onChange={(e) => { setCategoriaId(e.target.value ? Number(e.target.value) : null); setSubcategoriaId(null); }}>
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={`rep-cat-${c.id_categoria}`} value={c.id_categoria}>{c.nombre_categoria}</option>)}
            </select>

            <select className="select" value={subcategoriaId ?? ''} onChange={(e) => setSubcategoriaId(e.target.value ? Number(e.target.value) : null)} disabled={!categoriaId}>
              <option value="">Todas las subcategorías</option>
              {subcategoriasFiltradas.map((s) => <option key={`rep-sub-${s.id_subcategoria}`} value={s.id_subcategoria}>{s.nombre_subcategoria}</option>)}
            </select>

            {canPickWarehouse ? (
              <select className="select" value={bodegaSolicitaId ?? ''} onChange={(e) => setBodegaSolicitaId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Bodega solicitante (todas)</option>
                {bodegas.map((b) => <option key={`rep-bodsol-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>)}
              </select>
            ) : (
              <div className="reporte-pedidos__bodega-fija" title="Solo puedes ver pedidos donde tu bodega es solicitante o surtidora">
                <span className="reporte-pedidos__bodega-fija-label">Bodega solicitante</span>
                <span className="reporte-pedidos__bodega-fija-value">{fixedBodegaName || `#${fixedBodegaId}`}</span>
              </div>
            )}

            {canPickWarehouse ? (
              <select className="select" value={bodegaDespachoId ?? ''} onChange={(e) => setBodegaDespachoId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Bodega despacho (todas)</option>
                {bodegas.map((b) => <option key={`rep-boddes-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>)}
              </select>
            ) : (
              <div className="reporte-pedidos__bodega-fija" title="Solo puedes ver pedidos donde tu bodega es solicitante o surtidora">
                <span className="reporte-pedidos__bodega-fija-label">Bodega despacho</span>
                <span className="reporte-pedidos__bodega-fija-value">{fixedBodegaName || `#${fixedBodegaId}`}</span>
              </div>
            )}
          </div>
        </Card>

        {loading ? (
          <div className="reporte-pedidos__state"><Spinner size={20} label="Cargando reporte…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="Sin datos" message="No hay pedidos en el período seleccionado." />
        ) : (
          <div className="reporte-pedidos__table-wrapper">
            <table className="table table--sm">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 80 }}>Pedido</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  {!isMobile && <th>Solicitante</th>}
                  <th>B. Solicita</th>
                  {!isMobile && <th>B. Despacho</th>}
                  <th style={{ textAlign: 'right', width: 80 }}>Sol.</th>
                  <th style={{ textAlign: 'right', width: 80 }}>Sur.</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((g) => {
                  const isOpen = expandedPeds.has(g.id_pedido);
                  const sumSol = g.lineas.reduce((a, l) => a + l.cantidad_solicitada, 0);
                  const sumSur = g.lineas.reduce((a, l) => a + l.cantidad_surtida, 0);
                  const sumTotal = g.lineas.reduce((a, l) => a + l.total_linea, 0);
                  const parentRow = (
                    <tr key={`rep-${g.id_pedido}`} className="reporte-pedidos__ped-row">
                      <td>
                        <button type="button" className="reporte-pedidos__expand-btn" onClick={() => toggleExpand(g.id_pedido)}>
                          <span className={`reporte-pedidos__chevron ${isOpen ? 'reporte-pedidos__chevron--open' : ''}`}>▸</span>
                        </button>
                      </td>
                      <td><code>#{g.id_pedido}</code></td>
                      <td className="reporte-pedidos__date">
                        <span>{formatDate(g.fecha_pedido)}</span>
                        {!isMobile && <span className="reporte-pedidos__time">{g.hora_pedido}</span>}
                      </td>
                      <td>
                        <Badge variant={ESTADO_BADGE[g.estado] || 'default'}>
                          {g.estado ? g.estado.replace(/_/g, ' ') : '—'}
                        </Badge>
                      </td>
                      {!isMobile && <td className="reporte-pedidos__user">{g.solicitante || '—'}</td>}
                      <td>{g.bodega_solicitante || '—'}</td>
                      {!isMobile && <td>{g.bodega_despacho || '—'}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumSol.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumSur.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>Q {sumTotal.toFixed(2)}</td>
                    </tr>
                  );
                  const detailRow = isOpen ? (
                    <tr key={`det-${g.id_pedido}`} className="reporte-pedidos__det-row">
                      <td colSpan={isMobile ? 7 : 10}>
                        <div className="reporte-pedidos__detalle">
                          <table className="reporte-pedidos__det-table">
                            <thead>
                              <tr>
                                <th>Producto</th>
                                <th style={{ width: 70 }}>SKU</th>
                                {!isMobile && <th style={{ width: 90 }}>Categoría</th>}
                                <th style={{ width: 70, textAlign: 'right' }}>Sol.</th>
                                <th style={{ width: 70, textAlign: 'right' }}>Sur.</th>
                                <th style={{ width: 70, textAlign: 'right' }}>Pend.</th>
                                <th style={{ width: 90, textAlign: 'right' }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.lineas.map((l) => (
                                <tr key={`rep-${l.id_detalle}`}>
                                  <td>{l.nombre_producto}</td>
                                  <td>{l.sku ? <code>{l.sku}</code> : '—'}</td>
                                  {!isMobile && <td>{l.nombre_categoria || '—'}</td>}
                                  <td style={{ textAlign: 'right' }}>{l.cantidad_solicitada.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right' }}>{l.cantidad_surtida.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right' }}>{l.pendiente.toFixed(2)}</td>
                                  <td style={{ textAlign: 'right' }}>Q {l.total_linea.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem', gap: '0.5rem' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const pedidoParaImprimir = {
                                  id_pedido: g.id_pedido,
                                  creado_en: g.fecha_pedido || g.creado_en,
                                  estado: g.estado,
                                  requester_name: g.solicitante,
                                  requester_warehouse: g.bodega_solicitante,
                                  nombre_bodega_surtidor: g.bodega_despacho,
                                  observaciones: g.observaciones,
                                  lines: g.lineas.map(l => ({
                                    nombre_producto: l.nombre_producto,
                                    cantidad_solicitada: l.cantidad_solicitada,
                                    cantidad_surtida: l.cantidad_surtida,
                                    pendiente: l.pendiente,
                                  })),
                                };
                                printPedidoPos80mm(pedidoParaImprimir, { autoPrint: true });
                              }}
                            >
                              🖨 Imprimir ticket (80mm)
                            </Button>
                          </div>
                          {g.observaciones && <div className="reporte-pedidos__obs">{g.observaciones}</div>}
                          {g.usuario_aprobador && (
                            <div className="reporte-pedidos__obs">
                              Despachado por: {g.usuario_aprobador}
                              {g.fecha_despacho && ` el ${formatDate(g.fecha_despacho)} ${g.hora_despacho || ''}`}
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
                <tr className="reporte-pedidos__total-row">
                  <td colSpan={isMobile ? 5 : 7} style={{ textAlign: 'right', fontWeight: 600 }}>Totales</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{totales.totalSolicitado.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{totales.totalSurtido.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Q {totales.totalCosto.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} loading={loading} />
        )}
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-reporte-pedidos"
        onConfirm={handleExportWithColumns}
      />
    </>
  );
}
