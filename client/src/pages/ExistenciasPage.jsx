import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { existenciasService } from '@/services/existencias.service';
import { catalogosService } from '@/services/catalogos.service';
import './ExistenciasPage.scss';

function getAlertBadge(item) {
  const stock = Number(item.stock || 0);
  const minimo = Number(item.minimo_stock || 0);
  const maximo = Number(item.maximo_stock || 0);
  const diasVencer = item.dias_para_vencer != null ? Number(item.dias_para_vencer) : null;
  const alertaDias = item.dias_alerta_antes != null ? Number(item.dias_alerta_antes) : null;

  if (minimo > 0 && stock < minimo) return { label: 'Stock bajo', variant: 'danger' };
  if (maximo > 0 && stock > maximo) return { label: 'Stock alto', variant: 'warning' };
  if (diasVencer != null && alertaDias != null && diasVencer <= alertaDias && diasVencer >= 0)
    return { label: `Vence en ${diasVencer}d`, variant: 'warning' };
  if (diasVencer != null && diasVencer < 0) return { label: 'Vencido', variant: 'danger' };
  return null;
}

/** Obtener el peor badge de alerta para un grupo de lotes */
function getGroupAlert(grupo) {
  let worst = null;
  const order = { danger: 3, warning: 2, info: 1 };
  for (const lot of grupo.lotes) {
    const a = getAlertBadge(lot);
    if (a && (!worst || (order[a.variant] || 0) > (order[worst.variant] || 0))) worst = a;
  }
  // Si stock total < mínimo del grupo
  if (grupo.minimo > 0 && grupo.stockTotal < grupo.minimo) {
    if (!worst || (order.danger || 0) >= (order[worst.variant] || 0))
      return { label: 'Stock bajo', variant: 'danger' };
  }
  return worst;
}

export default function ExistenciasPage() {
  const [searchParams] = useSearchParams();
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [committedSearch, setCommittedSearch] = useState(() => searchParams.get('q') || '');
  const [categoriaId, setCategoriaId] = useState(null);
  const [subcategoriaId, setSubcategoriaId] = useState(null);
  const [bodegaId, setBodegaId] = useState(null);
  const [showZeroStock, setShowZeroStock] = useState(() => searchParams.get('show_zero') === '1');

  // Paginación
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

  const [categorias, setCategorias] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [cleaning, setCleaning] = useState(false);
  const cleaningRef = useRef(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Ref con filtros actuales para evitar recrear fetchExistencias
  const filtersRef = useRef({});

  useEffect(() => {
    catalogosService.getCategorias().then(setCategorias).catch(() => {});
    catalogosService.getBodegas().then(setBodegas).catch(() => {});
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
    setPage(1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Mantener ref actualizada con los filtros (no triggea re-renders)
  filtersRef.current = { committedSearch, categoriaId, subcategoriaId, bodegaId, showZeroStock };

  const fetchExistencias = useCallback(async () => {
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = { limit: 100, page };
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.subcategoriaId) params.subcategoria = f.subcategoriaId;
      if (f.bodegaId) params.warehouse = f.bodegaId;
      if (f.showZeroStock) params.show_zero = '1';
      const result = await existenciasService.list(params);
      setRows(result?.rows || []);
      setTotalPages(result?.totalPages || 1);
      setTotal(result?.total || 0);
    } catch (e) {
      toast.error('No se pudieron cargar las existencias');
    } finally {
      setLoading(false);
    }
  }, [page]); // Solo cambia cuando cambia page

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [committedSearch, categoriaId, subcategoriaId, bodegaId, showZeroStock]);

  // Re-fetch cuando cambian los filtros (leídos del ref) o la paginación
  useEffect(() => { fetchExistencias(); }, [
    fetchExistencias,
    committedSearch,
    categoriaId,
    subcategoriaId,
    bodegaId,
    showZeroStock,
  ]);

  // Agrupar filas por producto+bodega
  const grupos = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.id_producto}-${r.id_bodega}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          id_producto: r.id_producto,
          id_bodega: r.id_bodega,
          nombre_producto: r.nombre_producto,
          sku: r.sku,
          nombre_bodega: r.nombre_bodega,
          nombre_subcategoria: r.nombre_subcategoria,
          minimo: Number(r.minimo_stock || 0),
          maximo: Number(r.maximo_stock || 0),
          stockTotal: 0,
          valorTotal: 0,
          lotes: [],
        });
      }
      const g = map.get(key);
      g.lotes.push(r);
      g.stockTotal += Number(r.stock || 0);
      g.valorTotal += Number(r.total_linea || 0);
    }
    return Array.from(map.values());
  }, [rows]);

  const toggleGroup = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const resumen = useMemo(() => {
    let totalStock = 0, totalValor = 0, bajoMinimo = 0;
    for (const g of grupos) {
      totalStock += g.stockTotal;
      totalValor += g.valorTotal;
      if (g.minimo > 0 && g.stockTotal < g.minimo) bajoMinimo++;
    }
    return { totalStock, totalValor, totalProductos: grupos.length, bajoMinimo };
  }, [grupos]);

  const handleClearFilters = () => {
    if (cleaningRef.current) clearTimeout(cleaningRef.current);
    setCleaning(true);
    setSubcategoriaId(null);
    cleaningRef.current = setTimeout(() => {
      setSearch('');
      setCommittedSearch('');
      setCategoriaId(null);
      setBodegaId(null);
      setShowZeroStock(false);
      setCleaning(false);
      cleaningRef.current = null;
    }, 250);
  };

  const hasActiveFilters = committedSearch || categoriaId || subcategoriaId || bodegaId || showZeroStock;

  const exportColumns = [
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'nombre_bodega', label: 'Bodega' },
    { key: 'nombre_subcategoria', label: 'Subcategoría' },
    { key: 'stock', label: 'Stock' },
    { key: 'lote', label: 'Lote' },
    { key: 'fecha_vencimiento', label: 'Vencimiento' },
    { key: 'minimo_stock', label: 'Stock mínimo' },
    { key: 'maximo_stock', label: 'Stock máximo' },
    { key: 'costo_unitario_ref', label: 'Costo unitario' },
    { key: 'total_linea', label: 'Total línea' },
    { key: 'dias_para_vencer', label: 'Días por vencer' },
  ];

  // ---- Render helpers ----
  const renderProdName = (r) => (
    <div className="existencias-page__producto">
      <span className="existencias-page__prod-name">{r.nombre_producto}</span>
      {r.sku && <code className="existencias-page__prod-sku">{r.sku}</code>}
    </div>
  );

  const renderStock = (val, low) => (
    <span className={`existencias-page__stock ${low ? 'existencias-page__stock--low' : ''}`}>{val}</span>
  );

  const renderVencimiento = (r) => {
    if (!r.fecha_vencimiento) return <span className="existencias-page__muted">—</span>;
    const dias = r.dias_para_vencer;
    const isVencido = dias != null && dias < 0;
    const isProximo = dias != null && dias >= 0 && r.dias_alerta_antes != null && dias <= r.dias_alerta_antes;
    return (
      <span className={`existencias-page__vencimiento ${isVencido ? 'existencias-page__vencimiento--vencido' : ''} ${isProximo ? 'existencias-page__vencimiento--proximo' : ''}`}>
        {formatDate(r.fecha_vencimiento)}
        {dias != null && <span className="existencias-page__dias">{dias >= 0 ? `${dias}d` : 'Vencido'}</span>}
      </span>
    );
  };

  const renderCosto = (val) => Number(val || 0) > 0
    ? <span className="existencias-page__costo">Q {Number(val).toFixed(2)}</span>
    : <span className="existencias-page__muted">—</span>;

  const renderMinMax = (val) => Number(val || 0) > 0 ? Number(val) : <span className="existencias-page__muted">—</span>;

  // ================== RENDER ==================
  const renderContent = () => {
    if (loading) {
      return (
        <div className="existencias-page__state">
          <Spinner size={20} label="Cargando existencias…" />
        </div>
      );
    }

    if (grupos.length === 0) {
      return (
        <EmptyState
          icon="◧"
          title={hasActiveFilters ? 'Sin resultados' : 'Sin existencias'}
          message={hasActiveFilters ? 'Intenta con otros filtros.' : 'No hay productos con stock en el sistema.'}
        />
      );
    }

    // ---- Móvil: cards expandibles ----
    if (isMobile) {
      return (
        <>
          <div className="existencias-page__cards">
            {grupos.map((g) => {
            const isOpen = expanded.has(g.key);
            const alert = getGroupAlert(g);
            return (
              <div key={`exi-grp-${g.key}`} className="existencias-page__group-card">
                <button
                  type="button"
                  className="existencias-page__group-card-header"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={isOpen}
                >
                  <span className="existencias-page__group-card-arrow">{isOpen ? '▾' : '▸'}</span>
                  <div className="existencias-page__group-card-info">
                    <div className="existencias-page__group-card-title">{renderProdName(g)}</div>
                    <div className="existencias-page__group-card-meta">
                      {g.nombre_bodega} · {g.stockTotal} uds · {g.lotes.length} lote{g.lotes.length !== 1 ? 's' : ''}
                      {alert && <Badge variant={alert.variant}>{alert.label}</Badge>}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="existencias-page__group-card-body">
                    <div className="existencias-page__group-card-totals">
                      <span>Stock total: <strong>{g.stockTotal}</strong></span>
                      <span>Valor total: <strong>Q {g.valorTotal.toFixed(2)}</strong></span>
                    </div>
                    {g.lotes.map((lot, i) => {
                      const lotAlert = getAlertBadge(lot);
                      return (
                        <div key={`exi-${i}`} className="existencias-page__lot-row">
                          <div className="existencias-page__lot-field">
                            <span className="existencias-page__lot-label">Stock</span>
                            <span className="existencias-page__lot-value">
                              {renderStock(Number(lot.stock), Number(lot.stock) <= Number(lot.minimo_stock || 0) && Number(lot.minimo_stock) > 0)}
                            </span>
                          </div>
                          <div className="existencias-page__lot-field">
                            <span className="existencias-page__lot-label">Lote</span>
                            <span className="existencias-page__lot-value">{lot.lote || '—'}</span>
                          </div>
                          <div className="existencias-page__lot-field">
                            <span className="existencias-page__lot-label">Vence</span>
                            <span className="existencias-page__lot-value">{renderVencimiento(lot)}</span>
                          </div>
                          <div className="existencias-page__lot-field">
                            <span className="existencias-page__lot-label">Costo</span>
                            <span className="existencias-page__lot-value">{renderCosto(lot.costo_unitario_ref)}</span>
                          </div>
                          <div className="existencias-page__lot-field">
                            <span className="existencias-page__lot-label">Total</span>
                            <span className="existencias-page__lot-value">{renderCosto(lot.total_linea)}</span>
                          </div>
                          {lotAlert && (
                            <div className="existencias-page__lot-badge">
                              <Badge variant={lotAlert.variant}>{lotAlert.label}</Badge>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} loading={loading} />
        </>
      );
    }      // ---- Desktop: tabla expandible ----
    return (
      <>
        <div className="table-wrapper">
        <table className="table table--sm">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>Producto</th>
              <th>Bodega</th>
              <th style={{ width: 80, textAlign: 'right' }}>Stock</th>
              <th style={{ width: 80, textAlign: 'right' }}>Lotes</th>
              <th style={{ width: 60, textAlign: 'right' }}>Mín</th>
              <th style={{ width: 60, textAlign: 'right' }}>Máx</th>
              <th style={{ width: 90, textAlign: 'right' }}>Costo</th>
              <th style={{ width: 100, textAlign: 'right' }}>Total</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              const isOpen = expanded.has(g.key);
              const alert = getGroupAlert(g);
              return (
                <Fragment key={`exi-grp-${g.key}`}>
                  <tr
                    className="existencias-page__group-row"
                    onClick={() => toggleGroup(g.key)}
                  >
                    <td>
                      <span className={`existencias-page__arrow ${isOpen ? 'existencias-page__arrow--open' : ''}`}>
                        ▸
                      </span>
                    </td>
                    <td>{renderProdName(g)}</td>
                    <td>{g.nombre_bodega}</td>
                    <td style={{ textAlign: 'right' }}>{renderStock(g.stockTotal, g.minimo > 0 && g.stockTotal < g.minimo)}</td>
                    <td style={{ textAlign: 'right' }}><code className="existencias-page__lot-count">{g.lotes.length}</code></td>
                    <td style={{ textAlign: 'right' }}>{renderMinMax(g.minimo)}</td>
                    <td style={{ textAlign: 'right' }}>{renderMinMax(g.maximo)}</td>
                    <td style={{ textAlign: 'right' }}>{renderCosto(g.valorTotal > 0 && g.lotes.length > 0 ? g.valorTotal / g.lotes.length : 0)}</td>
                    <td style={{ textAlign: 'right' }}>{renderCosto(g.valorTotal)}</td>
                    <td>{alert && <Badge variant={alert.variant}>{alert.label}</Badge>}</td>
                  </tr>
                  {isOpen && (
                    <tr className="existencias-page__lot-header">
                      <td colSpan={10}>
                        <div className="existencias-page__lot-header-inner">
                          <span className="existencias-page__lot-header-title">Lotes / vencimientos</span>
                          <span className="existencias-page__lot-header-totals">
                            <span className="existencias-page__lot-header-total">
                              Stock total: <strong>{g.stockTotal}</strong>
                            </span>
                            <span className="existencias-page__lot-header-total">
                              Valor total: <strong>Q {g.valorTotal.toFixed(2)}</strong>
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {isOpen && g.lotes.map((lot, i) => (
                    <tr key={`${g.key}-lot-${i}`} className="existencias-page__lot-row">
                      <td></td>
                      <td colSpan={2}>
                        <div className="existencias-page__lot-detail">
                          <span className="existencias-page__lot-detail-item">
                            Lote: <strong>{lot.lote || '—'}</strong>
                          </span>
                          <span className="existencias-page__lot-detail-item">
                            Subcategoría: <strong>{lot.nombre_subcategoria || '—'}</strong>
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {renderStock(Number(lot.stock), Number(lot.stock) <= Number(lot.minimo_stock || 0) && Number(lot.minimo_stock) > 0)}
                      </td>
                      <td colSpan={2}>
                        {renderVencimiento(lot)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {renderCosto(lot.costo_unitario_ref)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {renderCosto(lot.total_linea)}
                      </td>
                      <td>
                        {(() => {
                          const la = getAlertBadge(lot);
                          return la ? <Badge variant={la.variant}>{la.label}</Badge> : null;
                        })()}
                      </td>
                      <td></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
        <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} loading={loading} />
      </>
    );
  };

  return (
    <>
      <Header
        title="Existencias"
        subtitle={
          loading
            ? 'Cargando…'
            : `${total} producto${total === 1 ? '' : 's'}` +
              ` · ${resumen.totalStock} unidades` +
              (resumen.totalValor > 0 ? ` · Q ${resumen.totalValor.toFixed(2)}` : '') +
              (resumen.bajoMinimo > 0 ? ` · ⚠ ${resumen.bajoMinimo} bajo mínimo` : '') +
              (expanded.size > 0 ? ` · ▸ ${expanded.size} expandido${expanded.size !== 1 ? 's' : ''}` : '') +
              (page > 1 ? ` · Pág. ${page}` : '')
        }
        actions={
          <div className="existencias-page__header-actions">
            {rows.length > 0 && !loading && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchExistencias} disabled={loading}>
              {loading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        }
      />

      <div className="existencias-page">
        <Card>
          <div className="existencias-page__filters">
            <div className="existencias-page__search">
              <SearchInput value={search} onChange={setSearch} onKeyDown={handleKeyDown} onSearch={handleSearch} activeLabel={committedSearch || undefined} placeholder="Buscar producto o SKU…" />
            </div>
            <div className="existencias-page__select-group">
              <select className="select" value={categoriaId ?? ''} onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)} aria-label="Categoría">
                <option value="">Todas las categorías</option>
                {categorias.map((c) => <option key={`exi-cat-${c.id_categoria}`} value={c.id_categoria}>{c.nombre_categoria}</option>)}
              </select>
            <div className={`existencias-page__cascade ${categoriaId && !cleaning ? 'existencias-page__cascade--visible' : ''} ${cleaning ? 'existencias-page__cascade--cleaning' : ''}`}>
              <select className="select" value={subcategoriaId ?? ''} onChange={(e) => setSubcategoriaId(e.target.value ? Number(e.target.value) : null)} aria-label="Subcategoría">
                <option value="">Todas las subcategorías</option>
                {subcategorias.map((s) => <option key={`exi-sub-${s.id_subcategoria}`} value={s.id_subcategoria}>{s.nombre_subcategoria}</option>)}
              </select>
            </div>
              <select className="select" value={bodegaId ?? ''} onChange={(e) => setBodegaId(e.target.value ? Number(e.target.value) : null)} aria-label="Bodega">
                <option value="">Todas las bodegas</option>
                {bodegas.map((b) => <option key={`exi-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>)}
              </select>
            </div>
            <label className="existencias-page__checkbox-label" title="Incluir productos sin stock">
              <input
                type="checkbox"
                className="existencias-page__checkbox"
                checked={showZeroStock}
                onChange={(e) => setShowZeroStock(e.target.checked)}
              />
              <span>Stock cero</span>
            </label>
            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>Limpiar filtros</Button>
            )}
          </div>
        </Card>

        {renderContent()}
      </div>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={exportColumns}
        storageKey="export-columns-existencias"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(rows, {
            filename: `existencias_${new Date().toISOString().slice(0, 10)}`,
            columns: cols,
            format: (row, col) => {
              if (col.key === 'fecha_vencimiento' && row.fecha_vencimiento) return String(row.fecha_vencimiento).slice(0, 10);
              if (col.key === 'costo_unitario_ref' || col.key === 'total_linea') return Number(row[col.key] || 0).toFixed(2);
              return row[col.key];
            },
          });
          setShowColumnSelector(false);
        }}
      />
    </>
  );
}
