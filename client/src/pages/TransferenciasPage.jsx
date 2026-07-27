import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { LinesEditor } from '@/components/ui/LinesEditor';
import { toast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import api from '@/services/api';
import './TransferenciasPage.scss';

const RANGE_PRESETS = [
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '60 días', days: 60 },
  { label: '90 días', days: 90 },
];

const EMPTY_LINE = {
  id_producto: null,
  nombre_producto: '',
  sku: null,
  cantidad: '',
  lote: '',
};

export default function TransferenciasPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Filtros
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 350);
  const [rango, setRango] = useState(30);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(hace30);
  const [dateTo, setDateTo] = useState(hoy);

  // Datos
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Paginación server-side
  const [page, setPage] = useState(1);
  const limit = 20;
  const fetchIdRef = useRef(0);

  // Export
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // --- Modal de creación ---
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [bodegas, setBodegas] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    id_bodega_origen: '',
    id_bodega_destino: '',
    observaciones: '',
  });
  const [formLines, setFormLines] = useState([{ ...EMPTY_LINE }]);
  const [submitError, setSubmitError] = useState(null);

  const setFormField = (k, v) => setFormData((p) => ({ ...p, [k]: v }));
  const setFormLine = (idx, patch) => {
    setFormLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addFormLine = () => setFormLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeFormLine = (idx) => {
    setFormLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const formTotales = useMemo(() => {
    let total = 0, lineasValidas = 0;
    for (const l of formLines) {
      const c = Number(l.cantidad) || 0;
      if (l.id_producto && c > 0) { total += c; lineasValidas += 1; }
    }
    return { total, lineasValidas };
  }, [formLines]);

  const canSubmitForm =
    formData.id_bodega_origen &&
    formData.id_bodega_destino &&
    Number(formData.id_bodega_origen) !== Number(formData.id_bodega_destino) &&
    formLines.some((l) => l.id_producto && Number(l.cantidad) > 0) &&
    !submitting;

  const openCreateModal = async () => {
    setSubmitError(null);
    setFormData({ id_bodega_origen: '', id_bodega_destino: '', observaciones: '' });
    setFormLines([{ ...EMPTY_LINE }]);
    try {
      const { data } = await api.get('/api/bodegas?all=1');
      setBodegas(Array.isArray(data) ? data : []);
      // Preseleccionar bodega del usuario
      if (Array.isArray(data) && data.length > 0) {
        try {
          const tokenPayload = JSON.parse(atob(localStorage.getItem('token')?.split('.')[1] || '{}'));
          const userWh = Number(tokenPayload?.id_warehouse || 0);
          if (userWh && data.some((b) => Number(b.id_bodega) === userWh)) {
            setFormData((p) => ({ ...p, id_bodega_origen: String(userWh) }));
          }
        } catch {}
      }
    } catch {
      toast.error('No se pudieron cargar bodegas');
    }
    setShowCreateModal(true);
  };

  const handleCreateTransfer = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const payload = {
      id_bodega_origen: Number(formData.id_bodega_origen),
      id_bodega_destino: Number(formData.id_bodega_destino),
      observaciones: formData.observaciones.trim() || null,
      lines: formLines
        .filter((l) => l.id_producto && Number(l.cantidad) > 0)
        .map((l) => ({
          id_producto: l.id_producto,
          cantidad: Number(l.cantidad),
          lote: l.lote.trim() || null,
        })),
    };

    if (payload.lines.length === 0) {
      setSubmitError('Agrega al menos una línea con producto y cantidad mayor a 0.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/api/transferencias', payload);
      toast.success(`Transferencia #${data.id_movimiento} creada (${data.total_lineas} líneas)`);
      setShowCreateModal(false);
      fetchData();
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo crear la transferencia';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const formColumns = [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      minWidth: 240,
      render: (l, idx) => (
        <ProductPicker
          value={l.id_producto ? { id_producto: l.id_producto, nombre_producto: l.nombre_producto, sku: l.sku } : null}
          onChange={(p) => setFormLine(idx, {
            id_producto: p?.id_producto || null,
            nombre_producto: p?.nombre_producto || '',
            sku: p?.sku || null,
          })}
          placeholder="Buscar producto…"
        />
      ),
    },
    {
      key: 'cantidad',
      label: 'Cantidad',
      width: 100,
      render: (l, idx) => (
        <input
          type="number"
          className="input transferencias-page__num"
          min="0"
          step="0.001"
          value={l.cantidad}
          onChange={(e) => setFormLine(idx, { cantidad: e.target.value })}
          placeholder="0"
        />
      ),
    },
    {
      key: 'lote',
      label: 'Lote',
      width: 120,
      render: (l, idx) => (
        <input
          type="text"
          className="input transferencias-page__text"
          value={l.lote}
          onChange={(e) => setFormLine(idx, { lote: e.target.value })}
          placeholder="Opcional"
        />
      ),
    },
  ];

  // --- Fin modal ---

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
      const { data } = await api.get('/api/reportes/transferencias', { params });
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
        toast.error('Error al cargar transferencias');
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo, page, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { setPage(1); }, [dateFrom, dateTo]);

  // Filtro client-side sobre los datos de la página actual
  const filtered = useMemo(() => {
    if (!debouncedSearch) return rows;
    const q = debouncedSearch.toLowerCase();
    return rows.filter((g) =>
      g.bodega_origen?.toLowerCase().includes(q) ||
      g.bodega_destino?.toLowerCase().includes(q) ||
      (g.lineas || []).some((l) =>
        l.nombre_producto?.toLowerCase().includes(q) ||
        l.sku?.toLowerCase().includes(q)
      )
    );
  }, [rows, debouncedSearch]);

  const displayRows = filtered;

  const totales = useMemo(() => {
    let totalCantidad = 0, totalCosto = 0;
    for (const g of displayRows) {
      const lineas = g.lineas || [];
      for (const l of lineas) {
        totalCantidad += l.cantidad;
        totalCosto += l.total_linea;
      }
    }
    return { totalCantidad, totalCosto };
  }, [displayRows]);

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

  const allExportColumns = [
    { key: 'id_movimiento', label: 'ID' },
    { key: 'fecha', label: 'Fecha' },
    { key: 'hora', label: 'Hora' },
    { key: 'bodega_origen', label: 'Origen' },
    { key: 'bodega_destino', label: 'Destino' },
    { key: 'usuario_creador', label: 'Usuario' },
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'lote', label: 'Lote' },
    { key: 'fecha_vencimiento', label: 'Vencimiento' },
    { key: 'cantidad', label: 'Cantidad' },
    { key: 'total_linea', label: 'Total' },
    { key: 'observaciones', label: 'Observaciones' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(flatForExport, {
      filename: `transferencias_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'fecha') return String(row.creado_en || row.fecha || '').slice(0, 10);
        if (col.key === 'hora') return String(row.creado_en || '').slice(11, 16);
        if (col.key === 'fecha_vencimiento' && row.fecha_vencimiento) return String(row.fecha_vencimiento).slice(0, 10);
        if (['cantidad', 'costo_unitario', 'total_linea'].includes(col.key)) return Number(row[col.key] || 0).toFixed(2);
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  const [expanded, setExpanded] = useState(new Set());
  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- Navegación entre reversiones ---
  const tableRef = useRef(null);

  // Mapa: id_original → id_reversion  y  id_reversion → id_original
  const revertLinks = useMemo(() => {
    const originalToRev = {};
    const revToOriginal = {};
    for (const g of rows) {
      const obs = g.observaciones || '';
      const match = obs.match(/REVERSIÓN de #(\d+)/);
      if (match) {
        const origId = Number(match[1]);
        revToOriginal[g.id_movimiento] = origId;
        originalToRev[origId] = g.id_movimiento;
      }
    }
    return { originalToRev, revToOriginal };
  }, [rows]);

  const goToMovimiento = (id) => {
    // Expandir el target
    setExpanded((prev) => {
      if (!prev.has(id)) {
        const next = new Set(prev);
        next.add(id);
        return next;
      }
      return prev;
    });
    // Scroll
    setTimeout(() => {
      const row = tableRef.current?.querySelector(`[data-mov-id="${id}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // --- Estado de reversión en progreso ---
  const [revertingId, setRevertingId] = useState(null);

  const handleRevert = async (idMovimiento) => {
    if (revertingId) return;
    if (!window.confirm(`¿Crear transferencia inversa para revertir el movimiento #${idMovimiento}?\n\nSe creará un nuevo movimiento con las bodegas intercambiadas.`)) {
      return;
    }
    setRevertingId(idMovimiento);
    try {
      const { data } = await api.post(`/api/transferencias/${idMovimiento}/revert`);
      toast.success(`Reversión creada (movimiento #${data.id_movimiento})`);
      fetchData();
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo revertir la transferencia';
      toast.error(msg);
    } finally {
      setRevertingId(null);
    }
  };

  const bodegaOptions = [
    { value: '', label: 'Seleccionar bodega…' },
    ...bodegas
      .filter((b) => Number(b.activo || 0) === 1)
      .map((b) => ({ value: String(b.id_bodega), label: b.nombre_bodega })),
  ];

  // Destino: solo bodegas activas que manejan stock, pueden recibir y son distintas al origen
  const destinoBodegaOptions = useMemo(() => {
    const origenId = Number(formData.id_bodega_origen || 0);
    return [
      { value: '', label: 'Seleccionar bodega destino…' },
      ...bodegas
        .filter((b) =>
          Number(b.activo || 0) === 1 &&
          Number(b.id_bodega) !== origenId &&
          Number(b.maneja_stock || 0) === 1 &&
          Number(b.puede_recibir || 0) === 1
        )
        .map((b) => ({
          value: String(b.id_bodega),
          label: `${b.nombre_bodega}${b.tipo_bodega ? ` (${b.tipo_bodega})` : ''}`,
        })),
    ];
  }, [bodegas, formData.id_bodega_origen]);

  return (
    <>
      <Header
        title="Transferencias"
        subtitle={`${total} transferencia${total === 1 ? '' : 's'} · Pág. ${page} de ${totalPages} · ${totales.totalCantidad.toFixed(2)} unidades`}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="primary" size="sm" onClick={openCreateModal}>+ Nueva transferencia</Button>
            {rows.length > 0 && !loading && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>Exportar</Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>Refrescar</Button>
          </div>
        }
      />

      <div className="transferencias-page">
        <Card>
          <div className="transferencias-page__filters">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar producto, SKU, origen o destino…" />
            <div className="transferencias-page__fecha-group">
              <input type="date" className="input" value={dateFrom} max={dateTo}
                onChange={(e) => { setDateFrom(e.target.value); setRango(null); }} />
              <span className="transferencias-page__sep">→</span>
              <input type="date" className="input" value={dateTo} min={dateFrom} max={hoy}
                onChange={(e) => { setDateTo(e.target.value); setRango(null); }} />
            </div>
            <div className="transferencias-page__rango">
              {RANGE_PRESETS.map((p) => (
                <button key={`tra-pdays-${p.days}`} type="button"
                  className={`transferencias-page__rango-btn ${rango === p.days ? 'transferencias-page__rango-btn--active' : ''}`}
                  onClick={() => handlePreset(p.days)}>{p.label}</button>
              ))}
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="transferencias-page__state"><Spinner size={20} label="Cargando transferencias…" /></div>
        ) : displayRows.length === 0 ? (
          <EmptyState icon="🔄" title="Sin datos" message="No hay transferencias en el período seleccionado." />
        ) : (
          <div className="transferencias-page__table-wrapper" ref={tableRef}>
            <table className="table table--sm">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 80 }}>#</th>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  {!isMobile && <th>Usuario</th>}
                  <th style={{ textAlign: 'right', width: 90 }}>Cant.</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.flatMap((g) => {
                  const isOpen = expanded.has(g.id_movimiento);
                  const sumCant = g.lineas.reduce((a, l) => a + l.cantidad, 0);
                  const sumTotal = g.lineas.reduce((a, l) => a + l.total_linea, 0);
                  return [
                    <tr key={`tra-${g.id_movimiento}`} data-mov-id={g.id_movimiento} className="transferencias-page__mov-row">
                      <td>
                        <button type="button" className="transferencias-page__expand-btn" onClick={() => toggleExpand(g.id_movimiento)}>
                          <span className={`transferencias-page__chevron ${isOpen ? 'transferencias-page__chevron--open' : ''}`}>▸</span>
                        </button>
                      </td>
                      <td>
                        <div className="transferencias-page__id-cell">
                          <code>#{g.id_movimiento}</code>
                          {(() => {
                            const match = (g.observaciones || '').match(/REVERSIÓN de #(\d+)/);
                            if (match) {
                              const origId = Number(match[1]);
                              return (
                                <button
                                  type="button"
                                  className="transferencias-page__reverted-link"
                                  onClick={() => goToMovimiento(origId)}
                                  title={`Ir al movimiento original #${origId}`}
                                >
                                  Revertida ← #{origId}
                                </button>
                              );
                            }
                            const revId = revertLinks.originalToRev[g.id_movimiento];
                            if (revId) {
                              return (
                                <button
                                  type="button"
                                  className="transferencias-page__reverted-link transferencias-page__reverted-link--orig"
                                  onClick={() => goToMovimiento(revId)}
                                  title={`Ir a la reversión #${revId}`}
                                >
                                  → Rev. #{revId}
                                </button>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </td>
                      <td className="transferencias-page__date">
                        <span>{formatDate(g.fecha)}</span>
                        {!isMobile && <span className="transferencias-page__time">{g.hora}</span>}
                      </td>
                      <td><Badge variant="info">{g.bodega_origen || '—'}</Badge></td>
                      <td><Badge variant="success">{g.bodega_destino || '—'}</Badge></td>
                      {!isMobile && <td className="transferencias-page__user">{g.usuario_creador || '—'}</td>}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumCant.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>Q {sumTotal.toFixed(2)}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`det-${g.id_movimiento}`} className="transferencias-page__det-row">
                        <td colSpan={isMobile ? 6 : 8}>
                          <div className="transferencias-page__detalle">
                            <table className="transferencias-page__det-table">
                              <thead>
                                <tr>
                                  <th>Producto</th>
                                  <th style={{ width: 70 }}>SKU</th>
                                  <th style={{ width: 80 }}>Lote</th>
                                  <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
                                  <th style={{ width: 90, textAlign: 'right' }}>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.lineas.map((l) => (
                                  <tr key={`tra-${l.id_detalle}`}>
                                    <td>{l.nombre_producto}</td>
                                    <td>{l.sku ? <code>{l.sku}</code> : '—'}</td>
                                    <td>{l.lote || '—'}</td>
                                    <td style={{ textAlign: 'right' }}>{l.cantidad.toFixed(2)}</td>
                                    <td style={{ textAlign: 'right' }}>Q {l.total_linea.toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {g.observaciones && <div className="transferencias-page__obs">{g.observaciones}</div>}
                            <div className="transferencias-page__det-actions">
                              <button
                                type="button"
                                className="transferencias-page__revert-btn"
                                onClick={() => handleRevert(g.id_movimiento)}
                                disabled={revertingId !== null}
                                title={revertingId === g.id_movimiento ? 'Revirtiendo…' : 'Crear transferencia inversa para revertir esta operación'}
                              >
                                {revertingId === g.id_movimiento ? (
                                  <><Spinner size={12} /> Revirtiendo…</>
                                ) : (
                                  <>↩ Revertir</>
                                )}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ].filter(Boolean);
                })}
              </tbody>
              <tfoot>
                <tr className="transferencias-page__total-row">
                  <td colSpan={isMobile ? 4 : 6} style={{ textAlign: 'right', fontWeight: 600 }}>Totales</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{totales.totalCantidad.toFixed(2)}</td>
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

      {/* Modal de nueva transferencia */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva transferencia"
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setShowCreateModal(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCreateTransfer} disabled={!canSubmitForm}>
              {submitting ? <Spinner size={14} /> : `Transferir${formTotales.lineasValidas ? ` (${formTotales.lineasValidas})` : ''}`}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateTransfer} className="transferencias-page__form">
          {submitError && <div className="transferencias-page__form-error">{submitError}</div>}

          <div className="transferencias-page__form-section">
            <h3 className="transferencias-page__form-section-title">Bodegas</h3>
            <div className="transferencias-page__form-row">
              <Select
                label="Bodega origen"
                value={formData.id_bodega_origen}
                onChange={(e) => {
                  const newOrigen = e.target.value;
                  setFormField('id_bodega_origen', newOrigen);
                  // Si el destino actual es el mismo que el nuevo origen, limpiarlo
                  if (newOrigen && formData.id_bodega_destino === newOrigen) {
                    setFormField('id_bodega_destino', '');
                  }
                }}
                options={bodegaOptions}
                required
              />
              <Select
                label="Bodega destino"
                value={formData.id_bodega_destino}
                onChange={(e) => setFormField('id_bodega_destino', e.target.value)}
                options={destinoBodegaOptions}
                required
                disabled={!formData.id_bodega_origen}
              />
            </div>
            {formData.id_bodega_origen && destinoBodegaOptions.length <= 1 && (
              <div className="transferencias-page__form-warning">
                No hay bodegas disponibles que puedan recibir transferencias.
              </div>
            )}
            <Input
              label="Observaciones"
              value={formData.observaciones}
              onChange={(e) => setFormField('observaciones', e.target.value)}
              placeholder="Notas adicionales (opcional)"
            />
          </div>

          <div className="transferencias-page__form-section">
            <h3 className="transferencias-page__form-section-title">Productos</h3>
            <LinesEditor
              lines={formLines}
              columns={formColumns}
              onAdd={addFormLine}
              onRemove={removeFormLine}
              canRemove={() => formLines.length > 1}
              addLabel="+ Agregar producto"
              renderFooter={() => (
                <tr>
                  <td colSpan={1} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {formTotales.total.toFixed(2)}
                  </td>
                  <td></td>
                </tr>
              )}
            />
          </div>
        </form>
      </Modal>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-transferencias"
        onConfirm={handleExportWithColumns}
      />
    </>
  );
}
