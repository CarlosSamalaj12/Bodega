import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { catalogosService } from '@/services/catalogos.service';
import { entradasService } from '@/services/entradas.service';
import { EntradaForm } from '@/components/entradas/EntradaForm';
import { MovimientoDetailModal } from '@/components/shared/MovimientoDetailModal';
import { MovimientosListTable } from '@/components/shared/MovimientosListTable';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { PinModal } from '@/components/ui/PinModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import './EntradasPage.scss';

export default function EntradasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const permisos = user?.permisos || {};
  const canCreate = hasPermission(permisos, 'action.create_update');
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [motivos, setMotivos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [bodega, setBodega] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  const [detailId, setDetailId] = useState(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [revertPinOpen, setRevertPinOpen] = useState(false);
  const [revertingId, setRevertingId] = useState(null);
  const [showAnulados, setShowAnulados] = useState(false);
  // reloadKey cambia después de crear/revertir para que la tabla vuelva a fetchear
  const [reloadKey, setReloadKey] = useState(0);

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

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

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
      await entradasService.revert(revertingId, pin);
      toast.success(`Entrada #${revertingId} revertida correctamente`);
      setRevertPinOpen(false);
      setRevertingId(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo revertir la entrada';
      toast.error(msg);
      setRevertPinOpen(false);
      setRevertingId(null);
    }
  };

  const bodegaNombre = useMemo(
    () => bodega?.nombre_bodega || user?.bodega_nombre || 'Bodega del usuario',
    [bodega, user]
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
      <Header
        title="Entradas"
        subtitle="Entradas recientes de la bodega"
        actions={
          <div className="entradas-page__header-actions">
            {canCreate && (
              <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
                + Nueva entrada
              </Button>
            )}
          </div>
        }
      />

      <div className="entradas-page">
        <MovimientosListTable
          service={entradasService}
          tipoLabel="ENTRADA"
          emptyTitle="Sin entradas"
          emptyMessage="Cuando registres una entrada aparecerá aquí."
          emptyIcon="⇣"
          reloadKey={reloadKey}
          showAnulados={showAnulados}
          onToggleAnulados={() => setShowAnulados((v) => !v)}
          onRowDetail={(id) => setDetailId(Number(id))}
          onRevertClick={handleRevertClick}
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

        <div className="entradas-page__footer-actions">
          <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
            Exportar (resumen)
          </Button>
        </div>
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
          // Para exportación usamos los datos del reporte plano: la tabla ya los
          // tiene cargados, pero por simplicidad volvemos a fetchear.
          entradasService.list({ limit: 500 }).then((rows) => {
            const flat = [];
            for (const m of rows || []) {
              flat.push(m);
            }
            fn(flat, {
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
          }).catch(() => toast.error('No se pudo exportar'));
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
