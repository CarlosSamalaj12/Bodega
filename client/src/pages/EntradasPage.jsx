import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { DataList } from '@/components/ui/DataList';
import { SearchInput } from '@/components/ui/SearchInput';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDebounce } from '@/hooks/useDebounce';
import { catalogosService } from '@/services/catalogos.service';
import { entradasService } from '@/services/entradas.service';
import { EntradaForm } from '@/components/entradas/EntradaForm';
import { MovimientoDetailModal } from '@/components/shared/MovimientoDetailModal';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { PinModal } from '@/components/ui/PinModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import './EntradasPage.scss';

export default function EntradasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = permisos['action.create_update'] !== false;
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [motivos, setMotivos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [bodega, setBodega] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [entradas, setEntradas] = useState([]);
  const [loadingEntradas, setLoadingEntradas] = useState(true);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [revertPinOpen, setRevertPinOpen] = useState(false);
  const [revertingId, setRevertingId] = useState(null);
  const [showAnulados, setShowAnulados] = useState(false);
  const debouncedSearch = useDebounce(search, 250);

  // Leer ?open=ID de la URL para abrir detalle automáticamente
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      setDetailId(Number(openId));
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCatalogs = useCallback(async () => {
    setLoadingCatalogs(true);
    setCatalogError(null);
    try {
      const [mot, prov, bds] = await Promise.all([
        catalogosService.getMotivos(),
        catalogosService.getProveedores(),
        catalogosService.getBodegas(),
      ]);
      const motivosValidos = (mot || []).filter((m) =>
        ['ENTRADA', 'AJUSTE'].includes(String(m.tipo_movimiento || '').toUpperCase())
      );
      setMotivos(motivosValidos);
      setProveedores(prov || []);
      const idWh = Number(user?.id_warehouse || 0);
      const found = (bds || []).find((b) => Number(b.id_bodega) === idWh);
      setBodega(found || null);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Error desconocido';
      setCatalogError(msg);
    } finally {
      setLoadingCatalogs(false);
    }
  }, [user]);

  const loadEntradas = useCallback(async () => {
    setLoadingEntradas(true);
    try {
      const data = await entradasService.list();
      setEntradas(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron cargar las entradas');
    } finally {
      setLoadingEntradas(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogs();
    loadEntradas();
  }, [loadCatalogs, loadEntradas]);

  const handleCreated = () => {
    setModalOpen(false);
    loadEntradas();
  };

  const handleRevertClick = (e, id) => {
    e.stopPropagation();
    setRevertingId(Number(id));
    setRevertPinOpen(true);
  };

  const handleRevertConfirm = async (pin) => {
    if (!revertingId) return;
    try {
      await entradasService.revert(revertingId);
      toast.success(`Entrada #${revertingId} revertida correctamente`);
      setRevertPinOpen(false);
      setRevertingId(null);
      loadEntradas();
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo revertir la entrada';
      toast.error(msg);
      setRevertPinOpen(false);
      setRevertingId(null);
    }
  };

  const filtered = useMemo(() => {
    let result = entradas;
    if (!showAnulados) {
      result = result.filter((e) => String(e.estado || '').toUpperCase() !== 'ANULADO');
    }
    if (!debouncedSearch) return result;
    const q = debouncedSearch.toLowerCase();
    return result.filter((e) => {
      const doc = String(e.no_documento || '').toLowerCase();
      const motivo = String(e.nombre_motivo || '').toLowerCase();
      const usuario = String(e.usuario_creador || '').toLowerCase();
      const bodega2 = String(e.bodega || '').toLowerCase();
      const obs = String(e.observaciones || '').toLowerCase();
      const id = String(e.id_movimiento || '');
      return (
        id.includes(q) || doc.includes(q) || motivo.includes(q) ||
        usuario.includes(q) || bodega2.includes(q) || obs.includes(q)
      );
    });
  }, [entradas, debouncedSearch, showAnulados]);

  const bodegaNombre = useMemo(
    () => bodega?.nombre_bodega || user?.bodega_nombre || 'Bodega del usuario',
    [bodega, user]
  );

  const columns = useMemo(() => [
    {
      key: 'id_movimiento',
      label: '#',
      width: 60,
      primary: true,
      render: (e) => <code>#{e.id_movimiento}</code>,
    },
    {
      key: 'fecha',
      label: 'Fecha',
      width: 100,
      render: (e) => <span className="entradas-page__date">{formatDate(e.fecha)}</span>,
    },
    {
      key: 'nombre_motivo',
      label: 'Motivo',
      width: 160,
      render: (e) => (
        <div className="entradas-page__cell-with-obs">
          <span>{e.nombre_motivo || '—'}</span>
          {e.observaciones && (
            <span className="entradas-page__obs-preview" title={e.observaciones}>
              {e.observaciones}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'no_documento',
      label: 'Documento',
      width: 110,
      render: (e) => e.no_documento || '—',
    },
    {
      key: 'total_cantidad',
      label: 'Unidades',
      width: 90,
      align: 'right',
      render: (e) => String(e.total_cantidad ?? '—'),
    },
    {
      key: 'total_costo',
      label: 'Total',
      width: 110,
      align: 'right',
      render: (e) => {
        const total = Number(e.total_costo || 0);
        return <span className="entradas-page__total">{total.toFixed(2)}</span>;
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 90,
      render: (e) => {
        const isAnulado = String(e.estado || '').toUpperCase() === 'ANULADO';
        if (isAnulado) {
          const anuladoPor = e.anulado_por_usuario || '';
          const anuladoEn = e.anulado_en ? formatDate(e.anulado_en) : '';
          const tooltip = [anuladoPor && `Por: ${anuladoPor}`, anuladoEn && `Fecha: ${anuladoEn}`].filter(Boolean).join(' | ');
          return <span className="entradas-page__anulado" title={tooltip || undefined}>Anulado</span>;
        }
        return null;
      },
    },
    {
      key: '__acciones',
      label: '',
      width: 80,
      align: 'right',
      render: (e) => {
        const isAnulado = String(e.estado || '').toUpperCase() === 'ANULADO';
        if (isAnulado) return null;
        return (
          <Button
            size="sm"
            variant="subtle"
            onClick={(ev) => handleRevertClick(ev, e.id_movimiento)}
            title="Revertir entrada"
          >
            ↩
          </Button>
        );
      },
    },
  ], []);

  const exportColumns = [
    { key: 'id_movimiento', label: '#' },
    { key: 'fecha', label: 'Fecha' },
    { key: 'nombre_motivo', label: 'Motivo' },
    { key: 'no_documento', label: 'Documento' },
    { key: 'total_lineas', label: 'Líneas' },
    { key: 'total_cantidad', label: 'Unidades' },
    { key: 'total_costo', label: 'Total' },
    { key: 'usuario_creador', label: 'Usuario' },
    { key: 'bodega', label: 'Bodega' },
    { key: 'observaciones', label: 'Observaciones' },
  ];

  return (
    <>
      <Header
        title="Entradas"
        subtitle={`${filtered.length} entrada${filtered.length === 1 ? '' : 's'}`}
        actions={
          <div className="entradas-page__header-actions">
            {filtered.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            {canCreate && (
              <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
                + Nueva entrada
              </Button>
            )}
          </div>
        }
      />

      <div className="entradas-page">
        <Card compact>
          <div className="entradas-page__search-row">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por #, documento, motivo, usuario…"
            />
            <button
              className={`entradas-page__chip ${showAnulados ? 'entradas-page__chip--active' : ''}`}
              onClick={() => setShowAnulados((v) => !v)}
              title={showAnulados ? 'Ocultar anulados' : 'Mostrar anulados'}
            >
              {showAnulados ? '✓' : ''} Anulados
            </button>
          </div>
        </Card>

        <DataList
          columns={columns}
          rows={filtered}
          loading={loadingEntradas}
          keyField="id_movimiento"
          onRowClick={(e) => setDetailId(Number(e.id_movimiento))}
          rowClass={(r) => String(r.estado || '').toUpperCase() === 'ANULADO' ? 'table__row--anulado' : ''}
          emptyTitle={search ? 'Sin resultados' : 'Sin entradas'}
          emptyMessage={search ? 'Intenta con otros términos.' : 'Cuando registres una entrada aparecerá aquí.'}
          emptyIcon="⇣"
          emptyAction={!search && canCreate ? <Button onClick={() => setModalOpen(true)}>Registrar primera entrada</Button> : null}
        />

        <Card
          title="¿Cómo funciona?"
          subtitle="Flujo básico para registrar una entrada"
        >
          <ol className="entradas-page__steps">
            <li>Elige el <strong>motivo</strong> (compra, ajuste, devolución, etc.).</li>
            <li>Selecciona el <strong>proveedor</strong> (opcional, si aplica).</li>
            <li>Captura el <strong>no. de documento</strong> para evitar duplicados.</li>
            <li>Agrega las <strong>líneas</strong>: producto, cantidad, costo unitario.</li>
            <li>Opcional: <strong>lote</strong> y <strong>fecha de caducidad</strong> por línea.</li>
            <li>Confirma y el sistema registra el movimiento y actualiza el stock.</li>
          </ol>
        </Card>

        <Card title="Bodega de destino">
          <p className="entradas-page__bodega">
            <span>Las entradas se registran en:</span>
            <strong>{bodegaNombre}</strong>
          </p>
        </Card>
      </div>

      <MovimientoDetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={`Entrada #${detailId || ''}`}
        service={entradasService}
        idMovimiento={detailId}
      />

      <PinModal
        open={revertPinOpen}
        title="Revertir entrada"
        description={`¿Estás seguro de revertir la entrada #${revertingId}?\n\nSe creará un movimiento inverso que anulará el stock de los productos registrados. Esta acción no se puede deshacer.`}
        submitting={false}
        onConfirm={handleRevertConfirm}
        onCancel={() => { setRevertPinOpen(false); setRevertingId(null); }}
      />

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={exportColumns}
        storageKey="export-columns-entradas"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(filtered, {
            filename: `entradas_${new Date().toISOString().slice(0, 10)}`,
            columns: cols,
            format: (row, col) => {
              if (col.key === 'fecha' && row.fecha) {
                const d = new Date(row.fecha);
                return d.toLocaleString();
              }
              return row[col.key];
            },
          });
          setShowColumnSelector(false);
        }}
      />

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Nueva entrada"
        size="xl"
      >
        {catalogError ? (
          <div className="entradas-page__catalog-error">
            <p><strong>No se pudieron cargar los catálogos.</strong></p>
            <p className="entradas-page__catalog-error-detail">{catalogError}</p>
            <Button variant="subtle" onClick={loadCatalogs}>Reintentar</Button>
          </div>
        ) : (
          <>
            {loadingCatalogs && (
              <div className="entradas-page__loading">
                <Spinner size={18} label="Cargando motivos y proveedores…" />
              </div>
            )}
            <EntradaForm
              motivos={motivos}
              proveedores={proveedores}
              bodegaNombre={bodegaNombre}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onCreated={handleCreated}
              onCancel={() => setModalOpen(false)}
            />
            {!loadingCatalogs && motivos.length === 0 && (
              <div className="entradas-page__warn">
                <p>
                  <strong>No hay motivos de tipo ENTRADA o AJUSTE</strong> registrados.
                  Créalos en <em>Catálogos → Motivos</em> antes de registrar una entrada.
                </p>
              </div>
            )}
            {!loadingCatalogs && proveedores.length === 0 && (
              <div className="entradas-page__hint">
                <p>No hay proveedores activos. Puedes continuar sin proveedor.</p>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
