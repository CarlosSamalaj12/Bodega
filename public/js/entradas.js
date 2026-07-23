(function(){
if (!window.BodegaShared) { console.error("entradas.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var $ = window.$;
var on = window.on;
var val = window.val;
var setVal = window.setVal;
var html = window.html;
var text = window.text;
var show = window.show;
var hide = window.hide;
var escHtml = window.escHtml;
var fmtNum = window.fmtNum;
var fmtMoney = window.fmtMoney;
var todayStr = window.todayStr;
var timeStr = window.timeStr;
var num = window.num;
var notify = window.notify;

var ENTRADA_ITEMS = [];

function initEntradas() {
  setVal($("entFecha"), todayStr());
  setVal($("entHora"), timeStr());

  var user = window.getUser();
  if (user && user.nombre_usuario) {
    setVal($("entBodega"), user.id_warehouse || "");
  }

  loadMotivos();
  loadProveedores();
  renderEntradaList();
}

function loadMotivos() {
  _apiFetch("/api/catalog/motivos?tipo=ENTRADA").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("entMotivo");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione</option>';
    rows.forEach(function(m) {
      sel.innerHTML += '<option value="' + escHtml(m.id_motivo) + '">' + escHtml(m.nombre_motivo) + "</option>";
    });
  }).catch(function(e) { console.error("loadMotivos error:", e); });
}

function loadProveedores() {
  _apiFetch("/api/catalog/proveedores").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var sel = document.getElementById("entProveedor");
    if (!sel) return;
    sel.innerHTML = '<option value="">Seleccione proveedor</option>';
    rows.forEach(function(p) {
      sel.innerHTML += '<option value="' + escHtml(p.id_proveedor) + '">' + escHtml(p.nombre_proveedor) + "</option>";
    });
  }).catch(function(e) { console.error("loadProveedores error:", e); });
}

function renderEntradaList() {
  var tbody = document.getElementById("entList");
  if (!tbody) return;
  if (!ENTRADA_ITEMS.length) {
    tbody.innerHTML = "<tr><td colspan='7'>Sin productos</td></tr>";
    return;
  }
  tbody.innerHTML = ENTRADA_ITEMS.map(function(item, i) {
    return "<tr><td>" + escHtml(item.nombre_producto) + "</td><td>" + escHtml(item.lote || "-") + "</td><td>" + escHtml(item.caducidad || "-") + "</td><td>" + fmtNum(item.cantidad) + "</td><td>" + fmtMoney(item.precio) + "</td><td>" + fmtMoney(item.cantidad * item.precio) + '</td><td><button class="btn soft btn-sm entRemoveBtn" data-index="' + i + '" type="button">Eliminar</button></td></tr>';
  }).join("");

  tbody.querySelectorAll(".entRemoveBtn").forEach(function(btn) {
    on(btn, "click", function() {
      var idx = parseInt(btn.getAttribute("data-index"), 10);
      ENTRADA_ITEMS.splice(idx, 1);
      renderEntradaList();
    });
  });
}

on($("entAdd"), "click", function() {
  var producto = val($("entProducto")).trim();
  var lote = val($("entLote")).trim();
  var caducidad = val($("entCaducidad"));
  var cantidad = num(val($("entCantidad")));
  var precio = num(val($("entPrecio")));

  if (!producto) { notify("Ingresa un producto", "warn"); return; }
  if (!cantidad || cantidad <= 0) { notify("Ingresa una cantidad valida", "warn"); return; }

  ENTRADA_ITEMS.push({
    nombre_producto: producto,
    lote: lote,
    caducidad: caducidad,
    cantidad: cantidad,
    precio: precio,
  });
  renderEntradaList();

  setVal($("entProducto"), "");
  setVal($("entLote"), "");
  setVal($("entCaducidad"), "");
  setVal($("entCantidad"), "");
  setVal($("entPrecio"), "");
  setVal($("entStock"), "");
  setVal($("entTotal"), "");
});

on($("entClear"), "click", function() {
  ENTRADA_ITEMS = [];
  renderEntradaList();
});

on($("entSave"), "click", function() {
  var motivo = val($("entMotivo"));
  var pagado = val($("entPagado"));
  var documento = val($("entDocumento"));
  var proveedor = val($("entProveedor"));
  var observacion = val($("entObservacion"));
  var fecha = val($("entFecha"));

  if (!motivo) { notify("Selecciona un motivo", "warn"); return; }
  if (!ENTRADA_ITEMS.length) { notify("Agrega al menos un producto", "warn"); return; }

  var payload = {
    fecha: fecha,
    id_motivo: motivo,
    pagado: pagado === "Si",
    no_documento: documento,
    id_proveedor: proveedor || null,
    observacion: observacion,
    lineas: ENTRADA_ITEMS,
  };

  _apiFetch("/api/warehouse/entrada", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, data: d }; });
  }).then(function(res) {
    if (!res.ok) throw new Error(res.data.error || "Error al guardar");
    notify("Entrada guardada exitosamente", "ok");
    ENTRADA_ITEMS = [];
    renderEntradaList();
  }).catch(function(e) {
    notify(e.message || "Error al guardar entrada", "err");
  });
});

window.initEntradas = initEntradas;

console.log("entradas.js loaded");
})();