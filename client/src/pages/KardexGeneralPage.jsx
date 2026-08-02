import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataList } from '@/components/ui/DataList';
import { toast } from '@/components/ui/Toast';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import { kardexService } from '@/services/kardex.service';
import { catalogosService } from '@/services/catalogos.service';
import './KardexPage.scss';

const TIPO_MOVIMIENTO = [
  { value: '', label: 'Todos' },
  { value: 'ENTRADA', label: 'Entradas' },
  { value: 'SALIDA', label: 'Salidas' },
  { value: 'TRANSFERENCIA', label: 'Transferencias' },
  { value: 'AJUSTE', label: 'Ajustes' },
];

function getBadgeVariant(tipo) {
  switch (tipo) {
    case 'ENTRADA': return 'success';
    case 'SALIDA': return 'danger';
    case 'TRANSFERENCIA': return 'info';
    case 'AJUSTE': return 'warning';
    default: return 'default';
  }
}

// Página con la lista general de movimientos (la que estaba antes del
// rediseño por producto). Se accede desde el botón "Ver lista general"
// en la nueva KardexPage.
export default function KardexGeneralPage() {
  const navigate = useNavigate();

  // Filtros — búsqueda diferida (Enter o botón Buscar)
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [tipo, setTipo] = useState('');
  const [categoriaId, setCategoriaId] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Datos
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState(null);

  // Export column selector
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Paginación server-side
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  // Catálogos
  const [categorias, setCategorias] = useState([]);

  // Ref con filtros actuales para evitar recrear fetchKardex
  const filtersRef = useRef({});

  useEffect(() => {
    catalogosService.getCategorias().then(setCategorias).catch(() => {});
  }, []);

  const handleSearch = () => {
    setCommittedSearch(search);
    setPage(1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  useEffect(() => {
    filtersRef.current = { committedSearch, tipo, categoriaId, fromDate, toDate };
  }, [committedSearch, tipo, categoriaId, fromDate, toDate]);

  const fetchKardex = useCallback(async () => {
    setLoading(true);
    try {
      const f = filtersRef.current;
      const params = { limit: pageSize, page };
      if (f.committedSearch) params.q = f.committedSearch;
      if (f.tipo) params.tipo = f.tipo;
      if (f.categoriaId) params.categoria = f.categoriaId;
      if (f.fromDate) params.from = f.fromDate;
      if (f.toDate) params.to = f.toDate;
      const result = await kardexService.list(params);
      setRows(result?.rows || []);
      setTotalPages(result?.totalPages || 1);
      setTotal(result?.total || 0);
    } catch (e) {
      toast.error('No se pudieron cargar los movimientos');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { fetchKardex(); }, [
    fetchKardex,
    committedSearch,
    tipo,
    categoriaId,
    fromDate,
    toDate,
  ]);

  useEffect(() => { setPage(1); }, [committedSearch, tipo, categoriaId, fromDate, toDate, pageSize]);

  const allExportColumns = [
    { key: 'id_movimiento', label: 'ID Mov.' },
    { key: 'fecha', label: 'Fecha' },
    { key: 'hora', label: 'Hora' },
    { key: 'tipo_movimiento', label: 'Tipo' },
    { key: 'nombre_producto', label: 'Producto' },
    { key: 'sku', label: 'SKU' },
    { key: 'lote', label: 'Lote' },
    { key: 'fecha_vencimiento', label: 'Vencimiento' },
    { key: 'cantidad_entrada', label: 'Entrada' },
    { key: 'cantidad_salida', label: 'Salida' },
    { key: 'costo_unitario', label: 'Costo U.' },
    { key: 'total_linea', label: 'Total' },
    { key: 'bodega_kardex', label: 'Bodega' },
    { key: 'no_documento', label: 'Documento' },
    { key: 'usuario_ingreso', label: 'Usuario' },
    { key: 'observaciones', label: 'Observaciones' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(rows, {
      filename: `kardex_${new Date().toISOString().slice(0, 10)}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'fecha') return String(row.creado_en || row.fecha || '').slice(0, 10);
        if (col.key === 'hora') return String(row.creado_en || row.fecha || '').slice(11, 16);
        if (col.key === 'fecha_vencimiento' && row.fecha_vencimiento) return String(row.fecha_vencimiento).slice(0, 10);
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  const handleClearFilters = () => {
    setSearch('');
    setCommittedSearch('');
    setTipo('');
    setCategoriaId(null);
    setFromDate('');
    setToDate('');
  };

  const hasActiveFilters = committedSearch || tipo || categoriaId || fromDate || toDate;

  // Totales
  const totales = useMemo(() => {
    let entradas = 0, salidas = 0;
    for (const r of rows) {
      entradas += Number(r.cantidad_entrada || 0);
      salidas += Number(r.cantidad_salida || 0);
    }
    return { entradas, salidas };
  }, [rows]);

  const columns = useMemo(() => [
    {
      key: 'fecha',
      label: 'Fecha',
      width: 110,
      render: (r) => {
        const d = r.creado_en || r.fecha;
        if (!d) return '—';
        const time = String(d).slice(11, 16);
        return (
          <span className="kardex-page__fecha">
            <span className="kardex-page__fecha-date">{formatDate(d)}</span>
            <span className="kardex-page__fecha-time">{time}</span>
          </span>
        );
      },
    },
    {
      key: 'tipo_movimiento',
      label: 'Tipo',
      width: 130,
      render: (r) => (
        <Badge variant={getBadgeVariant(r.tipo_movimiento)}>
          {r.tipo_movimiento || '—'}
        </Badge>
      ),
    },
    {
      key: 'producto',
      label: 'Producto',
      primary: true,
      render: (r) => (
        <div className="kardex-page__producto">
          <span className="kardex-page__prod-name">{r.nombre_producto}</span>
          {r.sku && <code className="kardex-page__prod-sku">{r.sku}</code>}
        </div>
      ),
    },
    {
      key: 'lote',
      label: 'Lote',
      hideOnMobile: true,
      render: (r) => r.lote || <span className="kardex-page__muted">—</span>,
    },
    {
      key: 'entrada',
      label: 'Entrada',
      width: 80,
      align: 'right',
      render: (r) =>
        Number(r.cantidad_entrada) > 0 ? (
          <span className="kardex-page__qty kardex-page__qty--in">
            +{Number(r.cantidad_entrada)}
          </span>
        ) : (
          <span className="kardex-page__muted">—</span>
        ),
    },
    {
      key: 'salida',
      label: 'Salida',
      width: 80,
      align: 'right',
      render: (r) =>
        Number(r.cantidad_salida) > 0 ? (
          <span className="kardex-page__qty kardex-page__qty--out">
            −{Number(r.cantidad_salida)}
          </span>
        ) : (
          <span className="kardex-page__muted">—</span>
        ),
    },
    {
      key: 'costo',
      label: 'Costo u.',
      width: 90,
      hideOnMobile: true,
      align: 'right',
      render: (r) =>
        r.costo_unitario != null
          ? <span className="kardex-page__costo">{Number(r.costo_unitario).toFixed(2)}</span>
          : <span className="kardex-page__muted">—</span>,
    },
    {
      key: 'bodega',
      label: 'Bodega',
      hideOnMobile: true,
      render: (r) => r.bodega_kardex || '—',
    },
    {
      key: 'usuario',
      label: 'Usuario',
      hideOnMobile: true,
      render: (r) => r.usuario_ingreso || '—',
    },
    {
      key: 'documento',
      label: 'Doc.',
      hideOnMobile: true,
      render: (r) =>
        r.no_documento ? (
          <code className="kardex-page__doc">{r.no_documento}</code>
        ) : (
          <span className="kardex-page__muted">—</span>
        ),
    },
  ], []);

  return (
    <>
      <Header
        title="Kardex — Lista general"
        subtitle={
          loading
            ? 'Cargando…'
            : `${total} movimiento${total === 1 ? '' : 's'}` +
              (total > pageSize ? ` (pág. ${page}/${totalPages})` : '') +
              (totales.entradas > 0 || totales.salidas > 0
                ? ` · +${totales.entradas} / −${totales.salidas}`
                : '')
        }
        actions={
          <div className="kardex-page__header-actions">
            <Button variant="ghost" size="sm" onClick={() => navigate('/kardex')}>
              Ver por producto
            </Button>
            {rows.length > 0 && !loading && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchKardex} disabled={loading}>
              {loading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        }
      />

      <div className="kardex-page">
        {/* Filtros */}
        <Card>
          <div className="kardex-page__filters">
            <div className="kardex-page__search">
              <SearchInput
                value={search}
                onChange={setSearch}
                onKeyDown={handleKeyDown}
                onSearch={handleSearch}
                activeLabel={committedSearch || undefined}
                placeholder="Buscar producto, SKU o usuario…"
              />
            </div>

            <div className="kardex-page__select-group">
              <select
                className="select"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                aria-label="Tipo de movimiento"
              >
                {TIPO_MOVIMIENTO.map((t) => (
                  <option key={`kar-${t.value}`} value={t.value}>{t.label}</option>
                ))}
              </select>

              <select
                className="select"
                value={categoriaId ?? ''}
                onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)}
                aria-label="Categoría"
              >
                <option value="">Todas las categorías</option>
                {categorias.map((c) => (
                  <option key={`kar-cat-${c.id_categoria}`} value={c.id_categoria}>
                    {c.nombre_categoria}
                  </option>
                ))}
              </select>
            </div>

            <div className="kardex-page__date-group">
              <input
                type="date"
                className="input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Fecha desde"
                title="Desde"
              />
              <input
                type="date"
                className="input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Fecha hasta"
                title="Hasta"
              />
            </div>

            {hasActiveFilters && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </Card>

        {/* Tabla */}
        <DataList
          columns={columns}
          rows={rows}
          loading={loading}
          keyFn={(r) => `${r.id_movimiento}-${r.id_detalle}`}
          onRowClick={(r) => setDetailRow(r)}
          emptyTitle={hasActiveFilters ? 'Sin resultados' : 'Sin movimientos'}
          emptyMessage={
            hasActiveFilters
              ? 'Intenta con otros filtros.'
              : 'No hay movimientos registrados en el kardex.'
          }
          emptyIcon="◉"
        />

        {/* Paginación server-side */}
        {total > pageSize && !loading && (
          <Card compact>
            <div className="kardex-page__pagination">
              <span className="kardex-page__pagination-info">
                {total} registro{total !== 1 ? 's' : ''} · Pág. {page} de {totalPages}
              </span>
              <select
                className="kardex-page__pagination-size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Filas por página"
              >
                <option value={25}>25 / pág.</option>
                <option value={50}>50 / pág.</option>
                <option value={100}>100 / pág.</option>
              </select>
              <div className="kardex-page__pagination-controls">
                <button
                  type="button"
                  className="kardex-page__pagination-btn"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹ Anterior
                </button>
                <div className="kardex-page__pagination-pages">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }
                    return (
                      <button
                        key={`kar-${pageNum}`}
                        type="button"
                        className={`kardex-page__pagination-page ${
                          pageNum === page ? 'kardex-page__pagination-page--active' : ''
                        }`}
                        onClick={() => setPage(pageNum)}
                        disabled={loading}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="kardex-page__pagination-btn"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Siguiente ›
                </button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* === Modal de detalle === */}
      <Modal
        open={detailRow != null}
        onClose={() => setDetailRow(null)}
        title={`Movimiento #${detailRow?.id_movimiento || ''}`}
        size="md"
      >
        {detailRow && (
          <div className="kardex-page__detail">
            <div className="kardex-page__detail-grid">
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Tipo</span>
                <Badge variant={getBadgeVariant(detailRow.tipo_movimiento)}>
                  {detailRow.tipo_movimiento || '—'}
                </Badge>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Fecha / Hora</span>
                <span className="kardex-page__detail-value">
                  {detailRow.creado_en
                    ? `${formatDate(detailRow.creado_en)} ${String(detailRow.creado_en).slice(11, 16)}`
                    : '—'}
                </span>
              </div>
              <div className="kardex-page__detail-field kardex-page__detail-field--full">
                <span className="kardex-page__detail-label">Producto</span>
                <span className="kardex-page__detail-value kardex-page__detail-value--lg">
                  {detailRow.nombre_producto}
                </span>
                {detailRow.sku && <code className="kardex-page__prod-sku">{detailRow.sku}</code>}
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Lote</span>
                <span className="kardex-page__detail-value">{detailRow.lote || '—'}</span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Vencimiento</span>
                <span className="kardex-page__detail-value">
                  {detailRow.fecha_vencimiento
                    ? formatDate(detailRow.fecha_vencimiento)
                    : '—'}
                </span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Cantidad</span>
                <span className={`kardex-page__detail-value kardex-page__detail-value--lg ${
                  Number(detailRow.delta_cantidad) > 0
                    ? 'kardex-page__qty--in'
                    : Number(detailRow.delta_cantidad) < 0
                      ? 'kardex-page__qty--out'
                      : ''
                }`}>
                  {Number(detailRow.delta_cantidad) > 0
                    ? `+${detailRow.delta_cantidad}`
                    : Number(detailRow.delta_cantidad) < 0
                      ? `${detailRow.delta_cantidad}`
                      : '0'}
                </span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Costo unitario</span>
                <span className="kardex-page__detail-value">
                  {detailRow.costo_unitario != null
                    ? `Q ${Number(detailRow.costo_unitario).toFixed(2)}`
                    : '—'}
                </span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Bodega</span>
                <span className="kardex-page__detail-value">{detailRow.bodega_kardex || '—'}</span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Usuario</span>
                <span className="kardex-page__detail-value">{detailRow.usuario_ingreso || '—'}</span>
              </div>
              <div className="kardex-page__detail-field">
                <span className="kardex-page__detail-label">Documento</span>
                <span className="kardex-page__detail-value">
                  {detailRow.no_documento || '—'}
                </span>
              </div>
              {detailRow.observaciones && (
                <div className="kardex-page__detail-field kardex-page__detail-field--full">
                  <span className="kardex-page__detail-label">Observaciones</span>
                  <span className="kardex-page__detail-value">{detailRow.observaciones}</span>
                </div>
              )}
            </div>

            <div className="kardex-page__detail-actions">
              <Button variant="ghost" onClick={() => setDetailRow(null)}>Cerrar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setDetailRow(null);
                  navigate('/kardex', { state: { productoId: detailRow.id_producto } });
                }}
              >
                Ver kardex de este producto
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-kardex"
        onConfirm={(cols, format) => handleExportWithColumns(cols, format)}
      />
    </>
  );
}
