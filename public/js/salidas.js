(function(){
if (!window.BodegaShared) { console.error("salidas.js: shared.js not loaded"); return; }

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

var SALIDA_ITEMS = [];

function initSalidas() {
  setVal($("salFecha"), todayStr());
  setVal($("salHora"), timeStr());

  var user = window.getUser();
  if (user) setVal($("salBodega"), user.id_warehouse || "");

  loadMotivosSalida();
  loadDestinos();
}

function loadMotivosSalida() {
  _apiFetch("/api/catalog/motivos?tipo=SALIDA").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("salMotivo");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione</option>';
    rows.forEach(function(m) {
      sel.innerHTML += '<option value="' + escHtml(m.id_motivo) + '">' + escHtml(m.nombre_motivo) + "</option>";
    });
  }).catch(function(e) { console.error("loadMotivosSalida error:", e); });
}

function loadDestinos() {
  _apiFetch("/api/catalog/bodegas").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("salDestino");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione</option>';
    rows.forEach(function(b) {
      sel.innerHTML += '<option value="' + escHtml(b.id_bodega) + '">' + escHtml(b.nombre_bodega) + "</option>";
    });
  }).catch(function(e) { console.error("loadDestinos error:", e); });
}

on($("salAdd"), "click", function() {
  var producto = val($("salProducto")).trim();
  var cantidad = num(val($("salCantidad")));
  var precio = num(val($("salPrecio")));
  var obs = val($("salLineaObs"));

  if (!producto) { notify("Ingresa un producto", "warn"); return; }
  if (!cantidad || cantidad <= 0) { notify("Ingresa una cantidad valida", "warn"); return; }

  SALIDA_ITEMS.push({
    nombre_producto: producto,
    cantidad: cantidad,
    precio: precio,
    observacion: obs,
  });
  renderSalidaList();
  setVal($("salProducto"), "");
  setVal($("salCantidad"), "");
  setVal($("salPrecio"), "");
  setVal($("salLineaObs"), "");
  setVal($("salStock"), "");
});

function renderSalidaList() {
  var tbody = document.getElementById("salList");
  if (!tbody) return;
  if (!SALIDA_ITEMS.length) {
    tbody.innerHTML = "<tr><td colspan='5'>Sin productos</td></tr>";
    return;
  }
  tbody.innerHTML = SALIDA_ITEMS.map(function(item, i) {
    return "<tr><td>" + escHtml(item.nombre_producto) + "</td><td>" + fmtNum(item.cantidad) + "</td><td>" + fmtMoney(item.precio) + "</td><td>" + escHtml(item.observacion || "-") + '</td><td><button class="btn soft btn-sm salRemoveBtn" data-index="' + i + '" type="button">Eliminar</button></td></tr>';
  }).join("");
  tbody.querySelectorAll(".salRemoveBtn").forEach(function(btn) {
    on(btn, "click", function() {
      var idx = parseInt(btn.getAttribute("data-index"), 10);
      SALIDA_ITEMS.splice(idx, 1);
      renderSalidaList();
    });
  });
}

on($("salClear"), "click", function() {
  SALIDA_ITEMS = [];
  renderSalidaList();
});

on($("salSave"), "click", function() {
  var motivo = val($("salMotivo"));
  var destino = val($("salDestino"));
  var tipo = val($("salTipoMov"));
  var documento = val($("salDocumento"));
  var observacion = val($("salObservacion"));
  var fecha = val($("salFecha"));

  if (!motivo) { notify("Selecciona un motivo", "warn"); return; }
  if (!SALIDA_ITEMS.length) { notify("Agrega al menos un producto", "warn"); return; }

  var payload = {
    fecha: fecha,
    tipo_movimiento: tipo,
    id_motivo: motivo,
    id_bodega_destino: destino || null,
    no_documento: documento,
    observacion: observacion,
    lineas: SALIDA_ITEMS,
  };

  _apiFetch("/api/warehouse/salida", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, data: d }; });
  }).then(function(res) {
    if (!res.ok) throw new Error(res.data.error || "Error al guardar");
    notify("Salida guardada exitosamente", "ok");
    SALIDA_ITEMS = [];
    renderSalidaList();
  }).catch(function(e) {
    notify(e.message || "Error al guardar salida", "err");
  });
});

window.initSalidas = initSalidas;

console.log("salidas.js loaded");
})();