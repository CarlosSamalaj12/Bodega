import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataList } from '@/components/ui/DataList';
import { SearchInput } from '@/components/ui/SearchInput';
import { toast } from '@/components/ui/Toast';

import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { PinModal } from '@/components/ui/PinModal';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import api from '@/services/api';
import './CorteDiarioPage.scss';

export default function CorteDiarioPage() {
  const [searchParams] = useSearchParams();

  // Filtros — búsqueda diferida (Enter o botón Buscar)
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const initialWarehouse = searchParams.get('warehouse');
  const [warehouseId, setWarehouseId] = useState(initialWarehouse ? Number(initialWarehouse) : null);
  const [showAll, setShowAll] = useState(false);

  // Catálogos
  const [bodegas, setBodegas] = useState([]);

  const user = useAuthStore((s) => s.user);
  const permisos = useMemo(() => user?.permisos || {}, [user]);
  const canCierre = hasPermission(permisos, 'action.create_update');

  // Datos
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Conteo final del día (para bodegas con permite_salida_conteo_final)
  const [conteosFinales, setConteosFinales] = useState({}); // { [id_producto]: cantidad }
  const [editingConteo, setEditingConteo] = useState(null);

  // Cierre del día
  const [cierreStatus, setCierreStatus] = useState(null); // null | { today_closed, yesterday_closed, ... }
  const [cierreModalOpen, setCierreModalOpen] = useState(false);
  const [cierreConfirming, setCierreConfirming] = useState(false);

  // PIN de supervisor
  const [pinRequired, setPinRequired] = useState(false);
  const [pinConfirming, setPinConfirming] = useState(false);

  // Export
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Cargar bodegas
  useEffect(() => {
    catalogosService.getBodegas().then(setBodegas).catch(() => {});
  }, []);

  // Cargar reporte
  const handleSearch = () => {
    setCommittedSearch(search);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const fetchData = useCallback(async () => {
    if (!cierreStatus) return;
    setLoading(true);
    try {
      const params = { limit: 2000 };
      if (committedSearch) params.q = committedSearch;
      if (warehouseId) params.warehouse = warehouseId;
      if (showAll) params.show_all = 1;

      if (cierreStatus?.pending_yesterday_close) {
        params.fecha = cierreStatus.ayer;
      } else {
        params.fecha = cierreStatus.hoy;
      }

      const { data: res } = await api.get('/api/reportes/corte-diario', { params });
      setData(res);
    } catch (e) {
      toast.error('Error al cargar el corte diario');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [committedSearch, warehouseId, showAll, cierreStatus]);

  // Consultar estado del cierre al montar y tras refrescar
  const fetchCierreStatus = useCallback(async () => {
    try {
      const { data: st } = await api.get('/api/cierre-dia/estado');
      setCierreStatus(st);
    } catch {
      // Silencioso — el reporte funciona sin esto
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchCierreStatus(); }, [fetchCierreStatus]);

  // Limpiar conteos finales cuando cambian los datos (nueva bodega o refrescar)
  useEffect(() => {
    setConteosFinales({});
    setEditingConteo(null);
  }, [data?.bodega, data?.fecha_hoy]);

  // Handler para cambiar el conteo final
  const handleConteoFinalChange = (id_producto, value) => {
    const num = value === '' ? null : Number(value);
    // Bloquear valores negativos a nivel de handler
    if (num !== null && num < 0) {
      toast.error('El conteo final no puede ser negativo');
      return;
    }
    setConteosFinales(prev => ({
      ...prev,
      [id_producto]: num
    }));
    setEditingConteo(null);
  };

  // Mensaje de error para un conteo inválido
  const getConteoErrorMsg = (row) => {
    const conteo = conteosFinales[row.id_producto];
    if (conteo == null) return null;
    if (conteo < 0) return 'No puede ser negativo';
    if (conteo > Number(row.existencia_actual)) return `No puede exceder exist. actual (${Number(row.existencia_actual).toFixed(2)})`;
    return null;
  };

  // rows se define aquí para que esté disponible antes de los useMemo que lo usan
  const rows = data?.rows || [];

  // Contar productos con errores
  const conteosConError = useMemo(() => {
    if (!data?.permite_salida_conteo_final) return 0;
    return rows.filter(r => getConteoErrorMsg(r) !== null).length;
  }, [rows, conteosFinales, data]);

  // Construir payload de conteosFinales para enviar al backend al cerrar.
  // Solo se incluyen productos con un conteo válido y que tengan diferencia
  // (los que el helper vaya a procesar). Si la bodega no usa conteo final,
  // devuelve [] y el backend no hace nada.
  const conteosFinalesPayload = useMemo(() => {
    if (!data?.permite_salida_conteo_final) return [];
    return rows
      .filter((r) => {
        const c = conteosFinales[r.id_producto];
        return c != null && Number.isFinite(Number(c)) && !getConteoErrorMsg(r);
      })
      .map((r) => ({
        id_producto: Number(r.id_producto),
        existencia_final: Number(conteosFinales[r.id_producto]),
      }));
  }, [rows, conteosFinales, data]);

  // Verificar antes de cerrar
  const handleCerrarDia = useCallback(async () => {
    if (!cierreStatus || cierreStatus.today_closed) return;

    // Si hay conteos inválidos, no permitir cerrar
    if (data?.permite_salida_conteo_final && conteosConError > 0) {
      toast.error(`Hay ${conteosConError} producto(s) con conteo inválido. Corrige los valores antes de cerrar.`);
      return;
    }

    setCierreModalOpen(true);
  }, [cierreStatus, data, conteosConError]);

  const handleCierreConfirm = useCallback(async () => {
    setCierreConfirming(true);
    try {
      const { data: res } = await api.post('/api/cierre-dia', {
        confirmar: 1,
        fecha: cierreStatus?.pending_yesterday_close ? cierreStatus.ayer : cierreStatus?.hoy,
        conteosFinales: conteosFinalesPayload,
      });
      const msg = res?.conteo_final
        ? `Cierre realizado. Salida automática por conteo final: ${res.conteo_final.total_salida} unidades (mov #${res.conteo_final.id_movimiento}).`
        : (res?.message || 'Cierre del día realizado correctamente');
      toast.success(msg);
      setCierreModalOpen(false);
      // Limpiar conteos locales para que no se arrastren al siguiente día
      setConteosFinales({});
      // Refrescar todo
      await Promise.all([fetchData(), fetchCierreStatus()]);
    } catch (e) {
      const errData = e?.response?.data;
      // Si el servidor pide PIN de supervisor
      if (errData?.code === 'SUPERVISOR_PIN_REQUIRED') {
        setCierreModalOpen(false);
        setPinRequired(true);
        return;
      }
      const msg = errData?.error || 'No se pudo realizar el cierre del día';
      toast.error(msg);
    } finally {
      setCierreConfirming(false);
    }
  }, [fetchData, fetchCierreStatus, cierreStatus, conteosFinalesPayload]);

  const handlePinConfirm = useCallback(async (pin) => {
    setPinConfirming(true);
    try {
      const { data: res } = await api.post('/api/cierre-dia', {
        confirmar: 1,
        supervisor_pin: pin,
        fecha: cierreStatus?.pending_yesterday_close ? cierreStatus.ayer : cierreStatus?.hoy,
        conteosFinales: conteosFinalesPayload,
      });
      const msg = res?.conteo_final
        ? `Cierre realizado. Salida automática por conteo final: ${res.conteo_final.total_salida} unidades (mov #${res.conteo_final.id_movimiento}).`
        : (res?.message || 'Cierre del día realizado correctamente');
      toast.success(msg);
      setPinRequired(false);
      setConteosFinales({});
      await Promise.all([fetchData(), fetchCierreStatus()]);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo realizar el cierre del día';
      toast.error(msg);
    } finally {
      setPinConfirming(false);
    }
  }, [fetchData, fetchCierreStatus, cierreStatus, conteosFinalesPayload]);

  // Totales
  const totales = useMemo(() => {
    let exAyer = 0, entHoy = 0, salHoy = 0, exActual = 0;
    for (const r of rows) {
      exAyer += Number(r.existencia_ayer || 0);
      entHoy += Number(r.entradas_hoy || 0);
      salHoy += Number(r.salidas_hoy || 0);
      exActual += Number(r.existencia_actual || 0);
    }
    // Si la bodega usa modo conteo final: salidas = existencia_ayer + entradas - existencia_actual
    const salHoyPorConteo = data?.permite_salida_conteo_final
      ? exAyer + entHoy - exActual
      : salHoy;
    return { exAyer, entHoy, salHoy, salHoyPorConteo, exActual };
  }, [rows, data]);

  const hasActiveFilters = committedSearch || warehouseId || showAll;

  const handleClearFilters = () => {
    setSearch('');
    setCommittedSearch('');
    setWarehouseId(null);
    setShowAll(false);
  };

  // Helper para cantidad formateada
  const fmtNum = (val) => Number(val || 0).toFixed(2);

  // Columnas de la tabla
  const columns = useMemo(() => [
    {
      key: 'nombre_producto',
      label: 'Producto',
      primary: true,
      width: 240,
      render: (r) => (
        <div className="corte-diario__producto">
          <span className="corte-diario__prod-name">{r.nombre_producto}</span>
          {r.sku && <code className="corte-diario__prod-sku">{r.sku}</code>}
        </div>
      ),
      cardMeta: (r) => r.sku ? <code className="corte-diario__prod-sku">{r.sku}</code> : null,
    },
    {
      key: 'existencia_ayer',
      label: 'Exist. Ayer',
      width: 100,
      align: 'right',
      render: (r) => <span className="corte-diario__qty">{fmtNum(r.existencia_ayer)}</span>,
    },
    {
      key: 'entradas_hoy',
      label: 'Entradas Hoy',
      width: 100,
      align: 'right',
      render: (r) => <span className="corte-diario__qty corte-diario__qty--pos">+{fmtNum(r.entradas_hoy)}</span>,
    },
    {
      key: 'salidas_hoy',
      label: 'Salidas Hoy',
      width: 100,
      align: 'right',
      render: (r) => <span className="corte-diario__qty corte-diario__qty--neg">−{fmtNum(r.salidas_hoy)}</span>,
    },
    {
      key: 'existencia_actual',
      label: 'Exist. Actual',
      width: 110,
      align: 'right',
      render: (r) => <span className="corte-diario__qty corte-diario__qty--current">{fmtNum(r.existencia_actual)}</span>,
    },
    // Columna de Conteo Final (solo para bodegas con permite_salida_conteo_final)
    ...(data?.permite_salida_conteo_final ? [{
      key: 'conteo_final',
      label: 'Conteo Final',
      width: 140,
      align: 'right',
      render: (r) => {
        const conteo = conteosFinales[r.id_producto];
        const diff = conteo != null ? (Number(r.existencia_actual) - conteo) : null;
        const isEditing = editingConteo === r.id_producto;
        const errMsg = getConteoErrorMsg(r);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            {isEditing ? (
              <input
                type="number"
                className="input"
                step="0.001"
                min="0"
                autoFocus
                defaultValue={conteo != null ? conteo : ''}
                placeholder="—"
                onBlur={(e) => handleConteoFinalChange(r.id_producto, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConteoFinalChange(r.id_producto, e.target.value);
                  if (e.key === 'Escape') setEditingConteo(null);
                }}
                style={{
                  width: '110px',
                  textAlign: 'right',
                  padding: '5px 8px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  fontWeight: '700',
                  color: '#1a1a1a',
                  background: '#ffffff',
                  border: '2px solid #6f42c1',
                  borderRadius: '6px',
                  outline: 'none',
                }}
              />
            ) : (
              <span
                onClick={() => setEditingConteo(r.id_producto)}
                style={{
                  cursor: 'pointer',
                  minWidth: '110px',
                  textAlign: 'right',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: `2px ${conteo != null ? 'solid' : 'dashed'} ${errMsg ? '#dc3545' : conteo != null ? '#6f42c1' : '#555'}`,
                  background: errMsg ? '#fff5f5' : conteo != null ? '#f5f0ff' : 'transparent',
                  display: 'block',
                  fontFamily: 'monospace',
                  fontWeight: '700',
                  fontSize: '14px',
                  color: errMsg ? '#dc3545' : conteo != null ? '#1a1a1a' : '#888',
                }}
                title="Clic para ingresar conteo físico"
              >
                {conteo != null ? fmtNum(conteo) : '—'}
              </span>
            )}
            {errMsg ? (
              <span style={{ fontSize: '10px', color: '#dc3545', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                ⚠ {errMsg}
              </span>
            ) : diff != null ? (
              <span style={{
                fontSize: '11px',
                color: diff > 0 ? '#28a745' : diff < 0 ? '#dc3545' : '#666',
                fontWeight: 'bold',
                fontFamily: 'monospace',
              }}>
                {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
              </span>
            ) : null}
          </div>
        );
      },
    }] : []),
  ], [data, conteosFinales, editingConteo]);

  // Columnas para exportación
  const allExportColumns = [
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'existencia_ayer', label: 'Existencia Ayer' },
    { key: 'entradas_hoy', label: 'Entradas Hoy' },
    { key: 'salidas_hoy', label: 'Salidas Hoy' },
    { key: 'existencia_actual', label: 'Existencia Actual' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(rows, {
      filename: `corte_diario_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (['existencia_ayer', 'entradas_hoy', 'salidas_hoy', 'existencia_actual'].includes(col.key)) {
          return Number(row[col.key] || 0).toFixed(2);
        }
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  return (
    <>
      <Header
        title="Corte Diario"
        subtitle={
          data
            ? `${data.bodega || 'Todas las bodegas'} · ${formatDate(data.fecha_hoy)} · ${rows.length} producto${rows.length === 1 ? '' : 's'}`
            : 'Cargando…'
        }
        actions={
          <div className="corte-diario__header-actions">
            {canCierre && cierreStatus && !cierreStatus.today_closed && (
              <Button size="sm" variant="primary" onClick={handleCerrarDia}>
                🔒 Cerrar día
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={loading} onClick={fetchData}>
              ↻ Refrescar
            </Button>
            {rows.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar
              </Button>
            )}
          </div>
        }
      />

      <div className="corte-diario">
        {/* Filtros */}
        <Card compact>
          <div className="corte-diario__filters">
            <div className="corte-diario__search-box">
              <SearchInput value={search} onChange={setSearch} onKeyDown={handleKeyDown} onSearch={handleSearch} activeLabel={committedSearch || undefined} placeholder="Buscar producto o SKU…" />
            </div>
            <div className="corte-diario__filter-controls">
              <select
                className="select"
                value={warehouseId ?? ''}
                onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Todas las bodegas</option>
                {bodegas.map((b) => (
                  <option key={`cor-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>
                ))}
              </select>
              <label className="corte-diario__toggle">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                <span>Mostrar todos</span>
              </label>
              {hasActiveFilters && (
                <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                  Limpiar
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Cards de resumen */}
        <div className="corte-diario__metrics">
          <Card compact className="corte-diario__metric-card">
            <span className="corte-diario__metric-label">Existencia Ayer</span>
            <span className="corte-diario__metric-value">{fmtNum(totales.exAyer)}</span>
          </Card>
          <Card compact className="corte-diario__metric-card corte-diario__metric-card--success">
            <span className="corte-diario__metric-label">Entradas Hoy</span>
            <span className="corte-diario__metric-value">+{fmtNum(totales.entHoy)}</span>
          </Card>
          <Card compact className="corte-diario__metric-card corte-diario__metric-card--danger">
            <span className="corte-diario__metric-label">Salidas Hoy</span>
            <span className="corte-diario__metric-value">−{fmtNum(totales.salHoy)}</span>
          </Card>
          <Card compact className="corte-diario__metric-card corte-diario__metric-card--accent">
            <span className="corte-diario__metric-label">Existencia Actual</span>
            <span className="corte-diario__metric-value">{fmtNum(totales.exActual)}</span>
          </Card>
          {data?.permite_salida_conteo_final && (
            <Card compact className="corte-diario__metric-card" style={{ borderLeft: '3px solid #6f42c1' }}>
              <span className="corte-diario__metric-label">Salida x Conteo</span>
              <span className="corte-diario__metric-value" style={{ color: '#6f42c1' }}>
                {totales.salHoyPorConteo != null ? `−${fmtNum(totales.salHoyPorConteo)}` : '—'}
              </span>
            </Card>
          )}
        </div>

        {/* Tabla de datos */}
        <Card>
          <DataList
            columns={columns}
            rows={rows}
            loading={loading}
            keyField="id_producto"
            density="sm"
            rowClass={(r) => {
              if (!data?.permite_salida_conteo_final) return undefined;
              if (getConteoErrorMsg(r)) return 'corte-diario__row--error';
              return undefined;
            }}
            emptyTitle="Sin movimientos"
            emptyMessage="No hay productos con movimiento en el período seleccionado."
            emptyIcon="◷"
          />
        </Card>

        {/* Info */}
        <Card title="¿Cómo funciona?" subtitle="Resumen de existencias diarias">
          <ol className="corte-diario__steps">
            <li><strong>Existencia Ayer</strong> — Stock al cierre del día anterior.</li>
            <li><strong>Entradas Hoy</strong> — Total de unidades que ingresaron hoy.</li>
            <li><strong>Salidas Hoy</strong> — Total de unidades que salieron hoy.</li>
            <li><strong>Existencia Actual</strong> — Stock disponible: <em>Existencia Ayer + Entradas − Salidas</em>.</li>
            {data?.permite_salida_conteo_final && (
              <li><strong>Conteo Final</strong> — Ingresa la cantidad contada físicamente. La <em>Salida por Conteo</em> se calcula como: <em>Existencia Actual − Conteo Final</em>. Haz clic en una celda para editarla.</li>
            )}
          </ol>
        </Card>
      </div>

      {/* Modal de confirmación de cierre */}
      <Modal
        open={cierreModalOpen}
        onClose={() => !cierreConfirming && setCierreModalOpen(false)}
        title="Cerrar el día"
        size="sm"
      >
        <div className="corte-diario__cierre-modal">
          {data?.permite_salida_conteo_final && conteosConError > 0 && (
            <div style={{
              padding: '12px',
              background: '#fff0f0',
              border: '1px solid #dc3545',
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <strong style={{ color: '#dc3545' }}>⚠ Hay conteos inválidos</strong>
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#721c24' }}>
                {conteosConError} producto(s) tienen un conteo final menor a 0. Estos productos se muestran resaltados en rojo en la tabla.
              </p>
            </div>
          )}
          <p>
            <strong>¿Estás seguro de realizar el cierre del día?</strong>
          </p>
          <p>Este proceso no podrá revertirse. Una vez cerrado el día:</p>
          <ul>
            <li>Se registrarán las existencias finales de todos los productos.</li>
            <li>No se podrán modificar movimientos de esta fecha.</li>
            <li>Se generará el corte oficial del día.</li>
          </ul>
          {cierreStatus && (
            <div className="corte-diario__cierre-resumen">
              <span><strong>Fecha:</strong> {formatDate(cierreStatus.pending_yesterday_close ? cierreStatus.ayer : cierreStatus.hoy)}</span>
              <span><strong>Bodega:</strong> {cierreStatus.id_bodega}</span>
              <span><strong>Productos:</strong> {rows.length}</span>
              <span><strong>Existencia final:</strong> {fmtNum(totales.exActual)}</span>
            </div>
          )}
          <div className="corte-diario__cierre-actions">
            <Button variant="ghost" disabled={cierreConfirming} onClick={() => setCierreModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={cierreConfirming || (data?.permite_salida_conteo_final && conteosConError > 0)}
              onClick={handleCierreConfirm}
            >
              {cierreConfirming ? 'Cerrando…' : 'Sí, cerrar día'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Selector de columnas para exportación */}
      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-corte-diario"
        onConfirm={handleExportWithColumns}
      />

      {/* Modal de PIN de supervisor */}
      <PinModal
        open={pinRequired}
        title="Cierre del día"
        description="Se requiere un PIN de supervisor para autorizar el cierre del día."
        submitting={pinConfirming}
        onConfirm={handlePinConfirm}
        onCancel={() => setPinRequired(false)}
      />
    </>
  );
}
