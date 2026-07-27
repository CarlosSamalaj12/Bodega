import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/utils/format';
import api from '@/services/api';
import './ConteoCiclicoPage.scss';

const ESTADO_MAP = {
  BORRADOR: { label: 'Borrador', variant: 'secondary' },
  EN_PROGRESO: { label: 'En progreso', variant: 'info' },
  COMPLETADO: { label: 'Completado', variant: 'warning' },
  AJUSTADO: { label: 'Ajustado', variant: 'success' },
};

export default function ConteoCiclicoPage() {
  const [conteos, setConteos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedConteo, setSelectedConteo] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Crear
  const [showCreate, setShowCreate] = useState(false);
  const [bodegas, setBodegas] = useState([]);
  const [createData, setCreateData] = useState({ id_bodega: '', observaciones: '' });
  const [creating, setCreating] = useState(false);

  // Actualizar conteo
  const [updatingId, setUpdatingId] = useState(null);

  // Completar/Ajustar
  const [actionLoading, setActionLoading] = useState(false);

  const fetchConteos = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/conteo-ciclico');
      setConteos(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Error al cargar conteos');
      setConteos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConteos(); }, [fetchConteos]);

  const openCreate = async () => {
    try {
      const { data } = await api.get('/api/bodegas?all=1');
      setBodegas(Array.isArray(data) ? data : []);
    } catch {
      toast.error('No se pudieron cargar bodegas');
    }
    setCreateData({ id_bodega: '', observaciones: '' });
    setShowCreate(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createData.id_bodega) return;
    setCreating(true);
    try {
      const { data } = await api.post('/api/conteo-ciclico', createData);
      toast.success(`Conteo #${data.id_conteo} creado (${data.total_lineas} productos)`);
      setShowCreate(false);
      fetchConteos();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo crear el conteo');
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id) => {
    setDetailLoading(true);
    setShowDetail(true);
    try {
      const { data } = await api.get(`/api/conteo-ciclico/${id}`);
      setSelectedConteo(data.conteo);
      setDetalles(Array.isArray(data.detalles) ? data.detalles : []);
    } catch {
      toast.error('Error al cargar detalle');
      setShowDetail(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUpdateCantidad = async (idDetalle, cantidad) => {
    if (!selectedConteo) return;
    setUpdatingId(idDetalle);
    try {
      await api.patch(`/api/conteo-ciclico/${selectedConteo.id_conteo}/detalle/${idDetalle}`, {
        cantidad_conteo: cantidad !== '' ? cantidad : null,
      });
      setDetalles((prev) =>
        prev.map((d) =>
          d.id_detalle === idDetalle
            ? {
                ...d,
                cantidad_conteo: cantidad !== '' ? Number(cantidad) : null,
                diferencia: cantidad !== '' ? Number(cantidad) - Number(d.cantidad_sistema) : null,
              }
            : d
        )
      );
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al actualizar');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCompletar = async () => {
    if (!selectedConteo) return;
    if (!window.confirm('¿Marcar este conteo como COMPLETADO? Ya no se podrán modificar las cantidades.')) return;
    setActionLoading(true);
    try {
      await api.post(`/api/conteo-ciclico/${selectedConteo.id_conteo}/completar`);
      toast.success('Conteo completado');
      setShowDetail(false);
      fetchConteos();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al completar');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAjustar = async () => {
    if (!selectedConteo) return;
    const diffs = detalles.filter((d) => d.cantidad_conteo != null && Number(d.cantidad_conteo) !== Number(d.cantidad_sistema));
    if (diffs.length === 0) {
      toast.error('No hay diferencias para ajustar');
      return;
    }
    if (!window.confirm(`¿Ajustar inventario? Se crearán movimientos de ajuste para ${diffs.length} producto${diffs.length !== 1 ? 's' : ''} con diferencias.`)) return;
    setActionLoading(true);
    try {
      const { data } = await api.post(`/api/conteo-ciclico/${selectedConteo.id_conteo}/ajustar`);
      const msgs = (data.movimientos || []).map((m) => `#${m.id_movimiento} (${m.tipo})`);
      toast.success(`Ajustes creados: ${msgs.join(', ')}`);
      setShowDetail(false);
      fetchConteos();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error al ajustar');
    } finally {
      setActionLoading(false);
    }
  };

  const lineasContadas = useMemo(
    () => detalles.filter((d) => d.cantidad_conteo != null).length,
    [detalles]
  );
  const lineasConDiferencia = useMemo(
    () => detalles.filter((d) => d.cantidad_conteo != null && Number(d.cantidad_conteo) !== Number(d.cantidad_sistema)).length,
    [detalles]
  );

  const bodegaOptions = [
    { value: '', label: 'Seleccionar bodega…' },
    ...bodegas
      .filter((b) => Number(b.activo || 0) === 1 && Number(b.maneja_stock || 0) === 1)
      .map((b) => ({ value: String(b.id_bodega), label: b.nombre_bodega })),
  ];

  const estadoBadge = (estado) => {
    const cfg = ESTADO_MAP[estado] || ESTADO_MAP.BORRADOR;
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  return (
    <>
      <Header
        title="Conteo Cíclico"
        subtitle={`${conteos.length} conteo${conteos.length === 1 ? '' : 's'}`}
        actions={
          <Button variant="primary" size="sm" onClick={openCreate}>
            + Nuevo conteo
          </Button>
        }
      />

      <div className="conteo-ciclico-page">
        {loading ? (
          <div className="conteo-ciclico-page__state"><Spinner size={20} label="Cargando conteos…" /></div>
        ) : conteos.length === 0 ? (
          <EmptyState icon="📋" title="Sin conteos" message="No hay conteos cíclicos aún. Crea uno nuevo para comenzar." />
        ) : (
          <div className="conteo-ciclico-page__table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>Fecha</th>
                  <th>Bodega</th>
                  <th>Estado</th>
                  <th>Líneas</th>
                  <th>Contadas</th>
                  <th>Creado por</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {conteos.map((c) => (
                  <tr key={`cco-cont-${c.id_conteo}`} className="conteo-ciclico-page__row">
                    <td><code>#{c.id_conteo}</code></td>
                    <td>{formatDate(c.fecha_conteo)}</td>
                    <td>{c.nombre_bodega}</td>
                    <td>{estadoBadge(c.estado)}</td>
                    <td>{c.total_lineas}</td>
                    <td>{c.lineas_contadas}</td>
                    <td className="conteo-ciclico-page__user">{c.creado_por_nombre || '—'}</td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => openDetail(c.id_conteo)}>
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal crear */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Nuevo conteo cíclico"
        size="md"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={!createData.id_bodega || creating}>
              {creating ? <Spinner size={14} /> : 'Crear conteo'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreate} className="conteo-ciclico-page__form">
          <Select
            label="Bodega"
            value={createData.id_bodega}
            onChange={(e) => setCreateData((p) => ({ ...p, id_bodega: e.target.value }))}
            options={bodegaOptions}
            required
          />
          <Input
            label="Observaciones (opcional)"
            value={createData.observaciones}
            onChange={(e) => setCreateData((p) => ({ ...p, observaciones: e.target.value }))}
            placeholder="Notas sobre el conteo"
          />
        </form>
      </Modal>

      {/* Modal detalle */}
      <Modal
        open={showDetail}
        onClose={() => setShowDetail(false)}
        title={
          selectedConteo
            ? `Conteo #${selectedConteo.id_conteo} — ${selectedConteo.nombre_bodega}`
            : 'Detalle del conteo'
        }
        size="xl"
        footer={
          selectedConteo && (
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
              <span className="conteo-ciclico-page__footer-info">
                {lineasContadas}/{detalles.length} contadas
                {lineasConDiferencia > 0 && ` · ${lineasConDiferencia} con diferencia`}
              </span>
              <div style={{ flex: 1 }} />
              {selectedConteo.estado !== 'COMPLETADO' && selectedConteo.estado !== 'AJUSTADO' && (
                <>
                  <Button variant="warning" size="sm" onClick={handleCompletar} disabled={actionLoading}>
                    {actionLoading ? <Spinner size={14} /> : 'Completar conteo'}
                  </Button>
                </>
              )}
              {selectedConteo.estado === 'COMPLETADO' && (
                <Button variant="primary" size="sm" onClick={handleAjustar} disabled={actionLoading}>
                  {actionLoading ? <Spinner size={14} /> : 'Ajustar inventario'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowDetail(false)}>
                Cerrar
              </Button>
            </div>
          )
        }
      >
        {detailLoading ? (
          <div className="conteo-ciclico-page__state"><Spinner size={20} label="Cargando detalle…" /></div>
        ) : selectedConteo ? (
          <div className="conteo-ciclico-page__detail">
            <div className="conteo-ciclico-page__detail-header">
              <div className="conteo-ciclico-page__detail-meta">
                <span>Estado: {estadoBadge(selectedConteo.estado)}</span>
                <span>Fecha: {formatDate(selectedConteo.fecha_conteo)}</span>
                {selectedConteo.observaciones && (
                  <span className="conteo-ciclico-page__detail-obs">Nota: {selectedConteo.observaciones}</span>
                )}
              </div>
            </div>

            <div className="conteo-ciclico-page__table-wrapper">
              <table className="table table--sm">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style={{ width: 70 }}>SKU</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Sistema</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Conteo</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Diferencia</th>
                    <th style={{ width: 80 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalles.map((d) => {
                    const sist = Number(d.cantidad_sistema || 0);
                    const cont = d.cantidad_conteo != null ? Number(d.cantidad_conteo) : null;
                    const dif = cont != null ? cont - sist : null;
                    const editable =
                      selectedConteo.estado !== 'COMPLETADO' && selectedConteo.estado !== 'AJUSTADO';
                    return (
                      <tr
                        key={`cco-det-${d.id_detalle}`}
                        className={`conteo-ciclico-page__det-row ${dif !== null && dif !== 0 ? 'conteo-ciclico-page__det-row--diff' : ''}`}
                      >
                        <td>{d.nombre_producto}</td>
                        <td>{d.sku ? <code>{d.sku}</code> : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {sist.toFixed(3)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {editable ? (
                            <input
                              type="number"
                              className="input conteo-ciclico-page__num-input"
                              step="0.001"
                              defaultValue={cont != null ? cont : ''}
                              placeholder="—"
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (String(val) !== (cont != null ? String(cont) : '')) {
                                  handleUpdateCantidad(d.id_detalle, val);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.target.blur();
                              }}
                            />
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)' }}>
                              {cont != null ? cont.toFixed(3) : '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {dif != null ? (
                            <span className={dif > 0 ? 'conteo-ciclico-page__diff-pos' : 'conteo-ciclico-page__diff-neg'}>
                              {dif > 0 ? '+' : ''}{dif.toFixed(3)}
                            </span>
                          ) : (
                            <span className="conteo-ciclico-page__diff-pend">—</span>
                          )}
                        </td>
                        <td>
                          {dif === null ? (
                            <Badge variant="secondary">Pendiente</Badge>
                          ) : dif === 0 ? (
                            <Badge variant="success">Ok</Badge>
                          ) : (
                            <Badge variant="warning">Diferencia</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
