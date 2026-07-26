import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import api from '@/services/api';
import './AjustesPage.scss';

export default function AjustesPage() {
  const user = useAuthStore((s) => s.user);
  const id_warehouse = Number(user?.id_warehouse || 0);

  // Estado general
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bodega, setBodega] = useState(null);

  // Formulario bodega
  const [nombreBodega, setNombreBodega] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');

  // Configuración toggles
  const [manejaStock, setManejaStock] = useState(false);
  const [permiteConteoFinal, setPermiteConteoFinal] = useState(false);
  const [requierePrecioSalida, setRequierePrecioSalida] = useState(false);
  const [puedeDespachar, setPuedeDespachar] = useState(false);
  const [puedeRecibir, setPuedeRecibir] = useState(false);

  // Logo
  const [logoApp, setLogoApp] = useState('');
  const [logoPrint, setLogoPrint] = useState('');
  const [logoAppPreview, setLogoAppPreview] = useState('');
  const [logoPrintPreview, setLogoPrintPreview] = useState('');
  const [savingLogo, setSavingLogo] = useState(false);

  const loadData = useCallback(async () => {
    if (!id_warehouse) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: wh } = await api.get(`/api/bodegas/${id_warehouse}`);
      setBodega(wh);
      setNombreBodega(wh.nombre_bodega || '');
      setTelefono(wh.telefono_contacto || '');
      setDireccion(wh.direccion_contacto || '');
      setRequierePrecioSalida(Number(wh.requiere_precio_salida || 0) === 1);
      setManejaStock(Number(wh.maneja_stock ?? 1) === 1);
      setPermiteConteoFinal(Number(wh.permite_salida_conteo_final ?? 0) === 1);
      setPuedeDespachar(Number(wh.puede_despachar ?? 1) === 1);
      setPuedeRecibir(Number(wh.puede_recibir ?? 1) === 1);

      // Cargar logo
      try {
        const { data: logoData } = await api.get(`/api/bodegas/${id_warehouse}/logo`);
        setLogoApp(logoData.logo_app_data || '');
        setLogoPrint(logoData.logo_print_data || '');
        setLogoAppPreview(logoData.logo_app_data || '');
        setLogoPrintPreview(logoData.logo_print_data || '');
      } catch {
        // Logo no disponible
      }
    } catch (e) {
      toast.error('Error al cargar configuración');
    } finally {
      setLoading(false);
    }
  }, [id_warehouse]);

  useEffect(() => { loadData(); }, [loadData]);

  // Guardar info bodega + configuración
  const handleSave = async () => {
    if (!nombreBodega.trim()) {
      toast.error('El nombre de la bodega es obligatorio');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/bodegas/${id_warehouse}`, {
        nombre_bodega: nombreBodega.trim(),
        tipo_bodega: bodega?.tipo_bodega || 'PRINCIPAL',
        telefono_contacto: telefono.trim() || null,
        direccion_contacto: direccion.trim() || null,
        maneja_stock: manejaStock ? 1 : 0,
        permite_salida_conteo_final: permiteConteoFinal ? 1 : 0,
        requiere_precio_salida: requierePrecioSalida ? 1 : 0,
        puede_despachar: puedeDespachar ? 1 : 0,
        puede_recibir: puedeRecibir ? 1 : 0,
      });
      toast.success('Configuración guardada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // Guardar logo
  const handleSaveLogo = async () => {
    setSavingLogo(true);
    try {
      await api.put(`/api/bodegas/${id_warehouse}/logo`, {
        logo_app_data: logoAppPreview || null,
        logo_print_data: logoPrintPreview || null,
      });
      setLogoApp(logoAppPreview);
      setLogoPrint(logoPrintPreview);
      toast.success('Logo actualizado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al guardar logo');
    } finally {
      setSavingLogo(false);
    }
  };

  // Convertir archivo a base64
  const toBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleLogoFile = async (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await toBase64(file);
    setter(b64);
  };

  const hasLogoChanges = logoApp !== logoAppPreview || logoPrint !== logoPrintPreview;

  if (!id_warehouse) {
    return (
      <>
        <Header title="Ajustes" subtitle="Configuración del sistema" />
        <div className="ajustes-page">
          <Card><p className="ajustes-page__no-warehouse">No hay una bodega asignada a tu usuario.</p></Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Ajustes"
        subtitle={bodega ? `Configuración de ${bodega.nombre_bodega || 'la bodega'}` : 'Configuración del sistema'}
      />

      <div className="ajustes-page">
        {loading ? (
          <div className="ajustes-page__state"><Spinner size={20} label="Cargando configuración…" /></div>
        ) : (
          <>
            {/* === Información de la Bodega === */}
            <Card header={<h3 className="ajustes-page__section-title">🏢 Información de la Bodega</h3>}>
              <div className="ajustes-page__form">
                <div className="ajustes-page__field">
                  <label className="ajustes-page__label">Nombre</label>
                  <input
                    type="text"
                    className="input"
                    value={nombreBodega}
                    onChange={(e) => setNombreBodega(e.target.value)}
                  />
                </div>
                <div className="ajustes-page__field">
                  <label className="ajustes-page__label">Teléfono de contacto</label>
                  <input
                    type="text"
                    className="input"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Ej: 502 1234 5678"
                  />
                </div>
                <div className="ajustes-page__field">
                  <label className="ajustes-page__label">Dirección</label>
                  <input
                    type="text"
                    className="input"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    placeholder="Dirección física de la bodega"
                  />
                </div>
              </div>
            </Card>

            {/* === Configuración === */}
            <Card header={<h3 className="ajustes-page__section-title">⚙️ Configuración de Operaciones</h3>}>
              <div className="ajustes-page__toggles">
                <label className="ajustes-page__toggle">
                  <input type="checkbox" className="ajustes-page__checkbox" checked={manejaStock} onChange={(e) => setManejaStock(e.target.checked)} />
                  <div className="ajustes-page__toggle-text">
                    <span className="ajustes-page__toggle-title">Maneja stock</span>
                    <span className="ajustes-page__toggle-desc">La bodega lleva control de inventario</span>
                  </div>
                </label>
                <label className="ajustes-page__toggle">
                  <input type="checkbox" className="ajustes-page__checkbox" checked={permiteConteoFinal} onChange={(e) => setPermiteConteoFinal(e.target.checked)} />
                  <div className="ajustes-page__toggle-text">
                    <span className="ajustes-page__toggle-title">Salida por conteo final</span>
                    <span className="ajustes-page__toggle-desc">Permite registrar salidas con conteo final de inventario</span>
                  </div>
                </label>
                <label className="ajustes-page__toggle">
                  <input type="checkbox" className="ajustes-page__checkbox" checked={requierePrecioSalida} onChange={(e) => setRequierePrecioSalida(e.target.checked)} />
                  <div className="ajustes-page__toggle-text">
                    <span className="ajustes-page__toggle-title">Requerir precio en salidas</span>
                    <span className="ajustes-page__toggle-desc">Obliga a ingresar precio unitario al registrar una salida</span>
                  </div>
                </label>
                <label className="ajustes-page__toggle">
                  <input type="checkbox" className="ajustes-page__checkbox" checked={puedeDespachar} onChange={(e) => setPuedeDespachar(e.target.checked)} />
                  <div className="ajustes-page__toggle-text">
                    <span className="ajustes-page__toggle-title">Puede despachar pedidos</span>
                    <span className="ajustes-page__toggle-desc">La bodega puede surtir pedidos solicitados por otras bodegas</span>
                  </div>
                </label>
                <label className="ajustes-page__toggle">
                  <input type="checkbox" className="ajustes-page__checkbox" checked={puedeRecibir} onChange={(e) => setPuedeRecibir(e.target.checked)} />
                  <div className="ajustes-page__toggle-text">
                    <span className="ajustes-page__toggle-title">Puede recibir transferencias</span>
                    <span className="ajustes-page__toggle-desc">La bodega puede recibir transferencias de inventario</span>
                  </div>
                </label>
              </div>
            </Card>

            {/* Botón guardar configuración */}
            <div className="ajustes-page__actions">
              <Button variant="primary" onClick={handleSave} disabled={saving || !nombreBodega.trim()}>
                {saving ? 'Guardando…' : 'Guardar configuración'}
              </Button>
            </div>

            {/* === Logo de Bodega === */}
            <Card header={<h3 className="ajustes-page__section-title">🖼️ Logo de la Bodega</h3>}>
              <div className="ajustes-page__logo-section">
                <div className="ajustes-page__logo-field">
                  <label className="ajustes-page__label">Logo para la app (web/móvil)</label>
                  <input type="file" accept="image/*" onChange={(e) => handleLogoFile(e, setLogoAppPreview)} />
                  {logoAppPreview && (
                    <div className="ajustes-page__logo-preview">
                      <img src={logoAppPreview} alt="Logo app" />
                    </div>
                  )}
                </div>
                <div className="ajustes-page__logo-field">
                  <label className="ajustes-page__label">Logo para impresión (PDF)</label>
                  <input type="file" accept="image/*" onChange={(e) => handleLogoFile(e, setLogoPrintPreview)} />
                  {logoPrintPreview && (
                    <div className="ajustes-page__logo-preview">
                      <img src={logoPrintPreview} alt="Logo impresión" />
                    </div>
                  )}
                </div>
              </div>
              {hasLogoChanges && (
                <div className="ajustes-page__actions" style={{ marginTop: '1rem' }}>
                  <Button variant="primary" onClick={handleSaveLogo} disabled={savingLogo}>
                    {savingLogo ? 'Guardando…' : 'Guardar logo'}
                  </Button>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
