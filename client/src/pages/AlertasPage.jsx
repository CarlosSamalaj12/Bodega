import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { toast } from '@/components/ui/Toast';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { existenciasService } from '@/services/existencias.service';
import { catalogosService } from '@/services/catalogos.service';
import './AlertasPage.scss';

const DIAS_OPTIONS = [
  { value: 7, label: '7 días' },
  { value: 15, label: '15 días' },
  { value: 30, label: '30 días' },
  { value: 60, label: '60 días' },
  { value: 90, label: '90 días' },
];

const TABS = [
  { key: 'vencimiento', label: 'Vencimiento', icon: '📅' },
  { key: 'minimo', label: 'Stock Mínimo', icon: '📦' },
];

// ──────────────────────────────────────────────────────────────
// Tipo de alerta con icono + severidad.
// `severity` (0..2) la usa la fila para pintarse de un color de borde
// y la usa el indicador para mostrar un dot pulsante en los críticos.
// ──────────────────────────────────────────────────────────────
function getTipoAlerta(item) {
  const dias = item.dias_para_vencer;
  if (dias != null && dias < 0) {
    return { label: 'Vencido', variant: 'danger', icon: '⛔', severity: 2, order: 0 };
  }
  if (dias != null && dias <= 3) {
    return { label: `Vence en ${dias}d`, variant: 'danger', icon: '🔥', severity: 2, order: 1 };
  }
  if (item.dias_restantes_regla != null && item.dias_restantes_regla <= 0) {
    return { label: 'Regla vencida', variant: 'danger', icon: '⛔', severity: 2, order: 2 };
  }
  if (item.dias_restantes_regla != null && item.dias_alerta_antes != null && item.dias_restantes_regla <= item.dias_alerta_antes) {
    return { label: 'Regla próxima', variant: 'warning', icon: '⏰', severity: 1, order: 3 };
  }
  if (dias != null && item.dias_alerta_antes != null && dias <= item.dias_alerta_antes) {
    return { label: `Vence en ${dias}d`, variant: 'warning', icon: '📅', severity: 1, order: 4 };
  }
  return { label: `${dias != null ? dias + 'd' : '—'}`, variant: 'info', icon: '🕒', severity: 0, order: 5 };
}

function getMinimoAlerta(r) {
  const diff = Number(r.diferencia_minimo || 0);
  const stock = Number(r.stock || 0);
  if (stock <= 0) {
    return { label: 'Sin stock', variant: 'danger', icon: '⛔', severity: 2, order: 0 };
  }
  if (diff >= 5) {
    return { label: `Muy bajo (−${diff})`, variant: 'danger', icon: '🔥', severity: 2, order: 1 };
  }
  return { label: `Bajo mínimo (−${diff})`, variant: 'warning', icon: '⚠️', severity: 1, order: 2 };
}

/**
 * Indicador visual de la severidad de la alerta. Combina un badge
 * coloreado con icono + dot pulsante en los críticos. Reemplaza al
 * <Badge> plano anterior para que las alertas se vean de un vistazo
 * sin tener que leer el texto.
 */
function AlertIndicator({ tipo, withDot = true }) {
  return (
    <span className={`alertas-page__indicator alertas-page__indicator--${tipo.variant} alertas-page__indicator--sev${tipo.severity}`}>
      {withDot && tipo.severity >= 2 && <span className="alertas-page__indicator-dot" aria-hidden="true" />}
      <span className="alertas-page__indicator-icon" aria-hidden="true">{tipo.icon}</span>
      <span className="alertas-page__indicator-label">{tipo.label}</span>
    </span>
  );
}

export default function AlertasPage() {
  const navigate = useNavigate();
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Tabs
  const [tipo, setTipo] = useState('vencimiento');

  // Filtros — búsqueda diferida (Enter o botón Buscar)
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [dias, setDias] = useState(15);
  const [categoriaId, setCategoriaId] = useState(null);
  const [subcategoriaId, setSubcategoriaId] = useState(null);
  const [showZeroStock, setShowZeroStock] = useState(false);

  // Datos
  const [rows, setRows] = useState([]);
  const [minRows, setMinRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // Catálogos
  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [cleaning, setCleaning] = useState(false);
  const cleaningRef = useRef(null);

  // Export
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  useEffect(() => {
    catalogosService.getCategorias().then(setCategorias).catch(() => {});
  }, []);

  // Cargar subcategorías filtradas por categoría
  useEffect(() => {
    setSubcategoriaId(null);
    const controller = new AbortController();
    catalogosService
      .getSubcategorias(controller.signal, categoriaId || undefined)
      .then(setSubcategorias)
      .catch(() => {});
    return () => controller.abort();
  }, [categoriaId]);

  const handleSearch = () => {
    setCommittedSearch(search);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Ref con filtros actuales para evitar recrear los callbacks.
  // Se actualiza en un efecto (declarado ANTES del efecto de re-fetch,
  // así que React lo ejecuta primero) y no durante el render, que React
  // puede descartar o repetir.
  const filtersRef = useRef({});
  useEffect(() => {
    filtersRef.current = { committedSearch, dias, categoriaId, subcategoriaId, showZeroStock };
  }, [committedSearch, dias, categoriaId, subcategoriaId, showZeroStock]);

  const fetchAlertas = useCallback(async () => {
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = { days: f.dias };
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.subcategoriaId) params.subcategoria = f.subcategoriaId;
      if (f.showZeroStock) params.show_zero = '1';
      const data = await existenciasService.alertas(params);
      setRows(data);
    } catch (e) {
      toast.error('No se pudieron cargar las alertas');
    } finally {
      setLoading(false);
    }
  }, []); // Sin dependencias — lee los filtros del ref

  const fetchMinimos = useCallback(async () => {
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = {};
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.subcategoriaId) params.subcategoria = f.subcategoriaId;
      const data = await existenciasService.stockMinimo(params);
      setMinRows(data);
    } catch (e) {
      toast.error('No se pudieron cargar las alertas de stock mínimo');
    } finally {
      setLoading(false);
    }
  }, []); // Sin dependencias — lee los filtros del ref

  const currentRows = tipo === 'vencimiento' ? rows : minRows;

  // Re-fetch cuando cambian los filtros (leídos del ref) o el tab
  useEffect(() => {
    if (tipo === 'vencimiento') {
      fetchAlertas();
    } else {
      fetchMinimos();
    }
  }, [tipo, committedSearch, dias, categoriaId, subcategoriaId, showZeroStock]);

  const resumen = useMemo(() => {
    if (tipo === 'vencimiento') {
      let vencidos = 0, proximos = 0, reglas = 0, totalStock = 0;
      for (const r of rows) {
        const t = getTipoAlerta(r);
        if (t.order <= 2) vencidos++;
        else if (t.order <= 4) proximos++;
        else reglas++;
        totalStock += Number(r.stock || 0);
      }
      return { vencidos, proximos, reglas, total: rows.length, totalStock };
    } else {
      let criticos = 0, bajos = 0, totalStock = 0;
      for (const r of minRows) {
        const t = getMinimoAlerta(r);
        if (t.order <= 1) criticos++;
        else bajos++;
        totalStock += Number(r.stock || 0);
      }
      return { criticos, bajos, total: minRows.length, totalStock };
    }
  }, [tipo, rows, minRows]);

  const handleClearFilters = () => {
    if (cleaningRef.current) clearTimeout(cleaningRef.current);
    setCleaning(true);
    setSubcategoriaId(null);
    cleaningRef.current = setTimeout(() => {
      setSearch('');
      setCommittedSearch('');
      setCategoriaId(null);
      setDias(15);
      setShowZeroStock(false);
      setCleaning(false);
      cleaningRef.current = null;
    }, 250);
  };

  const hasActiveFilters = committedSearch || categoriaId || subcategoriaId || dias !== 15 || showZeroStock;

  const goToKardex = (r) => {
    const q = r.nombre_producto || r.sku || '';
    navigate(`/kardex?q=${encodeURIComponent(q)}`);
  };

  const columnsVencimiento = useMemo(() => [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      render: (r) => (
        <div className="alertas-page__producto">
          <span className="alertas-page__prod-name">{r.nombre_producto}</span>
          {r.sku && <code className="alertas-page__prod-sku">{r.sku}</code>}
        </div>
      ),
    },
    {
      key: 'nombre_bodega',
      label: 'Bodega',
      render: (r) => r.nombre_bodega || '—',
    },
    {
      key: 'stock',
      label: 'Stock',
      width: 80,
      align: 'right',
      render: (r) => <span className="alertas-page__stock">{Number(r.stock)}</span>,
    },
    {
      key: 'lote',
      label: 'Lote',
      hideOnMobile: true,
      render: (r) => r.lote || <span className="alertas-page__muted">—</span>,
    },
    {
      key: 'fecha_vencimiento',
      label: 'Vence',
      width: 100,
      render: (r) => {
        if (!r.fecha_vencimiento) return <span className="alertas-page__muted">—</span>;
        const t = getTipoAlerta(r);
        return (
          <span className={`alertas-page__vencimiento alertas-page__vencimiento--sev${t.severity}`}>
            {formatDate(r.fecha_vencimiento)}
          </span>
        );
      },
    },
    {
      key: 'dias_para_vencer',
      label: 'Días',
      width: 80,
      align: 'right',
      hideOnMobile: true,
      render: (r) => {
        const d = r.dias_para_vencer;
        if (d == null) return <span className="alertas-page__muted">—</span>;
        const sev = d < 0 ? 2 : d <= 3 ? 2 : d <= 7 ? 1 : 0;
        return (
          <span className={`alertas-page__dias alertas-page__dias--sev${sev}`}>
            {d >= 0 ? `${d}d` : `−${Math.abs(d)}d`}
          </span>
        );
      },
    },
    {
      key: 'dias_en_bodega',
      label: 'En bodega',
      width: 80,
      align: 'right',
      hideOnMobile: true,
      render: (r) => r.dias_en_bodega != null ? `${r.dias_en_bodega}d` : <span className="alertas-page__muted">—</span>,
    },
    {
      key: 'alerta',
      label: 'Rotación de producto',
      width: 180,
      render: (r) => <AlertIndicator tipo={getTipoAlerta(r)} />,
      cardMeta: (r) => <AlertIndicator tipo={getTipoAlerta(r)} withDot={false} />,
    },
    {
      key: '__kardex',
      label: '',
      width: 80,
      align: 'right',
      hideOnMobile: true,
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); goToKardex(r); }}>
          Kardex
        </Button>
      ),
    },
  ], []);

  const columnsMinimo = useMemo(() => [
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      render: (r) => (
        <div className="alertas-page__producto">
          <span className="alertas-page__prod-name">{r.nombre_producto}</span>
          {r.sku && <code className="alertas-page__prod-sku">{r.sku}</code>}
        </div>
      ),
    },
    {
      key: 'nombre_bodega',
      label: 'Bodega',
      render: (r) => r.nombre_bodega || '—',
    },
    {
      key: 'stock',
      label: 'Stock',
      width: 80,
      align: 'right',
      render: (r) => {
        const stock = Number(r.stock || 0);
        const sev = stock <= 0 ? 2 : Number(r.diferencia_minimo || 0) >= 5 ? 2 : 1;
        return (
          <span className={`alertas-page__stock alertas-page__stock--sev${sev}`}>
            {stock}
          </span>
        );
      },
    },
    {
      key: 'minimo',
      label: 'Mínimo',
      width: 80,
      align: 'right',
      render: (r) => <span className="alertas-page__minimo">{Number(r.minimo)}</span>,
    },
    {
      key: 'maximo',
      label: 'Máximo',
      width: 80,
      align: 'right',
      hideOnMobile: true,
      render: (r) => r.maximo != null && Number(r.maximo) > 0 ? Number(r.maximo) : <span className="alertas-page__muted">—</span>,
    },
    {
      key: 'diferencia',
      label: 'Faltante',
      width: 90,
      align: 'right',
      render: (r) => {
        const diff = Number(r.diferencia_minimo || 0);
        const sev = diff >= 5 ? 2 : diff > 0 ? 1 : 0;
        return (
          <span className={`alertas-page__diferencia alertas-page__diferencia--sev${sev}`}>
            −{diff}
          </span>
        );
      },
    },
    {
      key: 'alerta',
      label: 'Alerta',
      width: 180,
      render: (r) => <AlertIndicator tipo={getMinimoAlerta(r)} />,
      cardMeta: (r) => <AlertIndicator tipo={getMinimoAlerta(r)} withDot={false} />,
    },
    {
      key: '__kardex',
      label: '',
      width: 80,
      align: 'right',
      hideOnMobile: true,
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); goToKardex(r); }}>
          Kardex
        </Button>
      ),
    },
  ], []);

  const columns = tipo === 'vencimiento' ? columnsVencimiento : columnsMinimo;

  const exportColumnsVencimiento = [
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_bodega', label: 'Bodega' },
    { key: 'nombre_subcategoria', label: 'Subcategoría' },
    { key: 'stock', label: 'Stock' },
    { key: 'lote', label: 'Lote' },
    { key: 'fecha_vencimiento', label: 'Vencimiento' },
    { key: 'dias_para_vencer', label: 'Días por vencer' },
    { key: 'dias_en_bodega', label: 'Días en bodega' },
    { key: 'dias_restantes_regla', label: 'Días restantes regla' },
  ];

  const exportColumnsMinimo = [
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_bodega', label: 'Bodega' },
    { key: 'stock', label: 'Stock actual' },
    { key: 'minimo', label: 'Mínimo configurado' },
    { key: 'maximo', label: 'Máximo configurado' },
    { key: 'diferencia_minimo', label: 'Faltante' },
  ];

  const exportColumns = tipo === 'vencimiento' ? exportColumnsVencimiento : exportColumnsMinimo;

  const handleTabChange = (key) => {
    if (key !== tipo) {
      if (cleaningRef.current) clearTimeout(cleaningRef.current);
      setCleaning(false);
      setTipo(key);
      setSearch('');
      setCategoriaId(null);
      setSubcategoriaId(null);
      setDias(15);
      setShowZeroStock(false);
    }
  };

  const handleRefresh = () => {
    if (tipo === 'vencimiento') fetchAlertas();
    else fetchMinimos();
  };

  return (
    <>
      <Header
        title="Alertas de stock"
        subtitle={
          loading
            ? 'Cargando…'
            : `${currentRows.length} alerta${currentRows.length === 1 ? '' : 's'}` +
              ` · ${resumen.totalStock} unidad${resumen.totalStock !== 1 ? 'es' : ''}` +
              (tipo === 'vencimiento' && resumen.vencidos > 0 ? ` · 🔴 ${resumen.vencidos} crítico${resumen.vencidos !== 1 ? 's' : ''}` : '') +
              (tipo === 'vencimiento' && resumen.proximos > 0 ? ` · 🟡 ${resumen.proximos} próximo${resumen.proximos !== 1 ? 's' : ''}` : '') +
              (tipo === 'minimo' && resumen.criticos > 0 ? ` · 🔴 ${resumen.criticos} crítico${resumen.criticos !== 1 ? 's' : ''}` : '')
        }
        actions={
          <div className="alertas-page__header-actions">
            {currentRows.length > 0 && !loading && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
              {loading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        }
      />

      <div className="alertas-page">
        {/* Tabs */}
        <Card>
          <div className="alertas-page__tabs">
            {TABS.map((tab) => (
              <button
                key={`ale-tab-${tab.key}`}
                type="button"
                className={`alertas-page__tab ${tipo === tab.key ? 'alertas-page__tab--active' : ''}`}
                onClick={() => handleTabChange(tab.key)}
              >
                <span className="alertas-page__tab-icon" aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Filtros */}
        <Card>
          <div className="alertas-page__filters">
            <div className="alertas-page__search">
              <SearchInput
                value={search}
                onChange={setSearch}
                onKeyDown={handleKeyDown}
                onSearch={handleSearch}
                activeLabel={committedSearch || undefined}
                placeholder="Buscar producto o SKU…"
              />
            </div>

            {tipo === 'vencimiento' && (
              <div className="alertas-page__dias-group">
                <span className="alertas-page__dias-label">Vence en:</span>
                <div className="alertas-page__dias-chips">
                  {DIAS_OPTIONS.map((opt) => (
                    <button
                      key={`ale-opt-${opt.value}`}
                      type="button"
                      className={`alertas-page__chip ${dias === opt.value ? 'alertas-page__chip--active' : ''}`}
                      onClick={() => setDias(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <select
              className="select"
              value={categoriaId ?? ''}
              onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Categoría"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={`ale-cat-${c.id_categoria}`} value={c.id_categoria}>
                  {c.nombre_categoria}
                </option>
              ))}
            </select>

            <div className={`alertas-page__cascade ${categoriaId && !cleaning ? 'alertas-page__cascade--visible' : ''} ${cleaning ? 'alertas-page__cascade--cleaning' : ''}`}>
              <select
                className="select"
                value={subcategoriaId ?? ''}
                onChange={(e) => setSubcategoriaId(e.target.value ? Number(e.target.value) : null)}
                aria-label="Subcategoría"
              >
                <option value="">Todas las subcategorías</option>
                {subcategorias.map((s) => (
                  <option key={`ale-sub-${s.id_subcategoria}`} value={s.id_subcategoria}>
                    {s.nombre_subcategoria}
                  </option>
                ))}
              </select>
            </div>

            {tipo === 'vencimiento' && (
              <label className="alertas-page__checkbox-label" title="Incluir productos sin stock">
                <input
                  type="checkbox"
                  className="alertas-page__checkbox"
                  checked={showZeroStock}
                  onChange={(e) => setShowZeroStock(e.target.checked)}
                />
                <span>Stock cero</span>
              </label>
            )}

            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </Card>

        {/* Cards de resumen */}
        {!loading && currentRows.length > 0 && (
          <div className="alertas-page__cards">
            {tipo === 'vencimiento' ? (
              <>
                <div className="alertas-page__card alertas-page__card--danger">
                  <span className="alertas-page__card-count">{resumen.vencidos}</span>
                  <span className="alertas-page__card-label">Críticos</span>
                </div>
                <div className="alertas-page__card alertas-page__card--warning">
                  <span className="alertas-page__card-count">{resumen.proximos}</span>
                  <span className="alertas-page__card-label">Próximos</span>
                </div>
                <div className="alertas-page__card alertas-page__card--info">
                  <span className="alertas-page__card-count">{resumen.total}</span>
                  <span className="alertas-page__card-label">Total alertas</span>
                </div>
              </>
            ) : (
              <>
                <div className="alertas-page__card alertas-page__card--danger">
                  <span className="alertas-page__card-count">{resumen.criticos}</span>
                  <span className="alertas-page__card-label">Críticos</span>
                </div>
                <div className="alertas-page__card alertas-page__card--warning">
                  <span className="alertas-page__card-count">{resumen.bajos}</span>
                  <span className="alertas-page__card-label">Bajo mínimo</span>
                </div>
                <div className="alertas-page__card alertas-page__card--info">
                  <span className="alertas-page__card-count">{resumen.total}</span>
                  <span className="alertas-page__card-label">Total alertas</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tabla */}
        <DataList
          columns={columns}
          rows={currentRows}
          loading={loading}
          keyFn={(r) =>
            tipo === 'vencimiento'
              ? `${r.id_bodega}-${r.id_producto}-${r.lote || ''}-${r.fecha_vencimiento || ''}`
              : `${r.id_bodega}-${r.id_producto}`
          }
          // Resaltar la fila según la severidad de la alerta: borde
          // izquierdo de color + fondo sutil para que las críticas salten
          // a la vista sin tener que leer el badge.
          rowClass={(r) => {
            const t = tipo === 'vencimiento' ? getTipoAlerta(r) : getMinimoAlerta(r);
            return `alertas-page__row alertas-page__row--sev${t.severity}`;
          }}
          onRowClick={(r) => {
            const q = r.nombre_producto || r.sku || '';
            navigate(`/existencias?q=${encodeURIComponent(q)}`);
          }}
          cardActions={(r) => (
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                goToKardex(r);
              }}
            >
              Kardex
            </Button>
          )}
          emptyTitle={tipo === 'vencimiento' ? 'Sin alertas' : 'Sin alertas de stock mínimo'}
          emptyMessage={
            tipo === 'vencimiento'
              ? 'No hay productos próximos a vencer en el rango seleccionado.'
              : 'Todos los productos tienen stock suficiente. Revisa Límites para configurar mínimos.'
          }
          emptyIcon="⚠"
        />
        {!loading && currentRows.length > 0 && (
          <p className="alertas-page__row-hint">
            Haz clic → existencias · Botón Kardex → historial
          </p>
        )}
      </div>

      {/* Selector de columnas para exportación */}
      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={exportColumns}
        storageKey={`export-columns-alertas-${tipo}`}
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(currentRows, {
            filename: `${tipo === 'vencimiento' ? 'alertas_vencimiento' : 'alertas_stock_minimo'}_${new Date().toISOString().slice(0, 10)}`,
            columns: cols,
            format: (row, col) => {
              if (col.key === 'fecha_vencimiento' && row.fecha_vencimiento) {
                return String(row.fecha_vencimiento).slice(0, 10);
              }
              return row[col.key];
            },
          });
          setShowColumnSelector(false);
        }}
      />
    </>
  );
}
