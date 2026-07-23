(function(){
if (!window.BodegaShared) { console.error("despachar.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var $ = window.$;
var on = window.on;
var val = window.val;
var html = window.html;
var escHtml = window.escHtml;
var notify = window.notify;

function initDespachar() {
  loadPedidosPendientes();
}

function loadPedidosPendientes() {
  _apiFetch("/api/orders/pedidos?estado=PENDIENTE").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.getElementById("pedOrdersList");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='7'>Sin pedidos pendientes</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(p) {
      var badgeClass = p.estado === "PENDIENTE" ? "badge-warn" : "badge-ok";
      return "<tr><td>" + escHtml(p.id_pedido) + "</td><td>" + escHtml(p.solicitante || "-") + "</td><td>" + escHtml(p.nombre_bodega || "-") + '</td><td><span class="badge ' + badgeClass + '">' + escHtml(p.estado) + "</span></td><td>" + escHtml(p.tipo || "-") + "</td><td>" + escHtml(p.fecha || "") + '</td><td><button class="btn soft btn-sm despacharBtn" data-id="' + escHtml(p.id_pedido) + '" type="button">Despachar</button></td></tr>";
    }).join("");
    body.querySelectorAll(".despacharBtn").forEach(function(btn) {
      on(btn, "click", function() {
        despacharPedido(btn.getAttribute("data-id"));
      });
    });
  }).catch(function(e) { console.error("loadPedidosPendientes error:", e); });
}

function despacharPedido(idPedido) {
  _apiFetch("/api/orders/despachar/" + idPedido, { method: "POST" }).then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, data: d }; });
  }).then(function(res) {
    if (!res.ok) throw new Error(res.data.error || "Error al despachar");
    notify("Pedido despachado exitosamente", "ok");
    loadPedidosPendientes();
  }).catch(function(e) {
    notify(e.message || "Error al despachar", "err");
  });
}

on($("pedDispatchSearchBtn"), "click", function() {
  loadPedidosPendientes();
});

on($("pedDispatchRefresh"), "click", function() {
  loadPedidosPendientes();
});

window.initDespachar = initDespachar;

console.log("despachar.js loaded");
})();