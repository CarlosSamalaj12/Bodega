import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { pedidosService } from '@/services/pedidos.service';
import { JustificacionProductoModal } from './JustificacionProductoModal';
import { RevertPanel } from './RevertPanel';
import { X, AlertTriangle, Check, Zap } from 'lucide-react';
import './DespachoForm.scss';

const STATUS_LABELS = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  PARCIAL: { label: 'Parcial', variant: 'info' },
  DESPACHADO: { label: 'Despachado', variant: 'success' },
  ANULADO: { label: 'Anulado', variant: 'danger' },
};

function getProductBadgeText(name) {
  if (!name) return 'PR';
  const clean = name.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  // Caso "LICOR 43": primera letra + número
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return `${parts[0][0]}${parts[1]}`.toUpperCase();
  }
  // Primeras 3 letras de la primera palabra (ej: SELLADOR -> SEL)
  const alpha = parts[0].replace(/[^a-zA-Z0-9]/g, '');
  if (alpha.length >= 3) {
    return alpha.slice(0, 3).toUpperCase();
  }
  if (parts.length >= 2) {
    const second = parts[1].replace(/[^a-zA-Z0-9]/g, '');
    return `${alpha}${second}`.slice(0, 3).toUpperCase();
  }
  return clean.slice(0, 3).toUpperCase();
}

export function DespachoForm({
  pedido,
  submitting,
  onSubmittingChange,
  onDone,
  onCancel,
  onDetailsChange,
}) {
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [filterStock, setFilterStock] = useState('TODOS'); // 'TODOS' | 'CON_STOCK' | 'FALTANTES'
  const [justificarModalLine, setJustificarModalLine] = useState(null);
  const [showHistorialModal, setShowHistorialModal] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Mapea las líneas del servidor al estado local del formulario.
  const mapLine = useCallback((l) => {
    const pend = Number(l.pendiente || 0);
    const stock = Number(l.stock_surtidor || 0);
    // Cantidad inicial a surtir: lo disponible hasta el tope de lo pendiente.
    // Si no hay stock disponible, inicia en 0 (idéntico al diseño de referencia).
    const cantInicial = Math.min(pend, Math.max(0, stock));

    return {
      id_pedido_detalle: l.id_pedido_detalle,
      id_producto: l.id_producto,
      nombre_producto: l.nombre_producto,
      sku: l.sku || '',
      solicitada: Number(l.cantidad_solicitada || 0),
      surtida_anterior: Number(l.cantidad_surtida || 0),
      pendiente: pend,
      // stock del surtidor (mi bodega)
      stock,
      // stock de la bodega del solicitante
      stock_solicitante: Number(l.stock_solicitante || 0),
      estado: l.estado_linea || 'PENDIENTE',
      cantidad: cantInicial,
      anulada: String(l.estado_linea || '').toUpperCase() === 'ANULADO',
      justificacion: l.justificacion_linea || '',
    };
  }, []);

  useEffect(() => {
    if (pedido?.lines) {
      setLines(pedido.lines.map(mapLine));
    }
  }, [pedido, mapLine]);

  // Totales y cálculos de estado
  const totales = useMemo(() => {
    let surtir = 0;
    let anuladas = 0;
    let sobreDespacho = 0;
    let totalDisponibles = 0;

    for (const l of lines) {
      const cant = Number(l.cantidad) || 0;
      const pend = Number(l.pendiente) || 0;
      const stock = Number(l.stock) || 0;

      if (!l.anulada) {
        surtir += cant;
        if (cant > pend) sobreDespacho += cant - pend;
        if (pend > 0) {
          totalDisponibles += Math.min(pend, Math.max(0, stock));
        }
      } else {
        anuladas += pend;
      }
    }

    const pendienteTotal = lines.reduce((a, l) => a + (Number(l.pendiente) || 0), 0);
    const totalLineas = lines.length;
    const totalArticulos = lines.filter((l) => Number(l.pendiente) > 0 && !l.anulada).length;
    const porcentajeListo =
      pendienteTotal > 0 ? Math.min(100, Math.round((surtir / pendienteTotal) * 100)) : 100;

    return {
      surtir,
      anuladas,
      sobreDespacho,
      pendienteTotal,
      totalDisponibles,
      totalLineas,
      totalArticulos,
      porcentajeListo,
    };
  }, [lines]);

  // ¿Hay artículos con stock insuficiente?
  const hayFaltaStock = useMemo(() => {
    return lines.some(
      (l) => !l.anulada && Number(l.pendiente) > 0 && Number(l.stock) < Number(l.pendiente)
    );
  }, [lines]);

  // Conteo de artículos listos para despacho
  const itemsListos = useMemo(() => {
    return lines.filter((l) => {
      const cant = Number(l.cantidad) || 0;
      const stock = Number(l.stock) || 0;
      const pend = Number(l.pendiente) || 0;
      if (l.anulada) return true;
      if (pend <= 0) return true;
      return cant > 0 && cant <= stock;
    }).length;
  }, [lines]);

  const canSubmit = !submitting && (totales.surtir > 0 || totales.anuladas > 0);

  const setLine = useCallback((idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }, []);

  const setCantidad = useCallback((idx, value) => {
    setLine(idx, { cantidad: value });
  }, [setLine]);

  const stepCantidad = useCallback((idx, delta) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx || l.anulada || Number(l.pendiente) <= 0) return l;
        const current = Number(l.cantidad) || 0;
        const next = Math.max(0, current + delta);
        return { ...l, cantidad: next };
      })
    );
  }, []);

  const anularLinea = useCallback((idx) => {
    setLine(idx, { cantidad: 0, anulada: true });
  }, [setLine]);

  const rehabilitarLinea = useCallback((idx) => {
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, anulada: false, cantidad: Number(l.pendiente) || 0 } : l
      )
    );
  }, []);

  const handleAutoLlenar = useCallback(() => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.anulada || Number(l.pendiente) <= 0) return l;
        const disp = Math.max(0, Number(l.stock || 0));
        const pend = Number(l.pendiente || 0);
        const cant = Math.min(pend, disp);
        return { ...l, cantidad: cant };
      })
    );
    toast.info('Cantidades asignadas según stock disponible.');
  }, []);

  const handleSaveJustificacion = useCallback((idx, justTexto) => {
    setLine(idx, { justificacion: justTexto });
    toast.success('Justificación guardada para el producto');
  }, [setLine]);

  // Refresca el detalle del pedido desde el servidor
  const refreshDetails = useCallback(async () => {
    try {
      const fresh = await pedidosService.getDetails(pedido.id_pedido);
      if (fresh?.lines) {
        setLines(fresh.lines.map(mapLine));
        onDetailsChange?.(fresh);
      }
      return fresh;
    } catch {
      return null;
    }
  }, [pedido, mapLine, onDetailsChange]);

  // Cancela las líneas anuladas en el servidor
  const cancelAnuladas = useCallback(
    async (linesAnuladas) => {
      const cancelErrors = [];
      for (const l of linesAnuladas) {
        try {
          await pedidosService.cancelLine(pedido.id_pedido, {
            id_pedido_detalle: l.id_pedido_detalle,
            justificacion: l.justificacion?.trim() || 'Anulado manualmente',
          });
        } catch (err) {
          cancelErrors.push(`${l.nombre_producto}: ${err?.response?.data?.error || err.message}`);
        }
      }
      return cancelErrors;
    },
    [pedido]
  );

  // Despacho rápido individual o grupal
  const quickDispatch = useCallback(
    async (targetLines) => {
      const linesAFulfill = targetLines
        .filter((l) => !l.anulada)
        .map((l) => {
          const typed = Number(l.cantidad);
          const hasTyped = Number.isFinite(typed) && typed > 0;
          const qty = hasTyped ? typed : Number(l.pendiente || 0);
          return { ...l, _qty: qty };
        })
        .filter((l) => l._qty > 0 && Number(l.pendiente || 0) > 0);

      if (!linesAFulfill.length) return;

      onSubmittingChange?.(true);
      setSubmitError(null);
      try {
        const payloadLines = linesAFulfill.map((l) => ({
          id_pedido_detalle: l.id_pedido_detalle,
          qty: l._qty,
          justificacion: l.justificacion || null,
        }));
        const summaryJust = linesAFulfill
          .filter((l) => l.justificacion)
          .map((l) => `${l.nombre_producto}: ${l.justificacion}`)
          .join(' | ');

        const res = await pedidosService.fulfill(pedido.id_pedido, {
          justificacion: summaryJust || null,
          lines: payloadLines,
        });

        const skipped = Array.isArray(res?.skipped) ? res.skipped : [];
        const cancelErrors = await cancelAnuladas(lines.filter((l) => l.anulada));
        const fresh = await refreshDetails();

        if (skipped.length > 0) {
          toast.warn(`Despacho registrado, pero algunas líneas no tenían stock suficiente.`);
        } else if (cancelErrors.length > 0) {
          toast.warn(`Despacho registrado, pero falló la anulación de algunas líneas.`);
        } else {
          toast.success('Despacho registrado');
        }

        const siguePendiente = (fresh?.lines || []).some(
          (l) => Number(l.pendiente || 0) > 0 && String(l.estado_linea || '').toUpperCase() !== 'ANULADO'
        );
        if (!siguePendiente) onDone?.();
      } catch (e) {
        setSubmitError(e?.response?.data?.error || 'No se pudo despachar');
      } finally {
        onSubmittingChange?.(false);
      }
    },
    [pedido, lines, refreshDetails, cancelAnuladas, onDone, onSubmittingChange]
  );

  const dispatchLine = useCallback(
    (l) => {
      if (l.anulada) return;
      const cant = Number(l.cantidad);
      const pend = Number(l.pendiente || 0);
      const stock = Number(l.stock || 0);

      if (pend <= 0) return;
      if (!Number.isFinite(cant) || cant <= 0) return;
      if (cant > stock) {
        toast.error(`Stock insuficiente (${stock} disp.)`);
        return;
      }
      // Si la línea tiene discrepancia y no está justificada, exigir justificación
      if (cant < pend && !l.justificacion?.trim()) {
        toast.warn(`Debes ingresar una justificación para ${l.nombre_producto}`);
        setJustificarModalLine(l);
        return;
      }

      quickDispatch([l]);
    },
    [quickDispatch]
  );

  // Submit principal del formulario
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const linesAFulfill = lines.filter((l) => Number(l.cantidad) > 0 && !l.anulada);
    const linesAnuladas = lines.filter((l) => l.anulada);

    if (linesAFulfill.length === 0 && linesAnuladas.length === 0) {
      setSubmitError('Surtí al menos una línea o anula alguna para procesar el pedido.');
      return;
    }

    // Bloquear si supera stock
    const sinStock = linesAFulfill.filter((l) => Number(l.cantidad) > Number(l.stock || 0));
    if (sinStock.length > 0) {
      setSubmitError(
        `Stock insuficiente para: ${sinStock.map((l) => l.nombre_producto).join(', ')}. Ajusta las cantidades.`
      );
      return;
    }

    // Validar justificación individual en cada línea con discrepancia
    const linesConDiscrepancia = lines.filter((l) => {
      const cant = Number(l.cantidad) || 0;
      const pend = Number(l.pendiente) || 0;
      if (l.anulada) return true;
      if (pend > 0 && cant !== pend) return true;
      return false;
    });

    const sinJustificar = linesConDiscrepancia.filter((l) => !String(l.justificacion || '').trim());
    if (sinJustificar.length > 0) {
      const primera = sinJustificar[0];
      setSubmitError(
        `El producto "${primera.nombre_producto}" requiere justificación. Pulsa el ícono de nota para registrarla.`
      );
      setJustificarModalLine(primera);
      return;
    }

    onSubmittingChange?.(true);
    try {
      let skipped = [];
      if (linesAFulfill.length > 0) {
        const payloadLines = linesAFulfill.map((l) => ({
          id_pedido_detalle: l.id_pedido_detalle,
          qty: Number(l.cantidad),
          justificacion: l.justificacion || null,
        }));
        const summaryJust = lines
          .filter((l) => l.justificacion)
          .map((l) => `${l.nombre_producto}: ${l.justificacion}`)
          .join(' | ');

        const res = await pedidosService.fulfill(pedido.id_pedido, {
          justificacion: summaryJust || null,
          lines: payloadLines,
        });
        skipped = Array.isArray(res?.skipped) ? res.skipped : [];
      }

      const cancelErrors = await cancelAnuladas(linesAnuladas);

      if (skipped.length > 0) {
        toast.warn(`Despacho registrado, pero algunas líneas no tenían stock suficiente.`);
      } else if (cancelErrors.length > 0) {
        toast.warn(`Despacho registrado, pero falló la anulación de algunas líneas.`);
      } else {
        toast.success('Despacho registrado exitosamente');
      }

      onDone?.();
    } catch (e) {
      setSubmitError(e?.response?.data?.error || 'No se pudo despachar');
    } finally {
      onSubmittingChange?.(false);
    }
  };

  if (!pedido) {
    return <div className="despacho-form__empty">Sin datos del pedido.</div>;
  }

  // Filtrado de líneas para la vista
  const visibleLines = lines.filter((l) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = l.nombre_producto?.toLowerCase().includes(q);
      const matchSku = l.sku?.toLowerCase().includes(q);
      if (!matchName && !matchSku) return false;
    }

    if (filterStock === 'CON_STOCK') {
      return Number(l.stock || 0) > 0;
    }
    if (filterStock === 'FALTANTES') {
      return Number(l.stock || 0) < Number(l.pendiente || 0);
    }
    return true;
  });

  return (
    <div className="despacho-form-v2">
      {/* ── CABECERA DEL MODAL (Fiel a la referencia) ── */}
      <div className="despacho-form-v2__top-header">
        <div className="despacho-form-v2__top-left">
          <div className="despacho-form-v2__cube-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div className="despacho-form-v2__top-titles">
            <div className="despacho-form-v2__title-row">
              <h2 className="despacho-form-v2__title">Despachar Pedido #{pedido.id_pedido}</h2>
              <span
                className={`despacho-form-v2__stock-badge ${
                  hayFaltaStock
                    ? 'despacho-form-v2__stock-badge--warn'
                    : 'despacho-form-v2__stock-badge--ok'
                }`}
              >
                • {hayFaltaStock ? 'Falta de Stock' : 'Con Stock'}
              </span>
            </div>
            <p className="despacho-form-v2__subtitle">
              Valida el inventario y confirma las unidades a despachar de forma inmediata.
            </p>
          </div>
        </div>

        <div className="despacho-form-v2__top-actions">
          <button
            type="button"
            className="despacho-form-v2__history-btn"
            onClick={() => setShowHistorialModal(true)}
            title="Ver historial de despachos y reversas"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Historial</span>
          </button>
          <button
            type="button"
            className="despacho-form-v2__close-btn"
            onClick={onCancel}
            aria-label="Cerrar modal"
            disabled={submitting}
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {submitError && <div className="despacho-form-v2__error-banner">{submitError}</div>}

      {/* ── 4 TARJETAS DE RESUMEN SUPERIOR ── */}
      <div className="despacho-form-v2__cards-grid">
        {/* Card 1: Solicitante */}
        <div className="despacho-card">
          <div className="despacho-card__icon-wrap despacho-card__icon-wrap--user">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="despacho-card__content">
            <span className="despacho-card__label">SOLICITANTE</span>
            <div className="despacho-card__value" title={pedido.requester_name || '—'}>
              {pedido.requester_name || '—'}
            </div>
          </div>
        </div>

        {/* Card 2: Bodega de despacho */}
        <div className="despacho-card">
          <div className="despacho-card__icon-wrap despacho-card__icon-wrap--warehouse">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-3" />
            </svg>
          </div>
          <div className="despacho-card__content">
            <span className="despacho-card__label">BODEGA DE DESPACHO</span>
            <div className="despacho-card__value" title={pedido.from_warehouse || '—'}>
              {pedido.from_warehouse || '—'}
            </div>
          </div>
        </div>

        {/* Card 3: Total pendiente */}
        <div className="despacho-card">
          <div className="despacho-card__content despacho-card__content--full">
            <span className="despacho-card__label">TOTAL PENDIENTE</span>
            <div className="despacho-card__row">
              <span className="despacho-card__big-num">
                {totales.pendienteTotal} <span>artículos</span>
              </span>
              <span className="despacho-card__pill">
                {totales.totalLineas} Líneas
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: A surtir ahora */}
        <div className="despacho-card">
          <div className="despacho-card__content despacho-card__content--full">
            <span className="despacho-card__label despacho-card__label--accent">A SURTIR AHORA</span>
            <div className="despacho-card__row">
              <span className="despacho-card__big-num despacho-card__big-num--accent">
                {totales.surtir} <span>de {totales.pendienteTotal} u.</span>
              </span>
              <span className="despacho-card__pill despacho-card__pill--accent">
                {totales.porcentajeListo}% Listo
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BARRA DE HERRAMIENTAS Y FILTROS ── */}
      <div className="despacho-toolbar">
        <div className="despacho-toolbar__left">
          <div className="despacho-toolbar__search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por producto, código o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="despacho-toolbar__search-input"
            />
            {search && (
              <button
                type="button"
                className="despacho-toolbar__clear-search"
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>

          <div className="despacho-toolbar__tabs">
            <button
              type="button"
              className={`despacho-toolbar__tab ${filterStock === 'TODOS' ? 'despacho-toolbar__tab--active' : ''}`}
              onClick={() => setFilterStock('TODOS')}
            >
              Todos
            </button>
            <button
              type="button"
              className={`despacho-toolbar__tab ${filterStock === 'CON_STOCK' ? 'despacho-toolbar__tab--active' : ''}`}
              onClick={() => setFilterStock('CON_STOCK')}
            >
              Con Stock
            </button>
            <button
              type="button"
              className={`despacho-toolbar__tab despacho-toolbar__tab--faltantes ${filterStock === 'FALTANTES' ? 'despacho-toolbar__tab--active' : ''}`}
              onClick={() => setFilterStock('FALTANTES')}
            >
              Faltantes
            </button>
          </div>
        </div>

        <button
          type="button"
          className="despacho-toolbar__auto-btn"
          onClick={handleAutoLlenar}
          title="Asignar automáticamente el stock disponible a cada línea pendiente"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Auto-llenar disponibles
        </button>
      </div>

      {/* ── TABLA DE PRODUCTOS (Nuevo diseño minimalista) ── */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="despacho-table-wrapper">
          <table className="despacho-table">
            <thead>
              <tr>
                <th className="despacho-table__th--product">PRODUCTO / IDENTIFICACIÓN</th>
                <th className="despacho-table__th--sol">SOLICITADA</th>
                <th className="despacho-table__th--sur">YA<br />SURTIDA</th>
                <th className="despacho-table__th--stock-solic">STOCK<br />SOLICITANTE</th>
                <th className="despacho-table__th--stock-bodega">STOCK<br />BODEGA</th>
                <th className="despacho-table__th--stepper">A SURTIR<br />AHORA</th>
                <th className="despacho-table__th--status">ESTADO</th>
                <th className="despacho-table__th--actions">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="despacho-table__empty-row">
                    No hay productos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                visibleLines.map((l) => {
                  const originalIdx = lines.findIndex((x) => x.id_pedido_detalle === l.id_pedido_detalle);
                  const cant = Number(l.cantidad) || 0;
                  const pend = Number(l.pendiente) || 0;
                  const stock = Number(l.stock) || 0;
                  const overStock = cant > stock;
                  const sobreDespacho = cant > pend;
                  const tieneDiscrepancia = l.anulada || (pend > 0 && cant !== pend);
                  const tieneJustificacion = Boolean(l.justificacion?.trim());
                  const faltaJustificar = tieneDiscrepancia && !tieneJustificacion;
                  const quickDisabled =
                    submitting || l.anulada || pend <= 0 || cant <= 0 || overStock || faltaJustificar;

                  return (
                    <tr
                      key={l.id_pedido_detalle}
                      className={`despacho-table__row ${l.anulada ? 'despacho-table__row--anulada' : ''}`}
                    >
                      {/* 1. Producto */}
                      <td className="despacho-table__td--product">
                        <div className="despacho-table__prod-cell">
                          <div className="despacho-table__prod-avatar" aria-hidden="true">
                            {getProductBadgeText(l.nombre_producto)}
                          </div>
                          <div className="despacho-table__prod-info">
                            <span className="despacho-table__prod-name" title={l.nombre_producto}>
                              {l.nombre_producto}
                            </span>
                            <span className="despacho-table__prod-sku">
                              SKU: {l.sku || 'S/N'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Solicitada */}
                      <td className="despacho-table__td--num">
                        <strong>{l.solicitada}</strong>
                      </td>

                      {/* 3. Ya surtida */}
                      <td className="despacho-table__td--num">
                        <span className="despacho-table__muted-num">{l.surtida_anterior}</span>
                      </td>

                      {/* 4. Stock solicitante */}
                      <td className="despacho-table__td--num">
                        <span className="despacho-table__solic-pill">{l.stock_solicitante} u.</span>
                      </td>

                      {/* 5. Stock bodega surtidora */}
                      <td className="despacho-table__td--stock">
                        <span
                          className={`despacho-table__stock-pill ${
                            stock <= 0
                              ? 'despacho-table__stock-pill--zero'
                              : stock < pend
                              ? 'despacho-table__stock-pill--low'
                              : 'despacho-table__stock-pill--ok'
                          }`}
                        >
                          {stock} disp.
                        </span>
                      </td>

                      {/* 6. A surtir ahora (Stepper) */}
                      <td className="despacho-table__td--stepper">
                        {l.anulada ? (
                          <span className="despacho-table__void-tag">Línea Anulada</span>
                        ) : pend <= 0 ? (
                          <span className="despacho-table__done-tag">Surtido completo</span>
                        ) : (
                          <div className="despacho-table__stepper-wrap">
                            <div className="despacho-table__stepper">
                              <button
                                type="button"
                                className="despacho-table__step-btn"
                                onClick={() => stepCantidad(originalIdx, -1)}
                                disabled={cant <= 0 || submitting}
                                aria-label="Disminuir cantidad"
                              >
                                -
                              </button>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={`despacho-table__step-input ${overStock ? 'despacho-table__step-input--warn' : ''} ${sobreDespacho ? 'despacho-table__step-input--info' : ''}`}
                                value={l.cantidad}
                                onChange={(e) => {
                                  let val = e.target.value.replace(',', '.');
                                  if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                    setCantidad(originalIdx, val);
                                  }
                                }}
                                disabled={submitting}
                              />
                              <button
                                type="button"
                                className="despacho-table__step-btn"
                                onClick={() => stepCantidad(originalIdx, 1)}
                                disabled={submitting}
                                aria-label="Aumentar cantidad"
                              >
                                +
                              </button>
                            </div>

                            {(overStock || stock < pend) && (
                              <div className="despacho-table__msg-warn">
                                ● Sin stock suficiente (Disp: {stock})
                              </div>
                            )}
                            {!overStock && stock >= pend && sobreDespacho && (
                              <div className="despacho-table__msg-info">
                                +{(cant - pend).toFixed(2)} sobre lo solicitado
                              </div>
                            )}
                            {faltaJustificar && !overStock && stock >= pend && (
                              <div className="despacho-table__msg-just-alert" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <AlertTriangle size={11} strokeWidth={2} />
                                <span>Requiere justificación</span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 7. Estado */}
                      <td className="despacho-table__td--status">
                        {l.anulada ? (
                          <span className="despacho-table__status-pill despacho-table__status-pill--void">
                            • Anulado
                          </span>
                        ) : (
                          <span
                            className={`despacho-table__status-pill despacho-table__status-pill--${String(
                              l.estado || 'pendiente'
                            ).toLowerCase()}`}
                          >
                            • {STATUS_LABELS[l.estado]?.label || l.estado}
                          </span>
                        )}
                      </td>

                      {/* 8. Acciones minimalistas */}
                      <td className="despacho-table__td--actions">
                        <div className="despacho-table__actions">
                          {/* 8.1. Despacho rápido de la línea */}
                          {!l.anulada && pend > 0 && (
                            <button
                              type="button"
                              className="despacho-table__icon-btn despacho-table__icon-btn--quick"
                              onClick={() => dispatchLine(l)}
                              disabled={quickDisabled}
                              title={
                                overStock
                                  ? `Sin stock disponible (${stock} disp.)`
                                  : faltaJustificar
                                  ? 'Registra la justificación primero'
                                  : `Despachar inmediatamente ${cant} u.`
                              }
                              aria-label="Despacho rápido"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                              </svg>
                            </button>
                          )}

                          {/* 8.2. Justificación individual por producto */}
                          <button
                            type="button"
                            className={`despacho-table__icon-btn despacho-table__icon-btn--just ${
                              faltaJustificar
                                ? 'despacho-table__icon-btn--needs-just'
                                : tieneJustificacion
                                ? 'despacho-table__icon-btn--has-just'
                                : ''
                            }`}
                            onClick={() => setJustificarModalLine(l)}
                            title={
                              tieneJustificacion
                                ? `Justificación registrada: "${l.justificacion}"`
                                : faltaJustificar
                                ? '¡Justificación requerida!'
                                : 'Agregar justificación/nota a este producto'
                            }
                            aria-label="Justificación de producto"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                              <polyline points="10 9 9 9 8 9" />
                            </svg>
                            {faltaJustificar && <span className="despacho-table__alert-dot" />}
                            {tieneJustificacion && !faltaJustificar && (
                              <span className="despacho-table__ok-dot">
                                <Check size={8} strokeWidth={2.5} />
                              </span>
                            )}
                          </button>

                          {/* 8.3. Anular / Rehabilitar línea */}
                          {!l.anulada && pend > 0 ? (
                            <button
                              type="button"
                              className="despacho-table__icon-btn despacho-table__icon-btn--void"
                              onClick={() => anularLinea(originalIdx)}
                              title="Anular esta línea"
                              aria-label="Anular línea"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          ) : l.anulada ? (
                            <button
                              type="button"
                              className="despacho-table__icon-btn despacho-table__icon-btn--undo"
                              onClick={() => rehabilitarLinea(originalIdx)}
                              title="Rehabilitar línea anulada"
                              aria-label="Rehabilitar línea"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── BANNER DE ADVERTENCIA DE STOCK INSUFICIENTE ── */}
        {hayFaltaStock && (
          <div className="despacho-banner-insuficiente">
            <div className="despacho-banner-insuficiente__text">
              <span className="despacho-banner-insuficiente__icon" aria-hidden="true">ⓘ</span>
              <span>
                Algunos artículos presentan <strong>stock insuficiente</strong> en {pedido.from_warehouse || 'tu bodega'}. Puedes generar una orden de traspaso o despacho parcial.
              </span>
            </div>
            <a
              href="/transferencias"
              target="_blank"
              rel="noreferrer"
              className="despacho-banner-insuficiente__link"
            >
              Generar traspaso ›
            </a>
          </div>
        )}

        {/* ── PIE DE PÁGINA (Footer con progreso y confirmación) ── */}
        <div className="despacho-form-v2__footer">
          <div className="despacho-form-v2__footer-progress">
            <div className="despacho-form-v2__progress-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <span className="despacho-form-v2__progress-text">
                {itemsListos} de {totales.totalLineas} artículos listos para despacho
              </span>
              <div className="despacho-form-v2__progress-bar">
                <div
                  className="despacho-form-v2__progress-fill"
                  style={{
                    width: `${totales.totalLineas > 0 ? (itemsListos / totales.totalLineas) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="despacho-form-v2__footer-buttons">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleAutoLlenar}
              disabled={submitting || totales.totalDisponibles <= 0}
              title={
                totales.totalDisponibles > 0
                  ? 'Ajustar cantidades automáticamente a todo el stock disponible'
                  : 'Sin stock disponible en ninguna línea'
              }
              className="despacho-form-v2__btn-disponibles"
            >
              <Zap size={14} strokeWidth={1.8} />
              <span>Despachar disponibles ({totales.totalDisponibles})</span>
            </Button>

            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit}
            >
              {submitting ? (
                <Spinner size={14} />
              ) : (
                <>
                  <Check size={14} strokeWidth={1.8} />
                  <span>Confirmar despacho ({totales.surtir} u.)</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* ── MODAL DE JUSTIFICACIÓN POR PRODUCTO ── */}
      {justificarModalLine && (
        <JustificacionProductoModal
          open={Boolean(justificarModalLine)}
          onClose={() => setJustificarModalLine(null)}
          line={justificarModalLine}
          onSave={(justTexto) => {
            const idx = lines.findIndex(
              (x) => x.id_pedido_detalle === justificarModalLine.id_pedido_detalle
            );
            if (idx !== -1) {
              handleSaveJustificacion(idx, justTexto);
            }
          }}
        />
      )}

      {/* ── MODAL DE HISTORIAL Y REVERSIONES ── */}
      <Modal
        open={showHistorialModal}
        onClose={() => setShowHistorialModal(false)}
        title={`Historial de despachos - Pedido #${pedido.id_pedido}`}
        size="lg"
      >
        <div style={{ padding: '8px 0' }}>
          <RevertPanel
            pedido={pedido}
            onDone={() => {
              setShowHistorialModal(false);
              onDone?.();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

DespachoForm.propTypes = {
  pedido: PropTypes.object,
  submitting: PropTypes.bool,
  onSubmittingChange: PropTypes.func,
  onDone: PropTypes.func,
  onCancel: PropTypes.func,
  onDetailsChange: PropTypes.func,
};
