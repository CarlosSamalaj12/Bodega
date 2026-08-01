import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuthStore } from '@/stores/auth.store';
import { ColumnSelectorModal } from '@/components/ui/ColumnSelectorModal';
import { downloadCSV, downloadXLSX, downloadPDF } from '@/utils/export';
import { formatDate } from '@/utils/format';
import api from '@/services/api';
import './CuadreCajaPage.scss';

// ─── Constants ──────────────────────────────────────────────────────
const DENOMINACIONES = [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200];
const DOLAR_TIPO_CAMBIO = 7.3;

const VENTAS_SUGERIDAS = [
  'Flor Café',
  'Restaurante',
  'Nilas',
  'El Deck',
  'Cactus',
  'Gelato',
  'Jazmín',
];

const PAGO_LABELS = {
  visa: 'Visa',
  bancos: 'Bancos',
  cxc_trabajadores: 'CxC Trabajadores',
  cxc_habitaciones: 'CxC Habitaciones',
  pase_consumible: 'Pase Consumible',
};

function buildDefaultPayload(responsable = '') {
  const monedas = {};
  DENOMINACIONES.forEach((d) => { monedas[String(d)] = 0; });

  return {
    sede: '',
    responsable,
    monedas,
    pagos: {
      dolares_cantidad: 0,
      visa: 0,
      bancos: 0,
      cxc_trabajadores: 0,
      cxc_habitaciones: 0,
      pase_consumible: 0,
    },
    ventas_rows: VENTAS_SUGERIDAS.map((a) => ({ ambiente: a, monto: 0 })),
    extras: { pedidos_nilas: 0, cortesias: 0 },
    detalle: [],
  };
}

function fmtMoney(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function parseNum(v) {
  const raw = String(v || '').replace(/,/g, '').trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// ─── Component ─────────────────────────────────────────────────────
export default function CuadreCajaPage() {
  const navigate = useNavigate();
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const user = useAuthStore((s) => s.user);
  const userFullName = user?.full_name || user?.username || '';

  // --- Vista: 'list' | 'form' ---
  const [view, setView] = useState('list');

  // --- Filtros (list view) ---
  const hoy = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(hoy);
  const [warehouseId, setWarehouseId] = useState(null);
  const [responsable, setResponsable] = useState('');
  const [committedResponsable, setCommittedResponsable] = useState('');

  const handleSearchResponsable = () => {
    setCommittedResponsable(responsable);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearchResponsable();
  };

  // --- Catálogos ---
  const [bodegas, setBodegas] = useState([]);
  const [contextLoading, setContextLoading] = useState(true);

  // --- Lista de cuadres ---
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- Export ---
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // --- Detail modal ---
  const [detailRow, setDetailRow] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // --- Form state ---
  const [formFecha, setFormFecha] = useState(hoy);
  const [formBodega, setFormBodega] = useState(null);
  const [payload, setPayload] = useState(() => buildDefaultPayload(userFullName));
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState(null); // null = nuevo
  const [formLoading, setFormLoading] = useState(false);

  // Cargar contexto (bodegas)
  useEffect(() => {
    api.get('/api/cuadre-caja/context')
      .then(({ data }) => {
        if (data?.bodegas) setBodegas(data.bodegas);
        const defWh = data?.id_bodega_default;
        if (defWh) {
          setWarehouseId(Number(defWh));
          setFormBodega(Number(defWh));
        }
      })
      .catch(() => toast.error('Error al cargar contexto'))
      .finally(() => setContextLoading(false));
  }, []);

  // Cargar reporte (list view)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 300 };
      if (fecha) params.fecha = fecha;
      if (warehouseId) params.warehouse = warehouseId;
      if (committedResponsable) params.responsable = committedResponsable;
      const { data } = await api.get('/api/reportes/cuadre-caja', { params });
      setRows(data?.rows || []);
    } catch {
      toast.error('Error al cargar cuadre de caja');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fecha, warehouseId, committedResponsable]);

  useEffect(() => { if (!contextLoading && view === 'list') fetchData(); }, [fetchData, contextLoading, view]);

  // Cargar cuadre existente en el formulario
  const loadCuadreToForm = useCallback(async (f, wh) => {
    setFormLoading(true);
    try {
      const { data } = await api.get('/api/cuadre-caja', {
        params: { fecha: f, warehouse: wh },
      });
      setExistingId(data?.id_cuadre || null);
      setFormFecha(f);
      setFormBodega(wh);
      if (data?.payload) {
        const p = buildDefaultPayload(userFullName);
        // Merge seguro
        if (data.payload.sede) p.sede = data.payload.sede;
        if (data.payload.responsable) p.responsable = data.payload.responsable;
        if (data.payload.monedas) {
          DENOMINACIONES.forEach((d) => {
            const k = String(d);
            if (data.payload.monedas[k] != null) p.monedas[k] = parseNum(data.payload.monedas[k]);
          });
        }
        if (data.payload.pagos) {
          Object.keys(p.pagos).forEach((k) => {
            if (data.payload.pagos[k] != null) p.pagos[k] = parseNum(data.payload.pagos[k]);
          });
        }
        if (Array.isArray(data.payload.ventas_rows)) {
          p.ventas_rows = data.payload.ventas_rows.map((r) => ({
            ambiente: r.ambiente || '',
            monto: parseNum(r.monto),
          }));
        }
        if (data.payload.extras) {
          Object.keys(p.extras).forEach((k) => {
            if (data.payload.extras[k] != null) p.extras[k] = parseNum(data.payload.extras[k]);
          });
        }
        if (Array.isArray(data.payload.detalle)) {
          p.detalle = data.payload.detalle.map((r) => ({
            descripcion: r.descripcion || '',
            nombre: r.nombre || '',
            monto: parseNum(r.monto),
            check_no: r.check_no || '',
          }));
        }
        setPayload(p);
      } else {
        setPayload(buildDefaultPayload(userFullName));
      }
    } catch {
      // No existe → nuevo cuadre
      setExistingId(null);
      setFormFecha(f);
      setFormBodega(wh || formBodega);
      setPayload(buildDefaultPayload(userFullName));
    } finally {
      setFormLoading(false);
    }
  }, [userFullName, formBodega]);

  // Abrir formulario para nuevo cuadre
  const openNewForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    setFormFecha(today);
    setFormBodega(warehouseId);
    setExistingId(null);
    setPayload(buildDefaultPayload(userFullName));
    setView('form');
  };

  // Abrir formulario para editar cuadre existente
  const openEditForm = (row) => {
    loadCuadreToForm(row.fecha, row.id_bodega);
    setView('form');
  };

  // ─── Payload helpers ─────────────────────────────────────────────
  const updateMoneda = (denom, val) => {
    setPayload((prev) => ({
      ...prev,
      monedas: { ...prev.monedas, [String(denom)]: parseNum(val) },
    }));
  };

  const updatePago = (key, val) => {
    setPayload((prev) => ({
      ...prev,
      pagos: { ...prev.pagos, [key]: parseNum(val) },
    }));
  };

  const updateVentaRow = (idx, field, val) => {
    setPayload((prev) => {
      const rows = [...prev.ventas_rows];
      rows[idx] = { ...rows[idx], [field]: field === 'monto' ? parseNum(val) : val };
      return { ...prev, ventas_rows: rows };
    });
  };

  const addVentaRow = () => {
    setPayload((prev) => ({
      ...prev,
      ventas_rows: [...prev.ventas_rows, { ambiente: '', monto: 0 }],
    }));
  };

  const removeVentaRow = (idx) => {
    setPayload((prev) => ({
      ...prev,
      ventas_rows: prev.ventas_rows.filter((_, i) => i !== idx),
    }));
  };

  const updateExtra = (key, val) => {
    setPayload((prev) => ({
      ...prev,
      extras: { ...prev.extras, [key]: parseNum(val) },
    }));
  };

  const updateSede = (val) => {
    setPayload((prev) => ({ ...prev, sede: val }));
  };

  const updateResponsable = (val) => {
    setPayload((prev) => ({ ...prev, responsable: val }));
  };

  // ─── Detail rows ─────────────────────────────────────────────────
  const updateDetalleRow = (idx, field, val) => {
    setPayload((prev) => {
      const rows = [...prev.detalle];
      rows[idx] = { ...rows[idx], [field]: field === 'monto' ? parseNum(val) : val };
      return { ...prev, detalle: rows };
    });
  };

  const addDetalleRow = () => {
    setPayload((prev) => ({
      ...prev,
      detalle: [...prev.detalle, { descripcion: '', nombre: '', monto: 0, check_no: '' }],
    }));
  };

  const removeDetalleRow = (idx) => {
    setPayload((prev) => ({
      ...prev,
      detalle: prev.detalle.filter((_, i) => i !== idx),
    }));
  };

  // ─── Totales computados ──────────────────────────────────────────
  const totales = useMemo(() => {
    const { monedas, pagos, ventas_rows, extras, detalle } = payload;

    const totalEfectivo = DENOMINACIONES.reduce((acc, d) => {
      return acc + parseNum(monedas[String(d)]) * d;
    }, 0);

    const dolaresCant = parseNum(pagos.dolares_cantidad);
    const totalDolaresQ = dolaresCant * DOLAR_TIPO_CAMBIO;

    const totalCobro =
      parseNum(pagos.visa) +
      parseNum(pagos.bancos) +
      parseNum(pagos.cxc_trabajadores) +
      parseNum(pagos.cxc_habitaciones) +
      parseNum(pagos.pase_consumible) +
      totalDolaresQ;

    const totalVentaAmbiente = ventas_rows.reduce((acc, r) => acc + parseNum(r.monto), 0);

    const totalExtras =
      parseNum(extras.pedidos_nilas) +
      parseNum(extras.cortesias);

    const totalDetalle = detalle.reduce((acc, r) => acc + parseNum(r.monto), 0);

    const granTotal = totalEfectivo + totalCobro + totalVentaAmbiente + totalExtras + totalDetalle;

    return {
      totalEfectivo: Math.round(totalEfectivo * 100) / 100,
      dolaresCant,
      totalDolaresQ: Math.round(totalDolaresQ * 100) / 100,
      totalCobro: Math.round(totalCobro * 100) / 100,
      totalVentaAmbiente: Math.round(totalVentaAmbiente * 100) / 100,
      totalExtras: Math.round(totalExtras * 100) / 100,
      totalDetalle: Math.round(totalDetalle * 100) / 100,
      granTotal: Math.round(granTotal * 100) / 100,
    };
  }, [payload]);

  // ─── Save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!formFecha) { toast.error('Selecciona una fecha'); return; }
    if (!formBodega) { toast.error('Selecciona una bodega'); return; }

    setSaving(true);
    try {
      const body = {
        fecha: formFecha,
        id_bodega: formBodega,
        payload: {
          sede: payload.sede,
          responsable: payload.responsable,
          monedas: payload.monedas,
          pagos: payload.pagos,
          ventas_rows: payload.ventas_rows.filter((r) => r.ambiente || parseNum(r.monto) > 0),
          extras: payload.extras,
          detalle: payload.detalle.filter((r) => r.descripcion || r.nombre || parseNum(r.monto) > 0),
        },
      };

      const { data } = await api.post('/api/cuadre-caja', body);
      toast.success('Cuadre guardado correctamente');
      // Actualizar payload con datos normalizados del server
      if (data?.payload) {
        const p = { ...payload };
        if (data.payload.monedas) {
          DENOMINACIONES.forEach((d) => {
            const k = String(d);
            if (data.payload.monedas[k] != null) p.monedas[k] = parseNum(data.payload.monedas[k]);
          });
        }
        if (data.payload.pagos) {
          Object.keys(p.pagos).forEach((k) => {
            if (data.payload.pagos[k] != null) p.pagos[k] = parseNum(data.payload.pagos[k]);
          });
        }
        setPayload(p);
      }
      setExistingId(data?.id_cuadre || existingId);
      // Refrescar lista
      await fetchData();
    } catch (e) {
      const msg = e?.response?.data?.error || 'Error al guardar el cuadre';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ─── Print / PDF (usando form POST para evitar límite de URL) ────
  const submitPrintForm = (format) => {
    const form = document.createElement('form');
    form.method = 'POST';
    // La sesión viaja en la cookie HttpOnly (mismo origin) — no hace falta
    // exponer el token en la URL.
    form.action = '/api/print/cuadre-caja';
    form.target = '_blank';
    const fields = {
      fecha: formFecha,
      format,
    };
    if (formBodega) fields.warehouse = String(formBodega);
    fields.payload_override = JSON.stringify(payload);
    Object.entries(fields).forEach(([k, v]) => {
      const inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = k;
      inp.value = v;
      form.appendChild(inp);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  const handlePrint = (format) => { submitPrintForm(format); };
  const handlePdf = () => { submitPrintForm('pdf'); };

  // ─── Print / PDF desde el modal de detalle ──────────────────────
  const submitDetailPrintForm = (format) => {
    const form = document.createElement('form');
    form.method = 'POST';
    // La sesión viaja en la cookie HttpOnly (mismo origin) — no hace falta
    // exponer el token en la URL.
    form.action = '/api/print/cuadre-caja';
    form.target = '_blank';
    const fields = {
      fecha: detailRow.fecha,
      format,
    };
    if (detailRow.id_bodega) fields.warehouse = String(detailRow.id_bodega);
    // Mandar el payload completo para que el print use datos actualizados
    if (detailData?.payload) {
      fields.payload_override = JSON.stringify(detailData.payload);
    }
    Object.entries(fields).forEach(([k, v]) => {
      const inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = k;
      inp.value = v;
      form.appendChild(inp);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  // ─── Detail modal ────────────────────────────────────────────────
  const openDetail = async (row) => {
    setDetailRow(row);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get('/api/cuadre-caja', {
        params: { fecha: row.fecha, warehouse: row.id_bodega },
      });
      setDetailData(data);
    } catch {
      toast.error('Error al cargar detalle del cuadre');
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // ─── Export ───────────────────────────────────────────────────────
  const allExportColumns = [
    { key: 'fecha', label: 'Fecha' },
    { key: 'nombre_bodega', label: 'Bodega' },
    { key: 'sede', label: 'Sede' },
    { key: 'responsable', label: 'Responsable' },
    { key: 'total_efectivo', label: 'Efectivo' },
    { key: 'total_cobro', label: 'Cobro' },
    { key: 'total_venta_ambiente', label: 'Venta Ambiente' },
    { key: 'gran_total_reporte', label: 'Gran Total' },
    { key: 'actualizado_en', label: 'Actualizado' },
  ];

  const handleExportWithColumns = (cols, format) => {
    const fn = { csv: downloadCSV, xlsx: downloadXLSX, pdf: downloadPDF }[format] || downloadCSV;
    fn(rows, {
      filename: `cuadre_caja_${fecha || 'todas'}`,
      columns: cols,
      format: (row, col) => {
        if (col.key === 'fecha') return String(row.fecha || '').slice(0, 10);
        if (col.key === 'actualizado_en') return String(row.actualizado_en || '').slice(0, 19).replace('T', ' ');
        if (['total_efectivo', 'total_cobro', 'total_venta_ambiente', 'gran_total_reporte'].includes(col.key)) {
          return `Q ${Number(row[col.key] || 0).toFixed(2)}`;
        }
        return row[col.key];
      },
    });
    setShowColumnSelector(false);
  };

  const hasActiveFilters = fecha || warehouseId || committedResponsable;
  const handleClearFilters = () => { setFecha(''); setWarehouseId(null); setResponsable(''); setCommittedResponsable(''); };
  const fmtMoneda = (val) => `Q ${fmtMoney(val)}`;

  // Totales de la lista (DEBE ir antes de cualquier early return)
  const listTotals = useMemo(() => {
    let efectivo = 0, cobro = 0, venta = 0, granTotal = 0;
    for (const r of rows) {
      efectivo += Number(r.total_efectivo || 0);
      cobro += Number(r.total_cobro || 0);
      venta += Number(r.total_venta_ambiente || 0);
      granTotal += Number(r.gran_total_reporte || 0);
    }
    return {
      efectivo: Math.round(efectivo * 100) / 100,
      cobro: Math.round(cobro * 100) / 100,
      venta: Math.round(venta * 100) / 100,
      granTotal: Math.round(granTotal * 100) / 100,
    };
  }, [rows]);

  // ─── Render: Form View ───────────────────────────────────────────
  if (view === 'form') {
    return (
      <>
        <Header
          title={existingId ? 'Editar Cuadre de Caja' : 'Nuevo Cuadre de Caja'}
          subtitle={`${formFecha} · ${bodegas.find((b) => b.id_bodega === formBodega)?.nombre_bodega || 'Selecciona bodega'}`}
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={() => setView('list')}>
                ← Volver
              </Button>
              <Button size="sm" variant="ghost" onClick={handlePdf} disabled={saving}>
                📄 PDF
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handlePrint('pos')} disabled={saving}>
                🧾 POS 80mm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handlePrint('carta')} disabled={saving}>
                📋 Carta
              </Button>
              <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : '💾 Guardar'}
              </Button>
            </div>
          }
        />

        <div className="cuadre-caja__form">
          {formLoading ? (
            <div className="cuadre-caja__state"><Spinner size={20} label="Cargando cuadre…" /></div>
          ) : (
            <>
              {/* ── Barra meta compacta ── */}
              <div className="cuadre-caja__meta-bar">
                <div className="cuadre-caja__meta-item">
                  <span className="cuadre-caja__meta-label">Fecha</span>
                  <input type="date" className="input input--sm" value={formFecha}
                    onChange={(e) => setFormFecha(e.target.value)} />
                </div>
                <div className="cuadre-caja__meta-item">
                  <span className="cuadre-caja__meta-label">Bodega</span>
                  <select className="select select--sm" value={formBodega ?? ''}
                    onChange={(e) => setFormBodega(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Seleccionar…</option>
                    {bodegas.map((b) => (
                      <option key={`cua-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>
                    ))}
                  </select>
                </div>
                <div className="cuadre-caja__meta-item">
                  <span className="cuadre-caja__meta-label">Sede</span>
                  <input type="text" className="input input--sm" value={payload.sede}
                    onChange={(e) => updateSede(e.target.value)} placeholder="Sede" />
                </div>
                <div className="cuadre-caja__meta-item">
                  <span className="cuadre-caja__meta-label">Responsable</span>
                  <input type="text" className="input input--sm" value={payload.responsable}
                    onChange={(e) => updateResponsable(e.target.value)} placeholder="Responsable" />
                </div>
              </div>

              {/* ── Cuerpo: 2 columnas ── */}
              <div className="cuadre-caja__form-body">
                {/* Columna izquierda: Efectivo + Pagos + Extras */}
                <div className="cuadre-caja__form-col">
                  {/* Efectivo */}
                  <section className="cuadre-caja__section">
                    <h3 className="cuadre-caja__section-title">Efectivo</h3>
                    <div className="cuadre-caja__denoms">
                      {DENOMINACIONES.map((denom) => {
                        const key = String(denom);
                        const qty = parseNum(payload.monedas[key]);
                        const subtotal = qty * denom;
                        return (
                          <div key={`cua-k-${key}`} className="cuadre-caja__denom-row">
                            <span className="cuadre-caja__denom-label">
                              Q {denom === 0.25 ? '0.25' : denom === 0.5 ? '0.50' : denom.toFixed(2)}
                            </span>
                            <input
                              type="number" step="1" min="0"
                              className="input input--sm cuadre-caja__num-input"
                              value={qty || ''}
                              onChange={(e) => updateMoneda(denom, e.target.value)}
                              placeholder="0"
                            />
                            <span className="cuadre-caja__denom-total">Q {fmtMoney(subtotal)}</span>
                          </div>
                        );
                      })}
                      <div className="cuadre-caja__denom-row cuadre-caja__denom-row--total">
                        <span className="cuadre-caja__denom-label">Total Efectivo</span>
                        <span></span>
                        <span className="cuadre-caja__denom-total cuadre-caja__denom-total--grand">
                          {fmtMoneda(totales.totalEfectivo)}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Pagos + Extras combinados */}
                  <section className="cuadre-caja__section">
                    <h3 className="cuadre-caja__section-title">Pagos</h3>
                    <div className="cuadre-caja__pagos">
                      {Object.keys(PAGO_LABELS).map((key) => (
                        <div key={`cua-k-${key}`} className="cuadre-caja__pago-row">
                          <span className="cuadre-caja__pago-label">{PAGO_LABELS[key]}</span>
                          <div className="cuadre-caja__pago-input-wrap">
                            <span className="cuadre-caja__pago-currency">Q</span>
                            <input
                              type="number" step="0.01" min="0"
                              className="input input--sm cuadre-caja__num-input"
                              value={parseNum(payload.pagos[key]) || ''}
                              onChange={(e) => updatePago(key, e.target.value)}
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      ))}
                      <div className="cuadre-caja__pago-row">
                        <span className="cuadre-caja__pago-label">Dólares (cant.)</span>
                        <div className="cuadre-caja__pago-input-wrap">
                          <span className="cuadre-caja__pago-currency">$</span>
                          <input
                            type="number" step="1" min="0"
                            className="input input--sm cuadre-caja__num-input"
                            value={parseNum(payload.pagos.dolares_cantidad) || ''}
                            onChange={(e) => updatePago('dolares_cantidad', e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div className="cuadre-caja__pago-row cuadre-caja__pago-row--info">
                        <span className="cuadre-caja__pago-label">→ Q (TC {DOLAR_TIPO_CAMBIO})</span>
                        <span className="cuadre-caja__pago-value">{fmtMoneda(totales.totalDolaresQ)}</span>
                      </div>
                      <div className="cuadre-caja__pago-row cuadre-caja__pago-row--total">
                        <span className="cuadre-caja__pago-label">Total Cobro</span>
                        <span className="cuadre-caja__pago-value cuadre-caja__pago-value--grand">
                          {fmtMoneda(totales.totalCobro)}
                        </span>
                      </div>
                    </div>

                    {/* Extras inline en Pagos */}
                    <div className="cuadre-caja__divider"></div>
                    <h3 className="cuadre-caja__section-title">Extras</h3>
                    <div className="cuadre-caja__extras">
                      <div className="cuadre-caja__extra-row">
                        <span className="cuadre-caja__extra-label">Pedidos Nilas</span>
                        <div className="cuadre-caja__pago-input-wrap">
                          <span className="cuadre-caja__pago-currency">Q</span>
                          <input
                            type="number" step="0.01" min="0"
                            className="input input--sm cuadre-caja__num-input"
                            value={parseNum(payload.extras.pedidos_nilas) || ''}
                            onChange={(e) => updateExtra('pedidos_nilas', e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="cuadre-caja__extra-row">
                        <span className="cuadre-caja__extra-label">Cortesías</span>
                        <div className="cuadre-caja__pago-input-wrap">
                          <span className="cuadre-caja__pago-currency">Q</span>
                          <input
                            type="number" step="0.01" min="0"
                            className="input input--sm cuadre-caja__num-input"
                            value={parseNum(payload.extras.cortesias) || ''}
                            onChange={(e) => updateExtra('cortesias', e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="cuadre-caja__extra-row cuadre-caja__extra-row--total">
                        <span className="cuadre-caja__extra-label">Total Extras</span>
                        <span className="cuadre-caja__pago-value cuadre-caja__pago-value--grand">
                          {fmtMoneda(totales.totalExtras)}
                        </span>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Columna derecha: Ventas + Detalle */}
                <div className="cuadre-caja__form-col">
                  {/* Ventas por Ambiente */}
                  <section className="cuadre-caja__section">
                    <div className="cuadre-caja__section-header-with-action">
                      <h3 className="cuadre-caja__section-title">Ventas por Ambiente</h3>
                      <Button size="xs" variant="ghost" onClick={addVentaRow}>+</Button>
                    </div>
                    <div className="cuadre-caja__mini-table">
                      <div className="cuadre-caja__mini-table-header">
                        <span>Ambiente</span>
                        <span>Monto</span>
                        <span></span>
                      </div>
                      {payload.ventas_rows.map((row, idx) => (
                        <div key={`cua-${idx}`} className="cuadre-caja__mini-table-row">
                          <input
                            type="text" className="input input--sm"
                            value={row.ambiente}
                            onChange={(e) => updateVentaRow(idx, 'ambiente', e.target.value)}
                            placeholder="Ambiente"
                            list="ventas-sugeridas"
                          />
                          <div className="cuadre-caja__pago-input-wrap">
                            <span className="cuadre-caja__pago-currency">Q</span>
                            <input
                              type="number" step="0.01" min="0"
                              className="input input--sm cuadre-caja__num-input"
                              value={row.monto || ''}
                              onChange={(e) => updateVentaRow(idx, 'monto', e.target.value)}
                              placeholder="0"
                            />
                          </div>
                          <button className="cuadre-caja__remove-btn" onClick={() => removeVentaRow(idx)}>✕</button>
                        </div>
                      ))}
                      <datalist id="ventas-sugeridas">
                        {VENTAS_SUGERIDAS.map((v) => <option key={`cua-${v}`} value={v} />)}
                      </datalist>
                      <div className="cuadre-caja__mini-table-row cuadre-caja__mini-table-row--total">
                        <span>Total Ventas</span>
                        <span className="cuadre-caja__pago-value cuadre-caja__pago-value--grand">
                          {fmtMoneda(totales.totalVentaAmbiente)}
                        </span>
                        <span></span>
                      </div>
                    </div>
                  </section>

                  {/* Detalle */}
                  <section className="cuadre-caja__section">
                    <div className="cuadre-caja__section-header-with-action">
                      <h3 className="cuadre-caja__section-title">Detalle</h3>
                      <Button size="xs" variant="ghost" onClick={addDetalleRow}>+</Button>
                    </div>
                    <div className="cuadre-caja__mini-table">
                      <div className="cuadre-caja__mini-table-header cuadre-caja__mini-table-header--4col">
                        <span>Descripción</span>
                        <span>Nombre</span>
                        <span>No.</span>
                        <span>Monto</span>
                        <span></span>
                      </div>
                      {payload.detalle.map((row, idx) => (
                        <div key={`cua-${idx}`} className="cuadre-caja__mini-table-row cuadre-caja__mini-table-row--4col">
                          <input type="text" className="input input--sm" value={row.descripcion}
                            onChange={(e) => updateDetalleRow(idx, 'descripcion', e.target.value)} placeholder="Descripción" />
                          <input type="text" className="input input--sm" value={row.nombre}
                            onChange={(e) => updateDetalleRow(idx, 'nombre', e.target.value)} placeholder="Nombre" />
                          <input type="text" className="input input--sm" value={row.check_no}
                            onChange={(e) => updateDetalleRow(idx, 'check_no', e.target.value)} placeholder="No." />
                          <div className="cuadre-caja__pago-input-wrap">
                            <span className="cuadre-caja__pago-currency">Q</span>
                            <input type="number" step="0.01" min="0"
                              className="input input--sm cuadre-caja__num-input" value={row.monto || ''}
                              onChange={(e) => updateDetalleRow(idx, 'monto', e.target.value)} placeholder="0" />
                          </div>
                          <button className="cuadre-caja__remove-btn" onClick={() => removeDetalleRow(idx)}>✕</button>
                        </div>
                      ))}
                      <div className="cuadre-caja__mini-table-row cuadre-caja__mini-table-row--total cuadre-caja__mini-table-row--4col">
                        <span></span><span></span><span>Total Detalle</span>
                        <span className="cuadre-caja__pago-value cuadre-caja__pago-value--grand">
                          {fmtMoneda(totales.totalDetalle)}
                        </span>
                        <span></span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer con Gran Total ── */}
        <div className="cuadre-caja__form-footer">
          <div className="cuadre-caja__footer-totals">
            <span className="cuadre-caja__footer-total-item">
              Efectivo: <strong>{fmtMoneda(totales.totalEfectivo)}</strong>
            </span>
            <span className="cuadre-caja__footer-total-item">
              Cobro: <strong>{fmtMoneda(totales.totalCobro)}</strong>
            </span>
            <span className="cuadre-caja__footer-total-item">
              V. Ambiente: <strong>{fmtMoneda(totales.totalVentaAmbiente)}</strong>
            </span>
            <span className="cuadre-caja__footer-total-item">
              Extras: <strong>{fmtMoneda(totales.totalExtras)}</strong>
            </span>
            <span className="cuadre-caja__footer-total-item">
              Detalle: <strong>{fmtMoneda(totales.totalDetalle)}</strong>
            </span>
            <span className="cuadre-caja__footer-total-item cuadre-caja__footer-total-item--grand">
              Gran Total: <strong>{fmtMoneda(totales.granTotal)}</strong>
            </span>
          </div>
        </div>
      </>
    );
  }

  // ─── Render: List View ───────────────────────────────────────────
  return (
    <>
      <Header
        title="Cuadre de Caja"
        subtitle={
          loading
            ? 'Cargando…'
            : `${rows.length} registro${rows.length === 1 ? '' : 's'}` +
              (fecha ? ` · ${formatDate(fecha)}` : '')
        }
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button size="sm" variant="primary" onClick={openNewForm}>
              + Nuevo cuadre
            </Button>
            {rows.length > 0 && !loading ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setShowColumnSelector(true)}>
                  Exportar
                </Button>
                <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                  Refrescar
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="cuadre-caja">
        <Card>
          <div className="cuadre-caja__filters">
            <div className="cuadre-caja__filter-group">
              <label className="cuadre-caja__filter-label">Fecha</label>
              <input type="date" className="input" value={fecha}
                onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="cuadre-caja__filter-group">
              <label className="cuadre-caja__filter-label">Bodega</label>
              <select className="select" value={warehouseId ?? ''}
                onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todas las bodegas</option>
                {bodegas.map((b) => <option key={`cua-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>)}
              </select>
            </div>
            <div className="cuadre-caja__filter-group">
              <label className="cuadre-caja__filter-label">Responsable</label>
              <div className="cuadre-caja__search-wrap">
              <input type="text" className="input" placeholder="Buscar responsable…"
                value={responsable} onChange={(e) => setResponsable(e.target.value)} onKeyDown={handleKeyDown} />
              {responsable && (
                <button type="button" className="cuadre-caja__search-btn" onClick={handleSearchResponsable} title="Buscar" aria-label="Buscar">⌕</button>
              )}
              </div>
            </div>
            {hasActiveFilters && (
              <div className="cuadre-caja__filter-group cuadre-caja__filter-group--action">
                <Button size="sm" variant="ghost" onClick={handleClearFilters}>
                  Limpiar filtros
                </Button>
              </div>
            )}
          </div>
        </Card>

        {loading || contextLoading ? (
          <div className="cuadre-caja__state"><Spinner size={20} label="Cargando cuadre de caja…" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="💰" title="Sin registros" message="No hay cuadres de caja para los filtros seleccionados."
            action={<Button variant="primary" onClick={openNewForm}>+ Crear nuevo cuadre</Button>}
          />
        ) : (
          <div className="cuadre-caja__table-wrapper">
            <table className="table table--sm">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Bodega</th>
                  {!isMobile && <th>Sede</th>}
                  <th>Responsable</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Efectivo</th>
                  {!isMobile && <th style={{ textAlign: 'right', width: 100 }}>Cobro</th>}
                  {!isMobile && <th style={{ textAlign: 'right', width: 110 }}>V. Ambiente</th>}
                  <th style={{ textAlign: 'right', width: 110 }}>Gran Total</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id_cuadre || i} className="cuadre-caja__row" onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                    <td className="cuadre-caja__date">{formatDate(r.fecha)}</td>
                    <td>{r.nombre_bodega || '—'}</td>
                    {!isMobile && <td className="cuadre-caja__muted">{r.sede || '—'}</td>}
                    <td className="cuadre-caja__responsable">{r.responsable || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMoneda(r.total_efectivo)}</td>
                    {!isMobile && <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMoneda(r.total_cobro)}</td>}
                    {!isMobile && <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMoneda(r.total_venta_ambiente)}</td>}
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtMoneda(r.gran_total_reporte)}</td>
                    <td>
                      <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditForm(r); }}>
                        ✏️
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="cuadre-caja__total-row">
                  <td style={{ fontWeight: 600 }}>{rows.length} registro{rows.length === 1 ? '' : 's'}</td>
                  <td></td>
                  {!isMobile && <td></td>}
                  <td style={{ fontWeight: 600 }}>Totales</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtMoneda(listTotals.efectivo)}</td>
                  {!isMobile && <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtMoneda(listTotals.cobro)}</td>}
                  {!isMobile && <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtMoneda(listTotals.venta)}</td>}
                  <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtMoneda(listTotals.granTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Column selector modal */}
      <ColumnSelectorModal
        open={showColumnSelector}
        onClose={() => setShowColumnSelector(false)}
        columns={allExportColumns}
        storageKey="export-columns-cuadre-caja"
        onConfirm={handleExportWithColumns}
      />

      {/* Detail modal */}
      <Modal
        open={detailRow != null}
        onClose={() => { setDetailRow(null); setDetailData(null); }}
        title={`Cuadre de Caja — ${formatDate(detailRow?.fecha)}`}
        size="md"
      >
        {detailLoading ? (
          <div className="cuadre-caja__modal-state"><Spinner size={16} label="Cargando detalle…" /></div>
        ) : detailData ? (
          <div className="cuadre-caja__detail">
            <div className="cuadre-caja__detail-header">
              <div className="cuadre-caja__detail-field">
                <span className="cuadre-caja__detail-label">Bodega</span>
                <span className="cuadre-caja__detail-value">{detailData.bodega || '—'}</span>
              </div>
              <div className="cuadre-caja__detail-field">
                <span className="cuadre-caja__detail-label">Fecha</span>
                <span className="cuadre-caja__detail-value">{formatDate(detailData.fecha)}</span>
              </div>
              <div className="cuadre-caja__detail-field">
                <span className="cuadre-caja__detail-label">Responsable</span>
                <span className="cuadre-caja__detail-value">{detailRow?.responsable || '—'}</span>
              </div>
            </div>

            <div className="cuadre-caja__detail-grid">
              {detailData.payload?.monedas && Object.keys(detailData.payload.monedas).length > 0 && (
                <div className="cuadre-caja__detail-section">
                  <h4 className="cuadre-caja__detail-section-title">Efectivo</h4>
                  <table className="cuadre-caja__detail-table">
                    <thead>
                      <tr>
                        <th>Denominación</th>
                        <th style={{ textAlign: 'right' }}>Cantidad</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detailData.payload.monedas).map(([denom, qty]) => {
                        const numQty = Number(qty || 0);
                        if (numQty === 0) return null;
                        const total = numQty * Number(denom);
                        return (
                          <tr key={`cua-${denom}`}>
                            <td>Q {fmtMoney(denom)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtMoney(numQty)}</td>
                            <td style={{ textAlign: 'right' }}>Q {fmtMoney(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {detailData.payload?.pagos && Object.keys(detailData.payload.pagos).length > 0 && (
                <div className="cuadre-caja__detail-section">
                  <h4 className="cuadre-caja__detail-section-title">Pagos</h4>
                  <table className="cuadre-caja__detail-table">
                    <thead>
                      <tr>
                        <th>Método</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detailData.payload.pagos).map(([key, val]) => {
                        const num = Number(val || 0);
                        if (num === 0 && key !== 'dolares_cantidad') return null;
                        const labels = {
                          visa: 'Visa',
                          bancos: 'Bancos',
                          cxc_trabajadores: 'CxC Trabajadores',
                          cxc_habitaciones: 'CxC Habitaciones',
                          pase_consumible: 'Pase Consumible',
                          dolares_cantidad: 'Dólares (cant.)',
                        };
                        return (
                          <tr key={`cua-k-${key}`}>
                            <td>{labels[key] || key}</td>
                            <td style={{ textAlign: 'right' }}>{fmtMoneda(num)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {detailData.payload?.ventas && Object.keys(detailData.payload.ventas).length > 0 && (
                <div className="cuadre-caja__detail-section">
                  <h4 className="cuadre-caja__detail-section-title">Ventas</h4>
                  <table className="cuadre-caja__detail-table">
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detailData.payload.ventas).map(([key, val]) => {
                        const num = Number(val || 0);
                        if (num === 0) return null;
                        return (
                          <tr key={`cua-k-${key}`}>
                            <td>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                            <td style={{ textAlign: 'right' }}>{fmtMoneda(num)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {detailData.payload?.extras && Object.keys(detailData.payload.extras).length > 0 && (
                <div className="cuadre-caja__detail-section">
                  <h4 className="cuadre-caja__detail-section-title">Extras</h4>
                  <table className="cuadre-caja__detail-table">
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detailData.payload.extras).map(([key, val]) => {
                        const num = Number(val || 0);
                        if (num === 0) return null;
                        return (
                          <tr key={`cua-k-${key}`}>
                            <td>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                            <td style={{ textAlign: 'right' }}>{fmtMoneda(num)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="cuadre-caja__detail-totals">
              <div className="cuadre-caja__detail-total-row">
                <span>Total Efectivo</span>
                <span>{fmtMoneda(detailData.totals?.total_efectivo)}</span>
              </div>
              <div className="cuadre-caja__detail-total-row">
                <span>Total Cobro</span>
                <span>{fmtMoneda(detailData.totals?.total_cobro)}</span>
              </div>
              <div className="cuadre-caja__detail-total-row">
                <span>Venta Ambiente</span>
                <span>{fmtMoneda(detailData.totals?.total_venta_ambiente)}</span>
              </div>
              <div className="cuadre-caja__detail-total-row cuadre-caja__detail-total-row--grand">
                <span>Gran Total</span>
                <span>{fmtMoneda(detailData.totals?.gran_total_reporte)}</span>
              </div>
            </div>

            <div className="cuadre-caja__detail-actions">
              <Button size="sm" variant="ghost" onClick={() => submitDetailPrintForm('pdf')}>
                📄 PDF
              </Button>
              <Button size="sm" variant="ghost" onClick={() => submitDetailPrintForm('pos')}>
                🧾 POS 80mm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDetailRow(null); openEditForm(detailRow); }}>
                ✏️ Editar
              </Button>
              <Button size="sm" variant="primary" onClick={() => {
                setDetailRow(null);
                setDetailData(null);
                navigate(`/corte-diario?warehouse=${detailData.id_bodega}`);
              }}>
                Ver Corte Diario
              </Button>
            </div>

            {detailData.actualizado_en && (
              <div className="cuadre-caja__detail-footer">
                Actualizado: {String(detailData.actualizado_en).slice(0, 19).replace('T', ' ')}
              </div>
            )}
          </div>
        ) : (
          <div className="cuadre-caja__modal-state" style={{ color: 'var(--color-text-muted)' }}>
            No hay datos disponibles
          </div>
        )}
      </Modal>
    </>
  );
}
