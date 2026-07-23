(function(){
if (!window.BodegaShared) { console.error("ajustes.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var $ = window.$;
var on = window.on;
var val = window.val;
var setVal = window.setVal;
var html = window.html;
var show = window.show;
var hide = window.hide;
var escHtml = window.escHtml;
var fmtNum = window.fmtNum;
var fmtMoney = window.fmtMoney;
var todayStr = window.todayStr;
var timeStr = window.timeStr;
var num = window.num;
var notify = window.notify;

var AJUSTE_ITEMS = [];

function initAjustes() {
  loadMotivosAjuste();
  loadWarehouses();
}

function loadMotivosAjuste() {
  _apiFetch("/api/catalog/motivos?tipo=AJUSTE").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("ajMotivo");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione motivo</option>';
    rows.forEach(function(m) {
      sel.innerHTML += '<option value="' + escHtml(m.id_motivo) + '">' + escHtml(m.nombre_motivo) + "</option>";
    });
  }).catch(function(e) { console.error("loadMotivosAjuste error:", e); });
}

function loadWarehouses() {
  _apiFetch("/api/catalog/bodegas").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("ajWarehouse");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione bodega</option>';
    rows.forEach(function(b) {
      sel.innerHTML += '<option value="' + escHtml(b.id_bodega) + '">' + escHtml(b.nombre_bodega) + "</option>";
    });
  }).catch(function(e) { console.error("loadWarehouses error:", e); });
}

on($("ajAdd"), "click", function() {
  var producto = val($("ajProducto")).trim();
  var cantidad = num(val($("ajCantidad")));
  var costo = num(val($("ajCosto")));
  var lote = val($("ajLote"));
  var caducidad = val($("ajCaducidad"));
  var obs = val($("ajObsLinea"));
  var direccion = val($("ajDireccion"));

  if (!producto) { notify("Ingresa un producto", "warn"); return; }
  if (!cantidad || cantidad <= 0) { notify("Ingresa una cantidad valida", "warn"); return; }

  AJUSTE_ITEMS.push({
    nombre_producto: producto,
    cantidad: cantidad,
    costo: costo,
    lote: lote || "",
    caducidad: caducidad || "",
    observacion: obs || "",
    direccion: direccion,
  });
  renderAjusteList();
  setVal($("ajProducto"), "");
  setVal($("ajCantidad"), "");
  setVal($("ajCosto"), "");
  setVal($("ajLote"), "");
  setVal($("ajCaducidad"), "");
  setVal($("ajObsLinea"), "");
  setVal($("ajStockActual"), "");
  setVal($("ajStockProyectado"), "");
});

function renderAjusteList() {
  var tbody = document.getElementById("ajList");
  if (!tbody) return;
  if (!AJUSTE_ITEMS.length) {
    tbody.innerHTML = "<tr><td colspan='7'>Sin lineas</td></tr>";
    return;
  }
  tbody.innerHTML = AJUSTE_ITEMS.map(function(item, i) {
    return "<tr><td>" + escHtml(item.nombre_producto) + "</td><td>" + escHtml(item.lote || "-") + "</td><td>" + escHtml(item.caducidad || "-") + "</td><td>" + fmtNum(item.cantidad) + "</td><td>" + fmtMoney(item.costo) + "</td><td>" + escHtml(item.observacion || "-") + '</td><td><button class="btn soft btn-sm ajRemoveBtn" data-index="' + i + '" type="button">Eliminar</button></td></tr>';
  }).join("");
  tbody.querySelectorAll(".ajRemoveBtn").forEach(function(btn) {
    on(btn, "click", function() {
      var idx = parseInt(btn.getAttribute("data-index"), 10);
      AJUSTE_ITEMS.splice(idx, 1);
      renderAjusteList();
    });
  });
}

on($("ajClear"), "click", function() {
  AJUSTE_ITEMS = [];
  renderAjusteList();
});

on($("ajSave"), "click", function() {
  var motivo = val($("ajMotivo"));
  var bodega = val($("ajWarehouse"));
  var observacion = val($("ajObservacion"));
  var direccion = val($("ajDireccion"));

  if (!motivo) { notify("Selecciona un motivo", "warn"); return; }
  if (!bodega) { notify("Selecciona una bodega", "warn"); return; }
  if (!AJUSTE_ITEMS.length) { notify("Agrega al menos una linea", "warn"); return; }

  var payload = {
    tipo: direccion,
    id_motivo: motivo,
    id_bodega: bodega,
    observacion: observacion,
    lineas: AJUSTE_ITEMS,
  };

  _apiFetch("/api/warehouse/ajuste", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, data: d }; });
  }).then(function(res) {
    if (!res.ok) throw new Error(res.data.error || "Error al guardar");
    notify("Ajuste guardado exitosamente", "ok");
    AJUSTE_ITEMS = [];
    renderAjusteList();
  }).catch(function(e) {
    notify(e.message || "Error al guardar ajuste", "err");
  });
});

window.initAjustes = initAjustes;

console.log("ajustes.js loaded");
})();