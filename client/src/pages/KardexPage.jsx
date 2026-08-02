import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ProductPicker } from '@/components/ui/ProductPicker';
import { toast } from '@/components/ui/Toast';
import { kardexService } from '@/services/kardex.service';
import { productosService } from '@/services/productos.service';
import { catalogosService } from '@/services/catalogos.service';
import './KardexPage.scss';

const TIPO_FILTRO = [
  { value: '', label: 'Todos los tipos' },
  { value: 'ENTRADA', label: 'Entradas' },
  { value: 'SALIDA', label: 'Salidas' },
  { value: 'TRANSFERENCIA', label: 'Transferencias' },
  { value: 'AJUSTE', label: 'Ajustes' },
];

// Límite de movimientos a mostrar por producto. Si el producto tiene
// más, se muestra un aviso y se puede navegar al histórico completo.
const MAX_MOVIMIENTOS = 500;

export default function KardexPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // Si llegamos con state.productoId (desde "Ver kardex de este producto"
  // en KardexGeneralPage), lo capturamos para auto-seleccionar.
  const incomingProductoId = location.state?.productoId;

  // ─── Producto seleccionado ───
  const [producto, setProducto] = useState(null); // { id_producto, nombre_producto, sku, id_categoria, id_subcategoria, ... }

  // ─── Scope: mi bodega vs todas las bodegas con acceso ───
  // Por defecto la vista por producto muestra TODAS las bodegas a las que
  // el usuario tiene acceso (más útil para entender el historial completo
  // de un producto, especialmente si el stock está en otra bodega).
  // El usuario puede activar "Solo mi bodega" si quiere acotar.
  const [todasLasBodegas, setTodasLasBodegas] = useState(true);

  // ─── Filtros por-producto ───
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loteFiltro, setLoteFiltro] = useState('');

  // ─── Datos ───
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // ─── Catálogos (para mostrar nombre de categoría/subcategoría en el header) ───
  const [categorias, setCategorias] = useState([]);

  useEffect(() => {
    catalogosService.getCategorias().then(setCategorias).catch(() => {});
  }, []);

  // Si llegamos con location.state.productoId, cargamos el producto
  // y lo dejamos pre-seleccionado (viene de "Ver kardex de este producto"
  // en KardexGeneralPage).
  useEffect(() => {
    if (!incomingProductoId) return;
    let cancelled = false;
    (async () => {
      try {
        // La búsqueda por id la hacemos con un truco: usamos el servicio
        // de listado y filtramos por id. Como getById puede no existir
        // en este servicio, lo resolvemos con una búsqueda exacta.
        // Si el producto existe, lo seteamos.
        const data = await productosService.list({ q: incomingProductoId, limit: 5, all: 1 });
        const found = (data?.rows || []).find(
          (p) => Number(p.id_producto) === Number(incomingProductoId)
        );
        if (!cancelled && found) setProducto(found);
      } catch {
        // Silencioso: si falla, el usuario puede buscar manualmente
      }
    })();
    return () => { cancelled = true; };
    // Solo al montar o cuando cambia el id de la URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingProductoId]);

  // ─── Fetch del kardex del producto ───
  const filtersRef = useRef({});
  useEffect(() => {
    filtersRef.current = { tipoFiltro, fromDate, toDate, loteFiltro, todasLasBodegas };
  }, [tipoFiltro, fromDate, toDate, loteFiltro, todasLasBodegas]);

  const fetchKardexProducto = useCallback(async () => {
    if (!producto?.id_producto) {
      setRows([]);
      setHasMore(false);
      return;
    }
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = {
        producto: producto.id_producto,
        // El endpoint /api/reportes/kardex responde { rows, total, ... } SOLO
        // si recibe ?page=; si no, devuelve un array plano (modo legacy) y
        // result.rows queda undefined → la vista siempre decía "Sin movimientos".
        page: 1,
        limit: MAX_MOVIMIENTOS + 1,
        tipo: f.tipoFiltro || undefined,
        from: f.fromDate || undefined,
        to: f.toDate || undefined,
        lote: f.loteFiltro || undefined,
        all_bodegas: f.todasLasBodegas ? 1 : undefined,
      };
      const result = await kardexService.list(params);
      const dataRows = result?.rows || [];
      const hayMas = dataRows.length > MAX_MOVIMIENTOS;
      setRows(hayMas ? dataRows.slice(0, MAX_MOVIMIENTOS) : dataRows);
      setHasMore(hayMas);
    } catch (e) {
      console.error('[KardexPage] error:', e);
      toast.error('No se pudieron cargar los movimientos del producto');
      setRows([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [producto?.id_producto]);

  useEffect(() => {
    fetchKardexProducto();
  }, [fetchKardexProducto, tipoFiltro, fromDate, toDate, loteFiltro, todasLasBodegas]);

  // ─── Derivados: separar entradas y salidas, calcular totales ───
  const { entradas, salidas, totales } = useMemo(() => {
    const ents = [];
    const sals = [];
    let totalEnt = 0;
    let totalSal = 0;
    // Stock = entradas - salidas (lo que el server reporta también,
    // pero lo calculamos local para mostrar en el header).
    for (const r of rows) {
      const e = Number(r.cantidad_entrada || 0);
      const s = Number(r.cantidad_salida || 0);
      totalEnt += e;
      totalSal += s;
      if (e > 0) ents.push(r);
      if (s > 0) sals.push(r);
    }
    return {
      entradas: ents,
      salidas: sals,
      totales: { entradas: totalEnt, salidas: totalSal, stock: totalEnt - totalSal },
    };
  }, [rows]);

  // Stock reportado por el server (toma en cuenta la bodega del usuario).
  // Si el server lo devuelve, lo usamos; si no, usamos el calculado.
  const stockReportado = useMemo(() => {
    if (!rows.length) return null;
    const v = Number(rows[0].stock_total_producto);
    return Number.isFinite(v) ? v : null;
  }, [rows]);

  // ─── Datos del header del producto ───
  const productoHeader = useMemo(() => {
    if (!producto) return null;
    const categoria = categorias.find((c) => Number(c.id_categoria) === Number(producto.id_categoria));
    return {
      nombre: producto.nombre_producto || 'Producto sin nombre',
      sku: producto.sku,
      categoria: categoria?.nombre_categoria,
    };
  }, [producto, categorias]);

  // ─── Render de cada movimiento (mismo formato para ambas columnas) ───
  const renderMovimiento = (r) => {
    const fecha = r.creado_en || r.fecha;
    const fechaStr = fecha ? String(fecha).slice(0, 10) : '—';
    const horaStr = fecha ? String(fecha).slice(11, 16) : '';
    return (
      <div key={`${r.id_movimiento}-${r.id_detalle}`} className="kardex-page__mov">
        <div className="kardex-page__mov-fecha">
          <span className="kardex-page__mov-fecha-date">{fechaStr}</span>
          {horaStr && <span className="kardex-page__mov-fecha-time">{horaStr}</span>}
        </div>
        <div className="kardex-page__mov-tipo">
          <span className={`kardex-page__mov-tipo-badge kardex-page__mov-tipo-badge--${r.tipo_movimiento?.toLowerCase()}`}>
            {r.tipo_movimiento}
          </span>
        </div>
        <div className="kardex-page__mov-cantidad">
          <span className={`kardex-page__mov-cantidad-val ${
            Number(r.cantidad_entrada) > 0 ? 'kardex-page__mov-cantidad-val--in'
              : Number(r.cantidad_salida) > 0 ? 'kardex-page__mov-cantidad-val--out'
              : ''
          }`}>
            {Number(r.cantidad_entrada) > 0
              ? `+${r.cantidad_entrada}`
              : Number(r.cantidad_salida) > 0
                ? `−${r.cantidad_salida}`
                : '0'}
          </span>
        </div>
        <div className="kardex-page__mov-meta">
          {r.bodega_kardex && <span className="kardex-page__mov-bodega">📍 {r.bodega_kardex}</span>}
          {r.lote && <span className="kardex-page__mov-lote">Lote: {r.lote}</span>}
          {r.no_documento && <code className="kardex-page__mov-doc">{r.no_documento}</code>}
        </div>
      </div>
    );
  };

  // ─── Handler de producto: si está vacío, limpia todo ───
  const handleProductoChange = (p) => {
    setProducto(p || null);
    if (!p) {
      setRows([]);
      setHasMore(false);
    }
  };

  // ─── Limpiar filtros por-producto ───
  const handleClearFilters = () => {
    setTipoFiltro('');
    setFromDate('');
    setToDate('');
    setLoteFiltro('');
  };

  const hasActiveFilters = tipoFiltro || fromDate || toDate || loteFiltro;

  return (
    <>
      <Header
        title="Kardex por producto"
        subtitle={
          producto
            ? `Vista detallada · ${entradas.length + salidas.length} movimiento${entradas.length + salidas.length === 1 ? '' : 's'}`
            : 'Selecciona un producto para ver su historial'
        }
        actions={
          <div className="kardex-page__header-actions">
            <Button variant="ghost" size="sm" onClick={() => navigate('/kardex-general')}>
              Ver lista general
            </Button>
          </div>
        }
      />

      <div className="kardex-page">
        {/* ═══════ Selector de producto + filtros ═══════ */}
        <Card>
          <div className="kardex-page__selector">
            <div className="kardex-page__producto-picker">
              <label className="kardex-page__label">Producto</label>
              <ProductPicker
                value={producto}
                onChange={handleProductoChange}
                placeholder="Buscar por nombre o SKU…"
              />
            </div>

            {producto && (
              <div className="kardex-page__subfiltros">
                <select
                  className="select"
                  value={tipoFiltro}
                  onChange={(e) => setTipoFiltro(e.target.value)}
                  aria-label="Tipo de movimiento"
                >
                  {TIPO_FILTRO.map((t) => (
                    <option key={`tipo-${t.value}`} value={t.value}>{t.label}</option>
                  ))}
                </select>

                <input
                  type="text"
                  className="input"
                  value={loteFiltro}
                  onChange={(e) => setLoteFiltro(e.target.value)}
                  placeholder="Lote (opcional)"
                  aria-label="Lote"
                />

                <input
                  type="date"
                  className="input"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  aria-label="Desde"
                  title="Desde"
                />

                <input
                  type="date"
                  className="input"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  aria-label="Hasta"
                  title="Hasta"
                />

                {hasActiveFilters && (
                  <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                    Limpiar
                  </Button>
                )}

                <label className="kardex-page__scope-toggle" title="Por defecto vemos el kardex en todas las bodegas a las que tenés acceso. Desactivá esta opción para ver solo tu bodega.">
                  <input
                    type="checkbox"
                    checked={todasLasBodegas}
                    onChange={(e) => setTodasLasBodegas(e.target.checked)}
                  />
                  <span>📦 Todas las bodegas (con acceso)</span>
                </label>
              </div>
            )}
          </div>
        </Card>

        {/* ═══════ Estado: sin producto ═══════ */}
        {!producto && (
          <Card>
            <div className="kardex-page__empty">
              <div className="kardex-page__empty-icon">📊</div>
              <h3 className="kardex-page__empty-title">Selecciona un producto</h3>
              <p className="kardex-page__empty-msg">
                Usá el buscador de arriba para encontrar un producto y ver su historial de movimientos.
                Vas a poder ver entradas, salidas y el stock actual lado a lado.
              </p>
            </div>
          </Card>
        )}

        {/* ═══════ Estado: producto seleccionado ═══════ */}
        {producto && (
          <>
            {/* ── Header del producto + totales ── */}
            <Card>
              <div className="kardex-page__producto-header">
                <div className="kardex-page__producto-info">
                  <h2 className="kardex-page__producto-nombre">
                    {productoHeader?.nombre}
                  </h2>
                  <div className="kardex-page__producto-meta">
                    {productoHeader?.sku && (
                      <code className="kardex-page__producto-sku">SKU: {productoHeader.sku}</code>
                    )}
                    {productoHeader?.categoria && (
                      <span className="kardex-page__producto-cat">📂 {productoHeader.categoria}</span>
                    )}
                  </div>
                </div>

                <div className="kardex-page__stats">
                  <div className="kardex-page__stat kardex-page__stat--in">
                    <span className="kardex-page__stat-label">Entradas</span>
                    <span className="kardex-page__stat-valor">+{totales.entradas}</span>
                  </div>
                  <div className="kardex-page__stat kardex-page__stat--out">
                    <span className="kardex-page__stat-label">Salidas</span>
                    <span className="kardex-page__stat-valor">−{totales.salidas}</span>
                  </div>
                  <div className="kardex-page__stat kardex-page__stat--stock">
                    <span className="kardex-page__stat-label">Stock</span>
                    <span className="kardex-page__stat-valor">
                      {stockReportado != null ? stockReportado : totales.stock}
                    </span>
                    {stockReportado != null && (
                      <span className="kardex-page__stat-hint">
                        (en tu bodega{totales.stock !== stockReportado ? ` · global: ${totales.stock}` : ''})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Loading ── */}
            {loading ? (
              <Card>
                <div className="kardex-page__loading">
                  <Spinner size={20} label="Cargando movimientos…" />
                </div>
              </Card>
            ) : (entradas.length === 0 && salidas.length === 0) ? (
              /* ── Sin movimientos ── */
              <Card>
                <div className="kardex-page__empty">
                  <div className="kardex-page__empty-icon">📭</div>
                  <h3 className="kardex-page__empty-title">Sin movimientos</h3>
                  <p className="kardex-page__empty-msg">
                    {hasActiveFilters
                      ? 'No hay movimientos que coincidan con los filtros aplicados.'
                      : 'Este producto aún no tiene movimientos registrados.'}
                  </p>
                  {!todasLasBodegas && !hasActiveFilters && (
                    <p className="kardex-page__empty-hint">
                      💡 Estás viendo solo tu bodega. Activá el toggle <strong>"📦 Todas las bodegas (con acceso)"</strong> arriba
                      para ver si el producto tiene movimientos en otras bodegas donde tenés acceso.
                    </p>
                  )}
                  {hasActiveFilters && !todasLasBodegas && (
                    <p className="kardex-page__empty-hint">
                      💡 Probá desactivar los filtros de fecha o activar <strong>"Todas las bodegas"</strong> arriba.
                    </p>
                  )}
                </div>
              </Card>
            ) : (
              /* ── Dos columnas: entradas | salidas ── */
              <>
                {hasMore && (
                  <div className="kardex-page__more-banner">
                    ⚠️ Mostrando los primeros {MAX_MOVIMIENTOS} movimientos.
                    Aplicá filtros de fecha o tipo para acotar la vista.
                  </div>
                )}

                <div className="kardex-page__columns">
                  {/* ═══ Columna izquierda: ENTRADAS ═══ */}
                  <Card className="kardex-page__column kardex-page__column--in">
                    <div className="kardex-page__column-head">
                      <h3 className="kardex-page__column-title">
                        <span className="kardex-page__column-dot kardex-page__column-dot--in" />
                        Entradas
                      </h3>
                      <span className="kardex-page__column-count">{entradas.length}</span>
                    </div>
                    {entradas.length === 0 ? (
                      <div className="kardex-page__column-empty">Sin entradas en este período.</div>
                    ) : (
                      <div className="kardex-page__movs">
                        {entradas.map(renderMovimiento)}
                      </div>
                    )}
                  </Card>

                  {/* ═══ Columna derecha: SALIDAS ═══ */}
                  <Card className="kardex-page__column kardex-page__column--out">
                    <div className="kardex-page__column-head">
                      <h3 className="kardex-page__column-title">
                        <span className="kardex-page__column-dot kardex-page__column-dot--out" />
                        Salidas
                      </h3>
                      <span className="kardex-page__column-count">{salidas.length}</span>
                    </div>
                    {salidas.length === 0 ? (
                      <div className="kardex-page__column-empty">Sin salidas en este período.</div>
                    ) : (
                      <div className="kardex-page__movs">
                        {salidas.map(renderMovimiento)}
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

KardexPage.propTypes = {};
