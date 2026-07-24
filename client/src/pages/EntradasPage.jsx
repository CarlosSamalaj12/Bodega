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
import { EntradaForm } from '@/components/entradas/EntradaForm';
import './EntradasPage.scss';

export function EntradasPage() {
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

  // Carga catálogos una sola vez
  const loadCatalogs = useCallback(async () => {
    setLoadingCatalogs(true);
    setCatalogError(null);
    try {
      const [mot, prov, bds] = await Promise.all([
        catalogosService.getMotivos(),
        catalogosService.getProveedores(),
        catalogosService.getBodegas(),
      ]);
      console.info('[Entradas] catálogos cargados', {
        motivos: mot?.length,
        proveedores: prov?.length,
        bodegas: bds?.length,
      });
      // Solo motivos ENTRADA o AJUSTE
      const motivosValidos = (mot || []).filter((m) =>
        ['ENTRADA', 'AJUSTE'].includes(String(m.tipo_movimiento || '').toUpperCase())
      );
      console.info('[Entradas] motivos filtrados (ENTRADA/AJUSTE):', motivosValidos.length);
      setMotivos(motivosValidos);
      setProveedores(prov || []);
      const idWh = Number(user?.id_warehouse || 0);
      const found = (bds || []).find((b) => Number(b.id_bodega) === idWh);
      setBodega(found || null);
    } catch (e) {
      console.error('[Entradas] error cargando catálogos', e);
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
        title="Entradas"
        subtitle="Registra entradas de productos a tu bodega"
        actions={
          canCreate && (
            <Button size={isMobile ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>
              + Nueva entrada
            </Button>
          )
        }
      />

      <div className="entradas-page">
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
