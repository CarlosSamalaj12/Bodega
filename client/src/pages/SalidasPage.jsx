import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { catalogosService } from '@/services/catalogos.service';
import { SalidaForm } from '@/components/salidas/SalidaForm';
import './SalidasPage.scss';

export function SalidasPage() {
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

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

  const handleCreated = () => {
    setModalOpen(false);
  };

  const bodegaNombre = useMemo(
    () => bodega?.nombre_bodega || user?.bodega_nombre || 'Bodega del usuario',
    [bodega, user]
  );

  return (
    <>
      <Header
        title="Salidas"
        subtitle="Registra salidas de productos desde tu bodega"
        actions={
          canCreate && (
            <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
              + Nueva salida
            </Button>
          )
        }
      />

      <div className="salidas-page">
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
