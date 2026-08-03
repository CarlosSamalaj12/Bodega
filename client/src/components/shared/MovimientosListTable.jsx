import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/utils/format';
import { getSocket } from '@/services/socket';
import './MovimientosListTable.scss';

/**
 * MovimientosListTable
 *
 * Tabla reusable para listar movimientos (entradas o salidas) con:
 *  - productos visibles en la fila principal (resumen con los 2 primeros + "+N")
 *  - expansión por click para ver el detalle completo de las líneas
 *  - totales por movimiento (cantidad, costo)
 *  - filtrado por búsqueda, ocultamiento de anulados
 *  - botón opcional de revertir movimiento (con confirmación por PIN en el padre)
 *  - filtro por rango de fechas (from/to)
 *
 * Props:
 *  - service: { list, getDetail, revert } - servicio que expone la API del backend.
 *  - tipoLabel: 'ENTRADA' | 'SALIDA' - para el endpoint y los textos.
 *  - emptyTitle / emptyMessage / emptyIcon: textos para el estado vacío.
 *  - onRowDetail: callback(id) para abrir el modal de detalle externo (opcional).
 *  - onRevert: callback(id) si la página padre quiere manejar la reversión
 *              (por ejemplo, abrir su propio PinModal).
 *  - onRevertClick: (id) => void - idem, con el id del movimiento.
 *  - reloadKey: number | string - cuando cambia, se vuelve a fetchar.
 *  - defaultDateFrom / defaultDateTo: string YYYY-MM-DD para filtrar por rango
 *    (si no se proveen, se usa el día actual por defecto).
 *  - showDateFilter: bool - mostrar el filtro de fechas en la barra (default true).
 */
export function MovimientosListTable({
  service,
  tipoLabel = 'MOVIMIENTO',
  emptyTitle = 'Sin resultados',
  emptyMessage = 'No hay movimientos para mostrar.',
  emptyIcon = '⇅',
  onRowDetail,
  onRevertClick,
  reloadKey,
  showAnulados = false,
  onToggleAnulados,
  defaultDateFrom,
  defaultDateTo,
  showDateFilter = true,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Fecha por defecto: si se provee use it; si no, hoy
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom || todayStr);
  const [dateTo, setDateTo] = useState(defaultDateTo || todayStr);

  // Track reloadKey previo para detectar cambios post-montaje
  const prevReloadKeyRef = useRef(reloadKey);
  const fetchIdRef = useRef(0);
  // Guardamos el ID máximo actual para incremental refresh
  const maxIdRef = useRef(0);

  // Carga inicial completa — envuelta en useCallback para estabilidad de useEffect
  const loadData = useCallback(async (opts = {}) => {
    if (opts.background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    const fetchId = ++fetchIdRef.current;
    try {
      const result = await service.list({ limit: 500, from: dateFrom, to: dateTo, ...opts });
      const raw = Array.isArray(result) ? result : (result?.rows || []);
      if (fetchId !== fetchIdRef.current) return;

      if (opts.background) {
        // Incremental: solo añade filas nuevas sin reemplazar
        setRows((prev) => {
          const existingIds = new Set(prev.map((r) => Number(r.id_movimiento)));
          const newOnly = raw.filter((r) => !existingIds.has(Number(r.id_movimiento)));
          if (!newOnly.length) return prev;
          const merged = [...prev, ...newOnly];
          const maxId = merged.length
            ? Math.max(...merged.map((r) => Number(r.id_movimiento)), 0)
            : 0;
          maxIdRef.current = maxId;
          return merged;
        });
        setRefreshing(false);
      } else {
        setRows(raw);
        const maxId = raw.length
          ? Math.max(...raw.map((r) => Number(r.id_movimiento)), 0)
          : 0;
        maxIdRef.current = maxId;
      }
    } catch (e) {
      if (fetchId === fetchIdRef.current) {
        if (opts.background) {
          setRefreshing(false);
        } else {
          setError(e?.response?.data?.error || e?.message || 'Error al cargar');
          setRows([]);
          setLoading(false);
        }
      }
    } finally {
      if (!opts.background && fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, dateFrom, dateTo]);

  // reloadKey: primera carga o refresh en background
  useEffect(() => {
    const prev = prevReloadKeyRef.current;
    if (prev === undefined) {
      // Primera carga
      prevReloadKeyRef.current = reloadKey;
      loadData();
    } else if (reloadKey !== prev) {
      // Mutación ocurrió: refresh incremental
      prevReloadKeyRef.current = reloadKey;
      loadData({ background: true });
    }
  }, [reloadKey, loadData]);

  useEffect(() => {
    let socket;
    try {
      socket = getSocket();
    } catch { return; }

    const onStockChanged = () => {
      loadData({ background: true });
    };
    socket.on('stock:changed', onStockChanged);

    return () => {
      socket.off('stock:changed', onStockChanged);
    };
  }, [loadData]);

  // Recargar cuando cambia el rango de fechas (sin afectar reloadKey)
  useEffect(() => {
    if (prevReloadKeyRef.current !== undefined) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  // Detecta el nombre del campo "tipo" según el endpoint (tipo_entrada / tipo_salida / tipo_movimiento)
  const tipoField = useMemo(() => {
    if (rows.length === 0) return 'tipo_movimiento';
    const sample = rows[0];
    if ('tipo_entrada' in sample) return 'tipo_entrada';
    if ('tipo_salida' in sample) return 'tipo_salida';
    return 'tipo_movimiento';
  }, [rows]);

  // Agrupa filas planas por id_movimiento, conservando las líneas
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const id = Number(r.id_movimiento);
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
          estado: r.estado,
          anulado_por: r.anulado_por,
          anulado_en: r.anulado_en,
          anulado_por_usuario: r.anulado_por_usuario,
          tipo: r[tipoField] || r.tipo_movimiento,
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
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha)
    );
  }, [rows, tipoField]);

  // Filtros: anulados + búsqueda
  const filtered = useMemo(() => {
    let result = grouped;
    if (!showAnulados) {
      result = result.filter((g) => String(g.estado || '').toUpperCase() !== 'ANULADO');
    }
    const q = (search || '').trim().toLowerCase();
    if (!q) return result;
    return result.filter((g) => {
      const doc = String(g.no_documento || '').toLowerCase();
      const motivo = String(g.nombre_motivo || '').toLowerCase();
      const usuario = String(g.usuario_creador || '').toLowerCase();
      const bodega = String(g.nombre_bodega || '').toLowerCase();
      const obs = String(g.observaciones || '').toLowerCase();
      const id = String(g.id_movimiento);
      const productos = g.lineas.map((l) => String(l.nombre_producto || '').toLowerCase()).join(' ');
      return (
        id.includes(q) ||
        doc.includes(q) ||
        motivo.includes(q) ||
        usuario.includes(q) ||
        bodega.includes(q) ||
        obs.includes(q) ||
        productos.includes(q)
      );
    });
  }, [grouped, search, showAnulados]);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderProductos = (g) => {
    const nombres = [...new Set(g.lineas.map((l) => l.nombre_producto).filter(Boolean))];
    if (nombres.length === 0) return <span className="mov-list__muted">—</span>;
    return (
      <div className="mov-list__productos-list">
        {nombres.slice(0, 2).map((n, i) => (
          <span key={`${g.id_movimiento}-p-${i}`} className="mov-list__productos-name" title={n}>
            {n}{i === 0 && nombres.length > 2 ? ',' : ''}
          </span>
        ))}
        {nombres.length > 2 && (
          <span className="mov-list__productos-more">+{nombres.length - 2}</span>
        )}
      </div>
    );
  };

  return (
    <div className="mov-list">
      {/* Indicador de refresh en background */}
      {refreshing && (
        <div className="mov-list__refreshing" role="status" aria-live="polite">
          <span className="mov-list__refreshing-dot" />
          Actualizando…
        </div>
      )}

      {/* Buscador + chip de anulados */}
      <div className="mov-list__toolbar">
        {showDateFilter && (
          <div className="mov-list__fecha-group">
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                if (e.target.value > dateTo) setDateTo(e.target.value);
              }}
              max={dateTo || undefined}
              title="Desde"
            />
            <span className="mov-list__sep">→</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                if (e.target.value < dateFrom) setDateFrom(e.target.value);
              }}
              min={dateFrom || undefined}
              title="Hasta"
            />
            <button
              type="button"
              className="mov-list__today-btn"
              onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); }}
              title="Filtrar solo por hoy"
            >
              Hoy
            </button>
          </div>
        )}
        <input
          type="search"
          className="input mov-list__search"
          placeholder="Buscar por #, documento, motivo, usuario, producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {onToggleAnulados && (
          <button
            type="button"
            className={`mov-list__chip ${showAnulados ? 'mov-list__chip--active' : ''}`}
            onClick={onToggleAnulados}
            title={showAnulados ? 'Ocultar anulados' : 'Mostrar anulados'}
          >
            {showAnulados ? '✓' : ''} Anulados
          </button>
        )}
      </div>

      {loading ? (
        <div className="mov-list__state"><Spinner size={20} label="Cargando…" /></div>
      ) : error ? (
        <div className="mov-list__state mov-list__state--error">
          <p>No se pudo cargar la lista.</p>
          <p className="mov-list__error-detail">{error}</p>
          <Button variant="subtle" onClick={loadData}>Reintentar</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mov-list__state">
          <div className="mov-list__empty">
            <span className="mov-list__empty-icon" aria-hidden>{emptyIcon}</span>
            <p className="mov-list__empty-title">{search ? 'Sin resultados' : emptyTitle}</p>
            <p className="mov-list__empty-msg">{search ? 'Intenta con otros términos.' : emptyMessage}</p>
          </div>
        </div>
      ) : (
        <div className="mov-list__table-wrapper">
          <table className="table table--sm">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th style={{ width: 60 }}>#</th>
                <th>Fecha</th>
                <th>Motivo</th>
                <th>Bodega</th>
                <th>Productos</th>
                <th>Documento</th>
                <th>Usuario</th>
                <th style={{ textAlign: 'right', width: 80 }}>Cant.</th>
                <th style={{ textAlign: 'right', width: 100 }}>Total</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.flatMap((g) => {
                const isOpen = expanded.has(g.id_movimiento);
                const isAnulado = String(g.estado || '').toUpperCase() === 'ANULADO';
                const sumCant = g.lineas.reduce((a, l) => a + l.cantidad, 0);
                const sumTotal = g.lineas.reduce((a, l) => a + l.total_linea, 0);
                const parentRow = (
                  <tr
                    key={`ml-${g.id_movimiento}`}
                    className={`mov-list__mov-row ${isAnulado ? 'mov-list__mov-row--anulado' : ''}`}
                    onClick={() => onRowDetail?.(g.id_movimiento)}
                  >
                    <td onClick={(e) => { e.stopPropagation(); toggleExpand(g.id_movimiento); }}>
                      <button type="button" className="mov-list__expand-btn" aria-label={isOpen ? 'Contraer' : 'Expandir'}>
                        <span className={`mov-list__chevron ${isOpen ? 'mov-list__chevron--open' : ''}`}>▸</span>
                      </button>
                    </td>
                    <td><code>#{g.id_movimiento}</code></td>
                    <td className="mov-list__date">
                      <span>{formatDate(g.fecha)}</span>
                      {g.hora && <span className="mov-list__time">{g.hora}</span>}
                    </td>
                    <td>{g.nombre_motivo || '—'}</td>
                    <td>{g.nombre_bodega || '—'}</td>
                    <td>{renderProductos(g)}</td>
                    <td>{g.no_documento || '—'}</td>
                    <td className="mov-list__user">{g.usuario_creador || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumCant.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sumTotal.toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {onRevertClick && !isAnulado && (
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => onRevertClick(g.id_movimiento)}
                          title={`Revertir ${tipoLabel.toLowerCase()}`}
                        >
                          ↩
                        </Button>
                      )}
                      {isAnulado && <span className="mov-list__anulado" title="Movimiento anulado">Anulado</span>}
                    </td>
                  </tr>
                );
                const detailRow = isOpen ? (
                  <tr key={`ml-det-${g.id_movimiento}`} className="mov-list__det-row">
                    <td colSpan={11}>
                      <div className="mov-list__detalle">
                        <table className="mov-list__det-table">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th style={{ width: 80 }}>SKU</th>
                              <th style={{ width: 100 }}>Categoría</th>
                              <th style={{ width: 100 }}>Lote</th>
                              <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
                              <th style={{ width: 90, textAlign: 'right' }}>Costo U.</th>
                              <th style={{ width: 100, textAlign: 'right' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lineas.map((l, idx) => (
                              <tr key={`ml-${g.id_movimiento}-ln-${l.id_detalle || idx}`}>
                                <td>{l.nombre_producto}</td>
                                <td>{l.sku ? <code>{l.sku}</code> : '—'}</td>
                                <td>{l.nombre_categoria || '—'}</td>
                                <td>{l.lote || '—'}</td>
                                <td style={{ textAlign: 'right' }}>{l.cantidad.toFixed(2)}</td>
                                <td style={{ textAlign: 'right' }}>{l.costo_unitario.toFixed(2)}</td>
                                <td style={{ textAlign: 'right' }}>{l.total_linea.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {g.observaciones && (
                          <div className="mov-list__obs">
                            <strong>Observaciones:</strong> {g.observaciones}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null;
                return [parentRow, detailRow];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

MovimientosListTable.propTypes = {
  service: PropTypes.object.isRequired,
  tipoLabel: PropTypes.string,
  emptyTitle: PropTypes.string,
  emptyMessage: PropTypes.string,
  emptyIcon: PropTypes.string,
  onRowDetail: PropTypes.func,
  onRevertClick: PropTypes.func,
  reloadKey: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  showAnulados: PropTypes.bool,
  onToggleAnulados: PropTypes.func,
  defaultDateFrom: PropTypes.string,
  defaultDateTo: PropTypes.string,
  showDateFilter: PropTypes.bool,
};
