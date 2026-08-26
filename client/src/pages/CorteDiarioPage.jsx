import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataList } from '@/components/ui/DataList';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';

import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { PinModal } from '@/components/ui/PinModal';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { catalogosService } from '@/services/catalogos.service';
import api from '@/services/api';
import { getSocket } from '@/services/socket';
import './CorteDiarioPage.scss';

export default function CorteDiarioPage() {
  const [searchParams] = useSearchParams();

  // Filtros — búsqueda diferida (Enter o botón Buscar)
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const initialWarehouse = searchParams.get('warehouse');
  const [warehouseId, setWarehouseId] = useState(initialWarehouse ? Number(initialWarehouse) : null);
  const [showAll, setShowAll] = useState(false);

  // Fecha que se está navegando en el reporte (default: hoy)
  const [reportDate, setReportDate] = useState(null); // null = auto (siguiente pendiente)

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

  // Historial de cierres guardados
  const [historialOpen, setHistorialOpen] = useState(false);
  const [historialRows, setHistorialRows] = useState([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [detalleCierre, setDetalleCierre] = useState(null); // { cierre, rows } cuando el usuario abre uno
  const [detalleLoading, setDetalleLoading] = useState(false);

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
    // No retornar temprano si no hay cierreStatus — necesitamos cargar con valores por defecto
    setLoading(true);
    try {
      const params = { limit: 2000 };
      if (committedSearch) params.q = committedSearch;
      if (warehouseId) params.warehouse = warehouseId;
      if (showAll) params.show_all = 1;

      // Si el usuario eligió una fecha manual, usarla; si no, la siguiente pendiente o hoy
      if (reportDate) {
        params.fecha = reportDate;
      } else if (cierreStatus?.required_close_date) {
        params.fecha = cierreStatus.required_close_date;
      } else {
        params.fecha = cierreStatus?.hoy || new Date().toISOString().slice(0, 10);
      }

      const { data: res } = await api.get('/api/reportes/corte-diario', { params });
      setData(res);
    } catch (e) {
      toast.error('Error al cargar el corte diario');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [committedSearch, warehouseId, showAll, cierreStatus, reportDate]);

  // Limpiar fecha manual cuando cambia el estado de cierre (ej: después de cerrar)
  useEffect(() => {
    setReportDate(null);
  }, [cierreStatus?.required_close_date, cierreStatus?.days_missing]);

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

  useEffect(() => {
    let socket;
    try {
      socket = getSocket();
    } catch { return; }

    const onStockChanged = () => {
      fetchData();
      fetchCierreStatus();
    };
    socket.on('stock:changed', onStockChanged);

    return () => {
      socket.off('stock:changed', onStockChanged);
    };
  }, [fetchData, fetchCierreStatus]);

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
        if (c == null || !Number.isFinite(Number(c)) || getConteoErrorMsg(r)) return false;
        // Solo con diferencia real: si el conteo coincide con la existencia
        // actual no hay nada que ajustar.
        return Number(c) !== Number(r.existencia_actual);
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
        fecha: cierreStatus?.required_close_date || cierreStatus?.hoy,
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
      // Si el servidor detecta que hay un día anterior pendiente
      if (errData?.code === 'PREVIOUS_DAY_PENDING' && errData?.required_close_date) {
        setCierreModalOpen(false);
        toast.error(
          `Primero debes cerrar el día ${formatDate(errData.required_close_date)}. Los días deben cerrarse en orden.`
        );
        // Refrescar estado y forzar navegación al día correcto
        await fetchCierreStatus();
        setReportDate(null); // null = auto (siguiente pendiente)
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
        fecha: cierreStatus?.required_close_date || cierreStatus?.hoy,
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
    setReportDate(null);
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

  // Construye la URL del endpoint de impresión para la fecha que se está viendo.
  // Si el usuario navegó a una fecha anterior (reportDate), reimprime ese corte.
  // Si no, imprime el corte del día actual.
  // El `_t` con timestamp es para que el navegador no use caché: el mismo
  // endpoint sirve HTML y al cambiar solo el ?fecha= podría reusar la respuesta
  // cacheada, mostrando la fecha equivocada.
  const buildPrintUrl = (fecha = null) => {
    const params = new URLSearchParams();
    const f = fecha || reportDate || cierreStatus?.hoy;
    if (f) params.set('fecha', f);
    if (warehouseId) params.set('warehouse', String(warehouseId));
    if (showAll) params.set('show_all', '1');
    if (committedSearch) params.set('q', committedSearch);
    params.set('_t', String(Date.now()));
    return `/api/print/corte-diario?${params.toString()}`;
  };

  // Abre el HTML devuelto por el endpoint en una nueva ventana y dispara print().
  // Usamos este helper en vez de window.open(url) porque el endpoint requiere
  // Authorization y window.open no transmite headers. Hacemos fetch con axios
  // (que ya inyecta el token) y luego abrimos el HTML con un Blob URL.
  //
  // ¿Por qué Blob URL en vez de document.write()? Porque con document.write
  // sobre una ventana about:blank, el `window.onload` del HTML inyectado no
  // se dispara de forma confiable en Chrome, y el print() quedaba colgado
  // o la página aparecía en blanco. Con Blob URL, el navegador abre el
  // documento de forma nativa, el onload se dispara correctamente y el
  // print() funciona como se espera.
  const openPrintHtml = async (url) => {
    try {
      const { data: html } = await api.get(url, { responseType: 'text' });
      if (typeof html !== 'string' || !html.includes('<html')) {
        toast.error('La respuesta del servidor no es HTML imprimible');
        return;
      }
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!win) {
        toast.error('Permite las ventanas emergentes para imprimir');
        URL.revokeObjectURL(blobUrl);
        return;
      }
      // Liberar el blob URL después de un tiempo prudente (la ventana ya
      // habrá cargado el documento y el print() se habrá disparado).
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'No se pudo generar la impresión';
      toast.error(msg);
    }
  };

  // Imprime el corte que se está viendo en pantalla.
  const handlePrint = () => {
    if (!data) {
      toast.error('No hay datos para imprimir');
      return;
    }
    openPrintHtml(buildPrintUrl());
  };

  // Cargar historial de cierres guardados.
  const fetchHistorial = useCallback(async () => {
    setHistorialLoading(true);
    try {
      const params = { limit: 365 };
      if (warehouseId) params.warehouse = warehouseId;
      const { data: res } = await api.get('/api/cierre-dia', { params });
      setHistorialRows(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      toast.error('Error al cargar el historial de cierres');
      setHistorialRows([]);
    } finally {
      setHistorialLoading(false);
    }
  }, [warehouseId]);

  const openHistorial = () => {
    setHistorialOpen(true);
    fetchHistorial();
  };

  const openDetalleCierre = async (cierreRow) => {
    setDetalleCierre(null);
    setDetalleLoading(true);
    try {
      const params = {};
      if (warehouseId) params.warehouse = warehouseId;
      const { data: res } = await api.get(`/api/cierre-dia/${cierreRow.fecha_cierre}`, { params });
      setDetalleCierre(res);
    } catch (e) {
      toast.error('No se pudo cargar el detalle del cierre');
    } finally {
      setDetalleLoading(false);
    }
  };

  // Imprime un cierre guardado usando su fecha (reimpresión histórica).
  const handlePrintCierre = (cierreRow) => {
    openPrintHtml(buildPrintUrl(cierreRow.fecha_cierre));
  };

  // Exporta el detalle de un cierre guardado (las líneas del cierre_dia_detalle).
  const handleExportCierre = () => {
    if (!detalleCierre?.rows?.length) return;
    const cols = [
      { key: 'sku', label: 'SKU' },
      { key: 'nombre_producto', label: 'Producto' },
      { key: 'existencia_inicial', label: 'Exist. Inicial' },
      { key: 'entradas_dia', label: 'Entradas' },
      { key: 'salidas_dia', label: 'Salidas' },
      { key: 'existencia_cierre', label: 'Exist. Cierre' },
    ];
    downloadCSV(detalleCierre.rows, {
      filename: `cierre_${detalleCierre.cierre.fecha_cierre}_${detalleCierre.cierre.nombre_bodega || 'bodega'}`,
      columns: cols,
      format: (row, col) => {
        if (['existencia_inicial', 'entradas_dia', 'salidas_dia', 'existencia_cierre'].includes(col.key)) {
          return Number(row[col.key] || 0).toFixed(2);
        }
        return row[col.key];
      },
    });
  };

  return (
    <>
      <Header
        title="Corte Diario"
        subtitle={
          data
            ? `${data.bodega || 'Todas las bodegas'} · ${formatDate(data.fecha_hoy)}${reportDate ? ' (navegando)' : cierreStatus?.required_close_date ? ' ← pendiente' : ''} · ${rows.length} producto${rows.length === 1 ? '' : 's'}`
            : 'Cargando…'
        }
        actions={
          <div className="corte-diario__header-actions">
            {canCierre && cierreStatus && !cierreStatus.today_closed && (
              <Button size="sm" variant="primary" onClick={handleCerrarDia}>
                🔒 {cierreStatus.required_close_date
                  ? `Cerrar ${formatDate(cierreStatus.required_close_date)}`
                  : 'Cerrar día'}
                {cierreStatus.days_missing > 1 && (
                  <span style={{ marginLeft: '6px', opacity: 0.85, fontWeight: 400 }}>
                    ({cierreStatus.days_missing} pendientes)
                  </span>
                )}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={openHistorial} title="Ver cierres guardados de días anteriores">
              📜 Historial
            </Button>
            <Button variant="ghost" size="sm" disabled={loading || !data} onClick={handlePrint} title={reportDate ? `Imprimir el corte de ${formatDate(reportDate)}` : 'Imprimir este corte'}>
              🖨️ Imprimir
            </Button>
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
              <input
                type="date"
                className="input"
                value={reportDate || ''}
                max={cierreStatus?.ayer || ''}
                onChange={(e) => setReportDate(e.target.value || null)}
                title="Ver reporte de una fecha específica"
                style={{ fontSize: '13px', padding: '5px 8px' }}
              />
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

        {/* Banner de días pendientes */}
        {canCierre && cierreStatus && cierreStatus.days_missing > 0 && (
          <Card compact style={{ border: '2px solid #ffc107', background: '#fffbf0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '22px' }}>⚠️</span>
              <div>
                <strong style={{ color: '#856404' }}>
                  {cierreStatus.days_missing === 1
                    ? `Falta cerrar el día ${cierreStatus.pending_days[0]}`
                    : `Faltan cerrar ${cierreStatus.days_missing} días: ${cierreStatus.pending_days.join(', ')}`}
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#856404' }}>
                  Debes cerrarlos en orden. El reporte muestra el día más antiguo pendiente.
                  {reportDate && (
                    <button
                      onClick={() => setReportDate(null)}
                      style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#856404', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px', padding: 0 }}
                    >
                      Ver fecha pendiente →
                    </button>
                  )}
                </p>
              </div>
            </div>
          </Card>
        )}

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
                {conteosConError} producto(s) tienen un conteo final inválido (negativo o mayor a la existencia actual). Estos productos se muestran resaltados en rojo en la tabla.
              </p>
            </div>
          )}
          <p>
            <strong>¿Estás seguro de cerrar el día {formatDate(cierreStatus?.required_close_date || cierreStatus?.hoy)}?</strong>
          </p>
          {cierreStatus && cierreStatus.days_missing > 1 && (
            <p style={{ marginTop: '4px', fontSize: '13px', color: '#856404' }}>
              ⚠️ Después de este cierre,{' '}
              <strong>
                {cierreStatus.days_missing - 1 === 1
                  ? `te quedará 1 día más por cerrar: ${formatDate(cierreStatus.next_pending_date)}`
                  : `te quedarán ${cierreStatus.days_missing - 1} días más por cerrar (próximo: ${formatDate(cierreStatus.next_pending_date)})`}
              </strong>
              . Cada cierre debe hacerse en orden, del más antiguo al más reciente.
            </p>
          )}
          <p>Este proceso no podrá revertirse. Una vez cerrado el día:</p>
          <ul>
            <li>Se registrarán las existencias finales de todos los productos.</li>
            <li>No se podrán modificar movimientos de esta fecha.</li>
            <li>Se generará el corte oficial del día.</li>
            {data?.permite_salida_conteo_final && conteosFinalesPayload.length > 0 && (
              <li>
                <strong style={{ color: '#6f42c1' }}>
                  Se generará una salida automática por conteo final ({conteosFinalesPayload.length} producto{conteosFinalesPayload.length === 1 ? '' : 's'}).
                </strong>
              </li>
            )}
          </ul>
          {cierreStatus && (
            <div className="corte-diario__cierre-resumen">
              <span><strong>Fecha a cerrar:</strong> {formatDate(cierreStatus.required_close_date || cierreStatus.hoy)}</span>
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

      {/* Modal: Historial de cierres guardados */}
      <Modal
        open={historialOpen && !detalleCierre && !detalleLoading}
        onClose={() => setHistorialOpen(false)}
        title="Historial de cierres"
        subtitle="Cierres de días anteriores guardados en el sistema"
        size="xl"
      >
        <div className="corte-diario__historial">
          {historialLoading ? (
            <Spinner size={18} label="Cargando cierres…" />
          ) : historialRows.length === 0 ? (
            <EmptyState
              icon="◷"
              title="Sin cierres guardados"
              message="Aún no se ha realizado ningún cierre de día para esta bodega."
            />
          ) : (
            <div className="corte-diario__historial-table-wrap">
              <table className="corte-diario__historial-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Bodega</th>
                    <th>Origen</th>
                    <th style={{ textAlign: 'right' }}>Líneas</th>
                    <th style={{ textAlign: 'right' }}>Entradas</th>
                    <th style={{ textAlign: 'right' }}>Salidas</th>
                    <th style={{ textAlign: 'right' }}>Exist. Cierre</th>
                    <th>Cerrado por</th>
                    <th style={{ width: 140 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {historialRows.map((c) => (
                    <tr key={`hc-${c.id_cierre}`}>
                      <td><strong>{formatDate(c.fecha_cierre)}</strong></td>
                      <td>{c.nombre_bodega || '—'}</td>
                      <td>
                        <span className="corte-diario__chip">{c.origen || '—'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{c.total_lineas || 0}</td>
                      <td style={{ textAlign: 'right' }} className="corte-diario__num corte-diario__num--pos">
                        +{Number(c.total_entradas || 0).toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="corte-diario__num corte-diario__num--neg">
                        −{Number(c.total_salidas || 0).toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="corte-diario__num">
                        {Number(c.total_existencia_cierre || 0).toFixed(2)}
                      </td>
                      <td className="corte-diario__user-cell">{c.creado_por_nombre || '—'}</td>
                      <td>
                        <div className="corte-diario__historial-actions">
                          <Button size="sm" variant="ghost" onClick={() => openDetalleCierre(c)} title="Ver detalle">
                            👁 Ver
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handlePrintCierre(c)} title="Reimprimir este corte">
                            🖨
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: Detalle de un cierre guardado */}
      <Modal
        open={(detalleCierre != null || detalleLoading) && historialOpen}
        onClose={() => { setDetalleCierre(null); setHistorialOpen(false); }}
        title={detalleCierre ? `Cierre del ${formatDate(detalleCierre.cierre.fecha_cierre)}` : 'Cargando detalle…'}
        subtitle={detalleCierre ? `${detalleCierre.cierre.nombre_bodega} · cerrado por ${detalleCierre.cierre.creado_por || '—'} · origen: ${detalleCierre.cierre.origen || '—'}` : ''}
        size="xl"
      >
        <div className="corte-diario__detalle-cierre">
          {detalleLoading ? (
            <Spinner size={18} label="Cargando detalle…" />
          ) : detalleCierre ? (
            <>
              <div className="corte-diario__detalle-actions">
                <Button size="sm" variant="ghost" onClick={() => setDetalleCierre(null)}>← Volver al historial</Button>
                <Button size="sm" variant="ghost" onClick={() => handlePrintCierre({ fecha_cierre: detalleCierre.cierre.fecha_cierre })}>🖨️ Imprimir</Button>
                <Button size="sm" variant="ghost" onClick={handleExportCierre}>📥 Exportar CSV</Button>
              </div>
              {detalleCierre.cierre.observaciones && (
                <div className="corte-diario__obs">Observaciones: {detalleCierre.cierre.observaciones}</div>
              )}
              <div className="corte-diario__metrics" style={{ marginTop: 12 }}>
                <Card compact className="corte-diario__metric-card corte-diario__metric-card--success">
                  <span className="corte-diario__metric-label">Total Entradas</span>
                  <span className="corte-diario__metric-value">+{Number(detalleCierre.cierre.total_entradas || 0).toFixed(2)}</span>
                </Card>
                <Card compact className="corte-diario__metric-card corte-diario__metric-card--danger">
                  <span className="corte-diario__metric-label">Total Salidas</span>
                  <span className="corte-diario__metric-value">−{Number(detalleCierre.cierre.total_salidas || 0).toFixed(2)}</span>
                </Card>
                <Card compact className="corte-diario__metric-card corte-diario__metric-card--accent">
                  <span className="corte-diario__metric-label">Exist. Cierre</span>
                  <span className="corte-diario__metric-value">{Number(detalleCierre.cierre.total_existencia_cierre || 0).toFixed(2)}</span>
                </Card>
              </div>
              <div className="corte-diario__detalle-table-wrap" style={{ marginTop: 12 }}>
                <table className="corte-diario__detalle-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>SKU</th>
                      <th style={{ textAlign: 'right' }}>Exist. Inicial</th>
                      <th style={{ textAlign: 'right' }}>Entradas</th>
                      <th style={{ textAlign: 'right' }}>Salidas</th>
                      <th style={{ textAlign: 'right' }}>Exist. Cierre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalleCierre.rows.map((r) => (
                      <tr key={`dcr-${r.id_producto}`}>
                        <td>{r.nombre_producto}</td>
                        <td><code>{r.sku || '—'}</code></td>
                        <td style={{ textAlign: 'right' }}>{Number(r.existencia_inicial || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }} className="corte-diario__num corte-diario__num--pos">+{Number(r.entradas_dia || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }} className="corte-diario__num corte-diario__num--neg">−{Number(r.salidas_dia || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }} className="corte-diario__num"><strong>{Number(r.existencia_cierre || 0).toFixed(2)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
