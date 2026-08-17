import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardKey } from '@/components/ui/KeyboardKey';
import { Shortcuts } from '@/hooks/useShortcut.jsx';
import { useShortcutsStore } from '@/stores/shortcuts.store';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useCatalogosStore } from '@/stores/catalogos.store';
import { salidasService } from '@/services/salidas.service';
import { SalidaForm } from '@/components/salidas/SalidaForm';
import { MovimientoDetailModal } from '@/components/shared/MovimientoDetailModal';
import { MovimientosListTable } from '@/components/shared/MovimientosListTable';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { PinModal } from '@/components/ui/PinModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import './SalidasPage.scss';

export default function SalidasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = hasPermission(permisos, 'action.create_update');
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Catálogos cacheados globalmente
  const motivos = useCatalogosStore((s) => s.motivos);
  const bodega = useCatalogosStore((s) => s.bodegaUser);
  const catalogError = useCatalogosStore((s) => s.error);
  const loadingCatalogs = useCatalogosStore((s) => s.isLoading);
  const fetchCatalogos = useCatalogosStore((s) => s.fetchAll);

  const [detailId, setDetailId] = useState(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [revertPinOpen, setRevertPinOpen] = useState(false);
  const [revertingId, setRevertingId] = useState(null);
  const [showAnulados, setShowAnulados] = useState(false);
  // reloadKey cambia después de crear/revertir — la tabla hace refresh incremental
  const [reloadKey, setReloadKey] = useState(0);

  // Leer ?open=ID de la URL para abrir detalle automáticamente
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      setDetailId(Number(openId));
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Asegurar que los catálogos están cargados
  useEffect(() => {
    fetchCatalogos();
  }, [fetchCatalogos]);

  // Filtrar motivos válidos para salidas
  const motivosValidos = useMemo(
    () => motivos.filter((m) => ['SALIDA', 'AJUSTE'].includes(String(m.tipo_movimiento || '').toUpperCase())),
    [motivos]
  );

  const handleCreated = () => {
    setModalOpen(false);
    setReloadKey((k) => k + 1);
  };

  const handleRevertClick = (id) => {
    setRevertingId(Number(id));
    setRevertPinOpen(true);
  };

  const handleRevertConfirm = async (pin) => {
    if (!revertingId) return;
    try {
      await salidasService.revert(revertingId, pin);
      toast.success(`Salida #${revertingId} revertida correctamente`);
      setRevertPinOpen(false);
      setRevertingId(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo revertir la salida';
      toast.error(msg);
      setRevertPinOpen(false);
      setRevertingId(null);
    }
  };

  const bodegaNombre = useMemo(
    () => bodega?.nombre_bodega || user?.bodega_nombre || 'Bodega del usuario',
    [bodega, user]
  );

  // -------- Atajos globales de la pantalla de Salidas --------
  const getCombo = useShortcutsStore((s) => s.getCombo);
  const newCombo = getCombo('salidas.new');
  const refreshCombo = getCombo('salidas.refresh');

  const handleNewShortcut = useCallback(() => {
    if (!canCreate) return;
    if (modalOpen) return;
    setModalOpen(true);
  }, [canCreate, modalOpen]);

  const handleRefreshShortcut = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const pageShortcuts = (
    <Shortcuts
      map={{
        'salidas.new': { handler: handleNewShortcut, page: ['/salidas'] },
        'salidas.refresh': { handler: handleRefreshShortcut, page: ['/salidas'] },
      }}
    />
  );

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
      {pageShortcuts}
      <Header
        title="Salidas"
        subtitle="Salidas recientes de la bodega"
        autoHide
        actions={
          <div className="salidas-page__header-actions">
            <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
              Exportar
            </Button>
            {canCreate && (
              <Button
                size={isMobile ? 'sm' : 'md'}
                onClick={() => setModalOpen(true)}
                title={newCombo ? `Nueva salida (${newCombo})` : 'Nueva salida'}
              >
                + Nueva salida
                {newCombo && <KeyboardKey combo={newCombo} />}
              </Button>
            )}
          </div>
        }
      />

      <div className="salidas-page">
        <MovimientosListTable
          service={salidasService}
          tipoLabel="SALIDA"
          emptyTitle="Sin salidas"
          emptyMessage="Cuando registres una salida aparecerá aquí."
          emptyIcon="⇡"
          reloadKey={reloadKey}
          showAnulados={showAnulados}
          onToggleAnulados={() => setShowAnulados((v) => !v)}
          onRowDetail={(id) => setDetailId(Number(id))}
          onRevertClick={handleRevertClick}
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
          salidasService.list({ limit: 500 }).then((rows) => {
            fn(rows || [], {
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
          }).catch(() => toast.error('No se pudo exportar'));
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
            <Button variant="subtle" onClick={fetchCatalogos}>Reintentar</Button>
          </div>
        ) : (
          <>
            {loadingCatalogs && (
              <div className="salidas-page__loading">
                <Spinner size={18} label="Cargando motivos…" />
              </div>
            )}
            <SalidaForm
              motivos={motivosValidos}
              bodegaNombre={bodegaNombre}
              submitting={submitting}
              onSubmittingChange={setSubmitting}
              onCreated={handleCreated}
              onCancel={() => setModalOpen(false)}
            />
            {!loadingCatalogs && motivosValidos.length === 0 && (
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
