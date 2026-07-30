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
    setLoading(true);
    try {
      const params = { limit: 2000 };
      if (committedSearch) params.q = committedSearch;
      if (warehouseId) params.warehouse = warehouseId;
      if (showAll) params.show_all = 1;

      const { data: res } = await api.get('/api/reportes/corte-diario', { params });
      setData(res);
    } catch (e) {
      toast.error('Error al cargar el corte diario');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [committedSearch, warehouseId, showAll]);

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

  const handleCerrarDia = useCallback(async () => {
    if (!cierreStatus || cierreStatus.today_closed) return;
    setCierreModalOpen(true);
  }, [cierreStatus]);

  const handleCierreConfirm = useCallback(async () => {
    setCierreConfirming(true);
    try {
      const { data: res } = await api.post('/api/cierre-dia', {
        confirmar: 1,
      });
      toast.success(res?.message || 'Cierre del día realizado correctamente');
      setCierreModalOpen(false);
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
  }, [fetchData, fetchCierreStatus]);

  const handlePinConfirm = useCallback(async (pin) => {
    setPinConfirming(true);
    try {
      const { data: res } = await api.post('/api/cierre-dia', {
        confirmar: 1,
        supervisor_pin: pin,
      });
      toast.success(res?.message || 'Cierre del día realizado correctamente');
      setPinRequired(false);
      await Promise.all([fetchData(), fetchCierreStatus()]);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo realizar el cierre del día';
      toast.error(msg);
    } finally {
      setPinConfirming(false);
    }
  }, [fetchData, fetchCierreStatus]);

  const rows = data?.rows || [];

  // Totales
  const totales = useMemo(() => {
    let exAyer = 0, entHoy = 0, salHoy = 0, exActual = 0;
    for (const r of rows) {
      exAyer += Number(r.existencia_ayer || 0);
      entHoy += Number(r.entradas_hoy || 0);
      salHoy += Number(r.salidas_hoy || 0);
      exActual += Number(r.existencia_actual || 0);
    }
    return { exAyer, entHoy, salHoy, exActual };
  }, [rows]);

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
  ], []);

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
        </div>

        {/* Tabla de datos */}
        <Card>
          <DataList
            columns={columns}
            rows={rows}
            loading={loading}
            keyField="id_producto"
            density="sm"
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
              <span><strong>Fecha:</strong> {formatDate(cierreStatus.hoy)}</span>
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
              disabled={cierreConfirming}
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
