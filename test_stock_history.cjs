// ─────────────────────────────────────────────────────────────────────────────
// test_stock_history.cjs
// Test funcional del historial del healthcheck de stock_actual.
//
// checkStockActualConsistency() vive dentro de server.js (que arranca el server
// al importarse), así que este test EXTRAE la función real del fuente y la
// ejecuta con dependencias simuladas (pool/opsMetrics/io) para forzar los 3
// escenarios — ok, desync y error — sin tocar la BD real.
//
// Verifica:
//   • history acumula una entrada por corrida con { at, status, mismatches,
//     expected_groups, actual_groups, ms } (+ error en corridas fallidas).
//   • El trim mantiene las últimas STOCK_HC_HISTORY_LIMIT corridas (descarta
//     las más viejas).
//   • ms es UNA medición única: el ms guardado en history coincide EXACTAMENTE
//     con el ms que imprimen los logs (después del refactor de unificación).
//   • En desync se emite io.emit("stock:desync") con el conteo correcto.
//
// Uso: node test_stock_history.cjs   (exit 0 = OK, 1 = fallo, 2 = error)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs");

// ── Extracción de la función real desde server.js ────────────────────────────
const SERVER_SRC = fs.readFileSync("server.js", "utf8");

// Extrae `async function <name>(...) { ... }` balanceando llaves y respetando
// strings, template literals y ${expresiones} anidadas.
function extractFunction(src, fnName) {
  const start = src.indexOf(`async function ${fnName}(`);
  if (start < 0) throw new Error(`No se encontró 'async function ${fnName}' en server.js`);
  let i = src.indexOf("{", start);
  let depth = 0; // contador de llaves de la función (solo modo normal)
  let tplDepth = 0; // contador independiente para ${...} dentro de template literals
  let mode = null; // null | "'" | '"' | "`" | "tpl-expr"
  for (; i < src.length; i++) {
    const ch = src[i];
    if (mode === "tpl-expr") {
      // Al entrar en ${...} se consume el '{' inicial (tplDepth arranca en 0);
      // el PRIMER '}' cierra la expresión y vuelve al modo template. Las '{'/'}'
      // anidadas (p.ej. JSON.stringify({...})) incrementan/decrementan tplDepth.
      // IMPORTANTE: usa tplDepth (independiente de depth) para NO descuadrar el
      // balanceo de llaves de la función con cada ${...} del fuente real.
      if (ch === "{") tplDepth++;
      else if (ch === "}") {
        if (tplDepth === 0) mode = "`";
        else tplDepth--;
      }
      continue;
    }
    if (mode === "`") {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") mode = null;
      else if (ch === "$" && src[i + 1] === "{") { mode = "tpl-expr"; tplDepth = 0; i++; }
      continue;
    }
    if (mode === "'" || mode === '"') {
      if (ch === "\\") { i++; continue; }
      if (ch === mode) mode = null;
      continue;
    }
    if (ch === "'" || ch === '"') mode = ch;
    else if (ch === "`") mode = "`";
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  // NOTA (fragilidad aceptada): dentro de ${...} (tpl-expr) no se saltan strings
  // ni escapes — sirve para el fuente actual, cuyas expresiones son m.key,
  // JSON.stringify(...) y números. Si el fuente llegara a tener una expresión
  // con una llave dentro de un string (p.ej. ${x ? "}" : "{"}), habría que
  // extender este parser. El test fallaría de forma visible si el extractor se
  // cortara mal, así que la desviación se detecta en CI.
  throw new Error(`No se encontró el cierre de 'async function ${fnName}'`);
}

function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`No se encontró 'const ${name}' en server.js`);
  return Number(m[1].trim());
}

const FN_SRC = extractFunction(SERVER_SRC, "checkStockActualConsistency");
const STOCK_HC_HISTORY_LIMIT = extractConst(SERVER_SRC, "STOCK_HC_HISTORY_LIMIT");
const STOCK_HC_MAX_DETAILS = extractConst(SERVER_SRC, "STOCK_HC_MAX_DETAILS");

// ── Mocks ────────────────────────────────────────────────────────────────────
function makeOpsMetrics() {
  return {
    started_at: new Date().toISOString(),
    api: { total: 0, errors_4xx: 0, errors_5xx: 0, total_latency_ms: 0, max_latency_ms: 0, recent: [] },
    db: { total_queries: 0, failures: 0, total_latency_ms: 0, max_latency_ms: 0, recent_failures: [], last_error: null },
    pin_failures: { order: [], supervisor: [] },
    sensitive_actions: { approved_by_special_permission: 0, approved_by_supervisor_pin: 0, blocked: 0 },
    stock_actual: {
      status: "unknown",
      last_check_at: null,
      expected_groups: 0,
      actual_groups: 0,
      mismatches: 0,
      last_error: null,
      history: [],
    },
  };
}

// 2 desviaciones simuladas: una con actual AUSENTE y otra con stock distinto.
const DESYNC_ROWS = [
  { id_bodega: 1, id_producto: 10, lote_key: "YLOTE-A", fecha_key: "2026-08-01", exp_stock: "100.000", exp_fel: "2026-08-01", act_stock: "90.000", act_fel: "2026-08-01" },
  { id_bodega: 2, id_producto: 20, lote_key: "N", fecha_key: "1000-01-01", exp_stock: null, exp_fel: null, act_stock: "5.000", act_fel: "2026-07-01" },
];

let scenario = "ok"; // ok | desync | error
const pool = {
  async query(sql) {
    if (scenario === "error") throw new Error("Fallo DB simulado");
    const s = String(sql);
    if (s.includes("SELECT COUNT(*) FROM stock_actual")) {
      return [[{ actual_groups: 16189, expected_groups: 16189 }], []];
    }
    if (scenario === "desync") return [DESYNC_ROWS, []];
    return [[], []];
  },
};

const emitted = [];
const io = { emit: (ev, payload) => emitted.push({ ev, payload }) };

const opsMetrics = makeOpsMetrics();

// Compila la función real con las dependencias inyectadas como parámetros.
const healthcheck = new Function(
  "stockActualReadyPromise", "pool", "opsMetrics", "io",
  "STOCK_HC_DIFF_SQL", "STOCK_HC_MAX_DETAILS", "STOCK_HC_HISTORY_LIMIT",
  `return (${FN_SRC});`
)(Promise.resolve(), pool, opsMetrics, io, "SELECT 1 -- diff simulado", STOCK_HC_MAX_DETAILS, STOCK_HC_HISTORY_LIMIT);

// ── Runner con captura de logs (para comparar ms del log vs ms del historial) ─
const realWarn = console.warn;
const realLog = console.log;
const realError = console.error;
let runLog = [];
console.warn = (...a) => runLog.push("WARN " + a.join(" "));
console.log = (...a) => runLog.push("LOG " + a.join(" "));
console.error = (...a) => runLog.push("ERR " + a.join(" "));

async function runOnce() {
  runLog = [];
  await healthcheck();
  return runLog.join("\n");
}

// ── Aserciones ───────────────────────────────────────────────────────────────
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else {
    failures++;
    console.error(`  ❌ ${msg}`);
  }
};
const msFromLog = (log) => {
  const m = String(log).match(/en (\d+)ms/);
  return m ? Number(m[1]) : null;
};

(async () => {
  // ── Escenario 1: ok × 3 ──
  console.log("\n=== Escenario OK (3 corridas) ===");
  scenario = "ok";
  for (let i = 0; i < 3; i++) {
    const log = await runOnce();
    const h = opsMetrics.stock_actual.history;
    const last = h[h.length - 1];
    const msLog = msFromLog(log);
    check(last.status === "ok", `corrida ${i + 1}: status ok`);
    check(last.mismatches === 0 && last.expected_groups === 16189 && last.actual_groups === 16189, `corrida ${i + 1}: conteos correctos`);
    check(Number.isFinite(last.ms) && last.ms >= 0, `corrida ${i + 1}: ms >= 0 (${last.ms})`);
    check(!isNaN(Date.parse(last.at)), `corrida ${i + 1}: at es timestamp ISO válido`);
    check(msLog !== null && msLog === last.ms, `corrida ${i + 1}: ms historial (${last.ms}) == ms log (${msLog}) — medición única`);
  }
  check(opsMetrics.stock_actual.history.length === 3, "history acumula 3 corridas");
  check(emitted.length === 0, "no se emitió stock:desync en escenario ok");

  // ── Escenario 2: desync (2 desviaciones) ──
  console.log("\n=== Escenario DESYNC ===");
  scenario = "desync";
  const dlog = await runOnce();
  const dh = opsMetrics.stock_actual.history;
  const dlast = dh[dh.length - 1];
  const dmsLog = msFromLog(dlog);
  check(dlast.status === "desync", "status desync");
  check(dlast.mismatches === 2, `mismatches = 2 (real: ${dlast.mismatches})`);
  check(dh.length === 4, "history acumula 4 corridas");
  check(dmsLog !== null && dmsLog === dlast.ms, `ms historial (${dlast.ms}) == ms log (${dmsLog}) en desync`);
  check(
    emitted.length === 1 && emitted[0].ev === "stock:desync" && emitted[0].payload.mismatches === 2,
    "io.emit('stock:desync') con mismatches=2"
  );

  // ── Escenario 3: error ──
  console.log("\n=== Escenario ERROR ===");
  scenario = "error";
  await runOnce();
  const eh = opsMetrics.stock_actual.history;
  const elast = eh[eh.length - 1];
  check(elast.status === "error", "status error");
  check(elast.mismatches === 0, "mismatches = 0 en error");
  check(typeof elast.error === "string" && elast.error.length > 0, "campo error presente");
  check(Number.isFinite(elast.ms) && elast.ms >= 0, `ms >= 0 en error (${elast.ms})`);
  check(eh.length === 5, "history acumula 5 corridas");

  // ── Escenario 4: trim ──
  console.log(`\n=== Escenario TRIM (LIMIT=${STOCK_HC_HISTORY_LIMIT}) ===`);
  opsMetrics.stock_actual.history = [];
  scenario = "ok";
  const total = STOCK_HC_HISTORY_LIMIT + 10;
  for (let i = 0; i < total; i++) await runOnce();
  check(
    opsMetrics.stock_actual.history.length === STOCK_HC_HISTORY_LIMIT,
    `history.length == LIMIT tras ${total} corridas (real: ${opsMetrics.stock_actual.history.length})`
  );
  check(
    opsMetrics.stock_actual.history.every((h) => h.status === "ok"),
    "todas las entradas restantes son ok"
  );
  // Verifica que el trim descartó SOLO las más viejas (FIFO): pushHistory hace
  // splice(0, exceso) que elimina del inicio, así que el orden de `at` debe
  // conservarse en los que sobreviven. Se usa NO decreciente (>=) en vez de
  // estrictamente creciente porque los mocks resuelven en microtasks y dos
  // corridas consecutivas pueden caer en el mismo milisegundo (misma `at`).
  const ats = opsMetrics.stock_actual.history.map((h) => Date.parse(h.at));
  const nonDecreasing = ats.every((t, i) => i === 0 || t >= ats[i - 1]);
  check(nonDecreasing, "los at restantes son no-decrecientes (orden FIFO conservado: se descartaron las más viejas)");

  // ── Escenario 5: secuencia mixta intermitente ──
  console.log("\n=== Escenario MIXTO (ok/desync/error intermitente) ===");
  opsMetrics.stock_actual.history = [];
  emitted.length = 0;
  const pattern = ["ok", "desync", "ok", "error", "ok", "desync", "ok", "ok", "error"];
  for (const s of pattern) {
    scenario = s;
    await runOnce();
  }
  const statuses = opsMetrics.stock_actual.history.map((h) => h.status);
  check(
    JSON.stringify(statuses) === JSON.stringify(pattern),
    `secuencia de statuses correcta: ${statuses.join(",")}`
  );
  const expectedMismatches = pattern.map((s) => (s === "desync" ? 2 : 0));
  const mismatchesSeq = opsMetrics.stock_actual.history.map((h) => h.mismatches);
  check(
    JSON.stringify(mismatchesSeq) === JSON.stringify(expectedMismatches),
    `secuencia de mismatches correcta (desync=2, resto 0): ${mismatchesSeq.join(",")}`
  );
  const desyncCount = opsMetrics.stock_actual.history.filter((h) => h.status === "desync").length;
  check(desyncCount === 2, `2 desync en el historial — patrón intermitente visible (${desyncCount})`);
  check(emitted.filter((e) => e.ev === "stock:desync").length === 2, "2 eventos stock:desync emitidos");

  // Restaura console
  console.warn = realWarn;
  console.log = realLog;
  console.error = realError;

  console.log(failures === 0 ? "\n🎉 TODOS LOS TESTS PASARON ✅" : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(2);
});
