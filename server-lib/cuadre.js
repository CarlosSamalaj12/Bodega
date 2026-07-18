// server-lib/cuadre.js  —  Cuadre de caja constants and payload normalization
import { clampText, numMoney, numQty } from "./format.js";

const CUADRE_DENOMINACIONES = [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200];
const CUADRE_DOLAR_DENOM_USD = 1;
const CUADRE_DOLAR_TIPO_CAMBIO = 7.3;
const CUADRE_VENTAS_KEYS = ["flor_cafe", "restaurante", "nilas", "eldeck", "cactus", "gelato", "jazmin"];
const CUADRE_PAGOS_KEYS = ["visa", "bancos", "cxc_trabajadores", "cxc_habitaciones", "pase_consumible"];
const CUADRE_EXTRAS_KEYS = ["pedidos_nilas", "cortesias"];

function normalizeCuadreAmbienteKey(name) {
  const raw = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  if (!raw) return null;
  if (raw.includes("flor") && raw.includes("cafe")) return "flor_cafe";
  if (raw === "restaurante") return "restaurante";
  if (raw === "nilas") return "nilas";
  if (raw === "eldeck") return "eldeck";
  if (raw === "cactus") return "cactus";
  if (raw === "gelato") return "gelato";
  if (raw === "jazmin") return "jazmin";
  return null;
}

function normalizeCuadrePayload(rawPayload = {}, fallback = {}) {
  const raw = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};

  const rawMonedas = raw.monedas && typeof raw.monedas === "object" ? raw.monedas : {};
  const rawPagos = raw.pagos && typeof raw.pagos === "object" ? raw.pagos : {};
  const rawVentas = raw.ventas && typeof raw.ventas === "object" ? raw.ventas : {};
  const rawVentasRows = Array.isArray(raw.ventas_rows) ? raw.ventas_rows : (Array.isArray(previous.ventas_rows) ? previous.ventas_rows : []);
  const rawExtras = raw.extras && typeof raw.extras === "object" ? raw.extras : {};

  const refMonedas = previous.monedas && typeof previous.monedas === "object" ? previous.monedas : {};
  const refPagos = previous.pagos && typeof previous.pagos === "object" ? previous.pagos : {};
  const refVentas = previous.ventas && typeof previous.ventas === "object" ? previous.ventas : {};
  const refExtras = previous.extras && typeof previous.extras === "object" ? previous.extras : {};

  const monedas = {};
  for (const d of CUADRE_DENOMINACIONES) { const key = String(d); monedas[key] = Math.max(0, numQty(rawMonedas[key] ?? refMonedas[key] ?? 0)); }

  const pagos = {};
  for (const k of CUADRE_PAGOS_KEYS) {
    const legacyKey = k === "pase_consumible" ? "day" : null;
    pagos[k] = Math.max(0, numMoney(rawPagos[k] ?? (legacyKey ? rawPagos[legacyKey] : undefined) ?? refPagos[k] ?? (legacyKey ? refPagos[legacyKey] : undefined) ?? 0));
  }
  pagos.dolares_cantidad = Math.max(0, numQty(rawPagos.dolares_cantidad ?? refPagos.dolares_cantidad ?? 0));

  const ventas = {};
  for (const k of CUADRE_VENTAS_KEYS) ventas[k] = Math.max(0, numMoney(rawVentas[k] ?? refVentas[k] ?? 0));

  const ventas_rows = rawVentasRows.slice(0, 250).map((row) => {
    if (!row || typeof row !== "object") return null;
    const ambiente = clampText(row.ambiente, 80);
    const monto = Math.max(0, numMoney(row.monto));
    if (!ambiente && !monto) return null;
    return { ambiente, monto };
  }).filter(Boolean);

  if (ventas_rows.length) {
    const mapped = { flor_cafe: 0, restaurante: 0, nilas: 0, eldeck: 0, cactus: 0, gelato: 0, jazmin: 0 };
    ventas_rows.forEach((row) => { const key = normalizeCuadreAmbienteKey(row.ambiente); if (key) mapped[key] = Number(mapped[key] || 0) + Number(row.monto || 0); });
    for (const k of CUADRE_VENTAS_KEYS) ventas[k] = Math.round(Number(mapped[k] || 0) * 100) / 100;
  }

  const extras = {};
  for (const k of CUADRE_EXTRAS_KEYS) extras[k] = Math.max(0, numMoney(rawExtras[k] ?? refExtras[k] ?? 0));

  const rawDetalle = Array.isArray(raw.detalle) ? raw.detalle : (Array.isArray(previous.detalle) ? previous.detalle : []);
  const detalle = rawDetalle.slice(0, 250).map((row) => {
    if (!row || typeof row !== "object") return null;
    const descripcion = clampText(row.descripcion, 80);
    const nombre = clampText(row.nombre, 120);
    const monto = Math.max(0, numMoney(row.monto));
    const check_no = clampText(row.check_no, 40);
    if (!descripcion && !nombre && !monto && !check_no) return null;
    return { descripcion, nombre, monto, check_no };
  }).filter(Boolean);

  const legacyDolaresQuetzales = Math.max(0, numMoney(rawPagos.dolares ?? refPagos.dolares ?? 0));
  const sede = clampText(raw.sede ?? previous.sede ?? "", 120);
  const responsable = clampText(raw.responsable ?? previous.responsable ?? "", 120);

  const totalEfectivoDenominaciones = CUADRE_DENOMINACIONES.reduce((acc, d) => acc + Number(monedas[String(d)] || 0) * Number(d), 0);
  const total_dolares = Math.round((Number(pagos.dolares_cantidad || 0) * CUADRE_DOLAR_DENOM_USD) * 100) / 100;
  const total_dolares_quetzales = pagos.dolares_cantidad > 0 ? Math.round((total_dolares * CUADRE_DOLAR_TIPO_CAMBIO) * 100) / 100 : legacyDolaresQuetzales;
  const total_efectivo = Math.round((totalEfectivoDenominaciones + total_dolares_quetzales) * 100) / 100;
  const total_cobro = Math.round((total_efectivo + CUADRE_PAGOS_KEYS.reduce((acc, k) => acc + Number(pagos[k] || 0), 0)) * 100) / 100;
  const total_venta_ambiente = ventas_rows.length ? Math.round(ventas_rows.reduce((acc, row) => acc + Number(row.monto || 0), 0) * 100) / 100 : Math.round(CUADRE_VENTAS_KEYS.reduce((acc, k) => acc + Number(ventas[k] || 0), 0) * 100) / 100;
  const gran_total_reporte = Math.round((total_venta_ambiente + CUADRE_EXTRAS_KEYS.reduce((acc, k) => acc + Number(extras[k] || 0), 0)) * 100) / 100;

  pagos.dolares_total = total_dolares;
  pagos.dolares_quetzales = total_dolares_quetzales;

  return { payload: { sede, responsable, monedas, pagos, ventas, ventas_rows, extras, detalle }, total_efectivo, total_cobro, total_venta_ambiente, gran_total_reporte };
}

export {
  CUADRE_DENOMINACIONES, CUADRE_DOLAR_DENOM_USD, CUADRE_DOLAR_TIPO_CAMBIO,
  CUADRE_VENTAS_KEYS, CUADRE_PAGOS_KEYS, CUADRE_EXTRAS_KEYS,
  normalizeCuadreAmbienteKey, normalizeCuadrePayload,
};
