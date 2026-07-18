// server-lib/cuadre-constants.js  —  Cuadre de caja constants and ambiente key normalizer

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

export {
  CUADRE_DENOMINACIONES, CUADRE_DOLAR_DENOM_USD, CUADRE_DOLAR_TIPO_CAMBIO,
  CUADRE_VENTAS_KEYS, CUADRE_PAGOS_KEYS, CUADRE_EXTRAS_KEYS,
  normalizeCuadreAmbienteKey,
};
