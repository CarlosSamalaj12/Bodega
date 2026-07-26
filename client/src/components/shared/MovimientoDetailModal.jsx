import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import './MovimientoDetailModal.scss';

/**
 * MovimientoDetailModal — modal que muestra el detalle de un movimiento
 * (entrada o salida) con todas sus líneas.
 */
export function MovimientoDetailModal({ open, onClose, title, service, idMovimiento }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !idMovimiento || !service) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    service
      .getDetail(idMovimiento)
      .then((data) => {
        if (mounted) setDetail(data);
      })
      .catch((e) => {
        if (mounted) setError(e?.response?.data?.error || e.message || 'Error al cargar detalle');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [open, idMovimiento, service]);

  const totales = useMemo(() => {
    if (!detail?.lines) return { unidades: 0, costo: 0 };
    let unidades = 0;
    let costo = 0;
    for (const l of detail.lines) {
      unidades += Number(l.cantidad || 0);
      costo += Number(l.total_linea || 0);
    }
    return { unidades, costo };
  }, [detail]);

  return (
    <Modal open={open} onClose={onClose} title={title || 'Detalle del movimiento'} size="lg">
      {loading && (
        <div className="mov-det__loading">
          <Spinner size={18} label="Cargando detalle…" />
        </div>
      )}

      {error && (
        <div className="mov-det__error">{error}</div>
      )}

      {!loading && !error && detail && (
        <div className="mov-det">
          {/* Cabecera */}
          <div className="mov-det__header">
            <div className="mov-det__header-left">
              <div className="mov-det__label">Movimiento #{detail.id_movimiento}</div>
              <div className="mov-det__meta">
                {detail.nombre_motivo && <Badge variant="info">{detail.nombre_motivo}</Badge>}
                {detail.bodega && <span className="mov-det__bodega">{detail.bodega}</span>}
              </div>
              <div className="mov-det__sub">
                {detail.fecha && <span>{new Date(detail.fecha).toLocaleString()}</span>}
                {detail.usuario_creador && <span> · {detail.usuario_creador}</span>}
              </div>
              {detail.no_documento && (
                <div className="mov-det__sub">Documento: {detail.no_documento}</div>
              )}
              {detail.observaciones && (
                <div className="mov-det__obs">{detail.observaciones}</div>
              )}
              {String(detail.estado || '').toUpperCase() === 'ANULADO' && (
                <div className="mov-det__reversion">
                  <span className="mov-det__reversion-icon">↩</span>
                  <div className="mov-det__reversion-info">
                    <strong>Movimiento revertido</strong>
                    <span>
                      Por: {detail.anulado_por_usuario || `#${detail.anulado_por || '?'}`}
                      {detail.anulado_en && (
                        <> · {new Date(detail.anulado_en).toLocaleString()}</>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="mov-det__totals">
              <span className="mov-det__total-count">{totales.unidades} u.</span>
              <span className="mov-det__total-cost">{totales.costo.toFixed(2)}</span>
            </div>
          </div>

          {/* Líneas */}
          <div className="table-wrapper">
            <table className="table table--sm mov-det__table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Producto</th>
                  <th style={{ width: 80 }}>SKU</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Cantidad</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Costo u.</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Total</th>
                  <th style={{ width: 120 }}>Lote</th>
                  <th style={{ width: 120 }}>Caducidad</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, idx) => (
                  <tr key={l.id_detalle || idx}>
                    <td>
                      <span className="mov-det__product">{l.nombre_producto}</span>
                    </td>
                    <td>
                      {l.sku ? <code className="mov-det__sku">{l.sku}</code> : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(l.cantidad || 0)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(l.costo_unitario || 0).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mov-det__line-total">
                        {Number(l.total_linea || 0).toFixed(2)}
                      </span>
                    </td>
                    <td>{l.lote || '—'}</td>
                    <td>{l.fecha_vencimiento ? new Date(l.fecha_vencimiento).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && !detail && (
        <div className="mov-det__empty">No se encontró el movimiento.</div>
      )}
    </Modal>
  );
}

MovimientoDetailModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  title: PropTypes.string,
  service: PropTypes.object,
  idMovimiento: PropTypes.number,
};
