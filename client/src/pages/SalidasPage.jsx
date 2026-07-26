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
import { salidasService } from '@/services/salidas.service';
import { SalidaForm } from '@/components/salidas/SalidaForm';
import { MovimientoDetailModal } from '@/components/shared/MovimientoDetailModal';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { PinModal } from '@/components/ui/PinModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import './SalidasPage.scss';

export default function SalidasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = permisos['action.create_update'] !== false;
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [motivos, setMotivos] = useState([]);
  const [bodega, setBodega] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [salidas, setSalidas] = useState([]);
  const [loadingSalidas, setLoadingSalidas] = useState(true);
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
      const [mot, bds] = await Promise.all([
        catalogosService.getMotivos(),
        catalogosService.getBodegas(),
      ]);
      const motivosValidos = (mot || []).filter((m) =>
        ['SALIDA', 'AJUSTE'].includes(String(m.tipo_movimiento || '').toUpperCase())
      );
      setMotivos(motivosValidos);
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

  const loadSalidas = useCallback(async () => {
    setLoadingSalidas(true);
    try {
      const data = await salidasService.list();
      setSalidas(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron cargar las salidas');
    } finally {
      setLoadingSalidas(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogs();
    loadSalidas();
  }, [loadCatalogs, loadSalidas]);

  const handleCreated = () => {
    setModalOpen(false);
    loadSalidas();
  };

  const handleRevertClick = (e, id) => {
    e.stopPropagation();
    setRevertingId(Number(id));
    setRevertPinOpen(true);
  };

  const handleRevertConfirm = async (pin) => {
    if (!revertingId) return;
    try {
      await salidasService.revert(revertingId);
      toast.success(`Salida #${revertingId} revertida correctamente`);
      setRevertPinOpen(false);
      setRevertingId(null);
      loadSalidas();
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo revertir la salida';
      toast.error(msg);
      setRevertPinOpen(false);
      setRevertingId(null);
    }
  };

  const filtered = useMemo(() => {
    let result = salidas;
    if (!showAnulados) {
      result = result.filter((s) => String(s.estado || '').toUpperCase() !== 'ANULADO');
    }
    if (!debouncedSearch) return result;
    const q = debouncedSearch.toLowerCase();
    return result.filter((s) => {
      const doc = String(s.no_documento || '').toLowerCase();
      const motivo = String(s.nombre_motivo || '').toLowerCase();
      const usuario = String(s.usuario_creador || '').toLowerCase();
      const bodega2 = String(s.bodega || '').toLowerCase();
      const obs = String(s.observaciones || '').toLowerCase();
      const id = String(s.id_movimiento || '');
      return (
        id.includes(q) || doc.includes(q) || motivo.includes(q) ||
        usuario.includes(q) || bodega2.includes(q) || obs.includes(q)
      );
    });
  }, [salidas, debouncedSearch, showAnulados]);

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
      render: (s) => <code>#{s.id_movimiento}</code>,
    },
    {
      key: 'fecha',
      label: 'Fecha',
      width: 100,
      render: (s) => <span className="salidas-page__date">{formatDate(s.fecha)}</span>,
    },
    {
      key: 'nombre_motivo',
      label: 'Motivo',
      width: 160,
      render: (s) => (
        <div className="salidas-page__cell-with-obs">
          <span>{s.nombre_motivo || '—'}</span>
          {s.observaciones && (
            <span className="salidas-page__obs-preview" title={s.observaciones}>
              {s.observaciones}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'no_documento',
      label: 'Documento',
      width: 110,
      render: (s) => s.no_documento || '—',
    },
    {
      key: 'total_cantidad',
      label: 'Unidades',
      width: 90,
      align: 'right',
      render: (s) => String(s.total_cantidad ?? '—'),
    },
    {
      key: 'total_costo',
      label: 'Total',
      width: 110,
      align: 'right',
      render: (s) => {
        const total = Number(s.total_costo || 0);
        return <span className="salidas-page__total">{total.toFixed(2)}</span>;
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      width: 90,
      render: (s) => {
        const isAnulado = String(s.estado || '').toUpperCase() === 'ANULADO';
        if (isAnulado) {
          const anuladoPor = s.anulado_por_usuario || '';
          const anuladoEn = s.anulado_en ? formatDate(s.anulado_en) : '';
          const tooltip = [anuladoPor && `Por: ${anuladoPor}`, anuladoEn && `Fecha: ${anuladoEn}`].filter(Boolean).join(' | ');
          return <span className="salidas-page__anulado" title={tooltip || undefined}>Anulado</span>;
        }
        return null;
      },
    },
    {
      key: '__acciones',
      label: '',
      width: 80,
      align: 'right',
      render: (s) => {
        const isAnulado = String(s.estado || '').toUpperCase() === 'ANULADO';
        if (isAnulado) return null;
        return (
          <Button
            size="sm"
            variant="subtle"
            onClick={(ev) => handleRevertClick(ev, s.id_movimiento)}
            title="Revertir salida"
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
        title="Salidas"
        subtitle={`${filtered.length} salida${filtered.length === 1 ? '' : 's'}`}
        actions={
          <div className="salidas-page__header-actions">
            {filtered.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                Exportar CSV
              </Button>
            )}
            {canCreate && (
              <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
                + Nueva salida
              </Button>
            )}
          </div>
        }
      />

      <div className="salidas-page">
        <Card compact>
          <div className="salidas-page__search-row">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por #, documento, motivo, usuario…"
            />
            <button
              className={`salidas-page__chip ${showAnulados ? 'salidas-page__chip--active' : ''}`}
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
          loading={loadingSalidas}
          keyField="id_movimiento"
          onRowClick={(s) => setDetailId(Number(s.id_movimiento))}
          rowClass={(r) => String(r.estado || '').toUpperCase() === 'ANULADO' ? 'table__row--anulado' : ''}
          emptyTitle={search ? 'Sin resultados' : 'Sin salidas'}
          emptyMessage={search ? 'Intenta con otros términos.' : 'Cuando registres una salida aparecerá aquí.'}
          emptyIcon="⇡"
          emptyAction={!search && canCreate ? <Button onClick={() => setModalOpen(true)}>Registrar primera salida</Button> : null}
        />

        <Card
          title="¿Cómo funciona?"
          subtitle="Flujo básico para registrar una salida"
        >
          <ol className="salidas-page__steps">
            <li>Elige el <strong>motivo</strong> (consumo, transferencia, merma, etc.).</li>
            <li>Opcional: captura el <strong>no. de documento</strong> de referencia.</li>
            <li>Agrega las <strong>líneas</strong>: producto, cantidad, costo unitario.</li>
            <li>Opcional: <strong>lote</strong> por línea.</li>
            <li>Confirma y el sistema registra el movimiento y descuenta el stock.</li>
          </ol>
        </Card>

        <Card title="Bodega de origen">
          <p className="salidas-page__bodega">
            <span>Las salidas se descuentan de:</span>
            <strong>{bodegaNombre}</strong>
          </p>
        </Card>
      </div>

      <MovimientoDetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={`Salida #${detailId || ''}`}
        service={salidasService}
        idMovimiento={detailId}
      />

      <PinModal
        open={revertPinOpen}
        title="Revertir salida"
        description={`¿Estás seguro de revertir la salida #${revertingId}?\n\nSe creará un movimiento inverso que devolverá el stock de los productos. Esta acción no se puede deshacer.`}
        submitting={false}
        onConfirm={handleRevertConfirm}
        onCancel={() => { setRevertPinOpen(false); setRevertingId(null); }}
      />

      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={exportColumns}
        storageKey="export-columns-salidas"
        onConfirm={(cols, format) => {
          const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
          fn(filtered, {
            filename: `salidas_${new Date().toISOString().slice(0, 10)}`,
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
        title="Nueva salida"
        size="xl"
      >
        {catalogError ? (
          <div className="salidas-page__catalog-error">
            <p><strong>No se pudieron cargar los catálogos.</strong></p>
            <p className="salidas-page__catalog-error-detail">{catalogError}</p>
            <Button variant="subtle" onClick={loadCatalogs}>Reintentar</Button>
          </div>
        ) : (
          <>
            {loadingCatalogs && (
              <div className="salidas-page__loading">
                <Spinner size={18} label="Cargando motivos…" />
              </div>
            )}
            <SalidaForm
              motivos={motivos}
              bodegaNombre={bodegaNombre}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onCreated={handleCreated}
              onCancel={() => setModalOpen(false)}
            />
            {!loadingCatalogs && motivos.length === 0 && (
              <div className="salidas-page__warn">
                <p>
                  <strong>No hay motivos de tipo SALIDA o AJUSTE</strong> registrados.
                  Créalos en <em>Catálogos → Motivos</em> antes de registrar una salida.
                </p>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
