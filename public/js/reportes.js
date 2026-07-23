(function(){
if (!window.BodegaShared) { console.error("reportes.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var $ = window.$;
var on = window.on;
var val = window.val;
var setVal = window.setVal;
var html = window.html;
var escHtml = window.escHtml;
var fmtNum = window.fmtNum;
var fmtMoney = window.fmtMoney;
var todayStr = window.todayStr;
var num = window.num;
var notify = window.notify;

var ACTIVE_REPORT = null;

function initReportes(sectionId) {
  ACTIVE_REPORT = sectionId;
  switch (sectionId) {
    case "r-existencias": loadReporteExistencias(); break;
    case "r-corte-diario": initCorteDiario(); break;
    case "r-entradas": loadReporteMovimientos("entradas"); break;
    case "r-salidas": loadReporteMovimientos("salidas"); break;
    case "r-pedidos": loadReportePedidos(); break;
    case "r-transferencias": loadReporteKardex(); break;
    case "r-auditoria-sensibles": loadAuditoriaSensibles(); break;
    case "r-cuadres-caja": loadCuadresCaja(); break;
    case "r-tendencia-producto": loadTendenciaProducto(); break;
    default: break;
  }
}

function loadReporteExistencias() {
  _apiFetch("/api/reportes/existencias?limit=500").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-existencias tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='6'>Sin datos</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(r) {
      var d = r.dias_para_vencer;
      return "<tr><td>" + escHtml(r.nombre_bodega) + "</td><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.sku) + "</td><td>" + escHtml(r.lote || "-") + "</td><td>" + (d !== null ? d : "-") + "</td><td>" + fmtNum(r.stock) + "</td></tr>";
    }).join("");
  }).catch(function(e) { console.error("loadReporteExistencias error:", e); });
}

function initCorteDiario() {
  _apiFetch("/api/reportes/corte-diario").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    console.log("Corte diario data:", data);
  }).catch(function(e) { console.error("initCorteDiario error:", e); });
}

function loadReporteMovimientos(tipo) {
  _apiFetch("/api/reportes/" + tipo + "?limit=200").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var viewId = tipo === "entradas" ? "r-entradas" : "r-salidas";
    var body = document.querySelector("#view-" + viewId + " tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='6'>Sin datos</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(r) {
      return "<tr><td>" + escHtml(r.fecha || "") + "</td><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.nombre_motivo || "") + "</td><td>" + fmtNum(r.cantidad) + "</td><td>" + fmtMoney(r.costo_unitario || 0) + "</td><td>" + fmtMoney(r.total || 0) + "</td></tr>";
    }).join("");
  }).catch(function(e) { console.error("loadReporteMovimientos error:", e); });
}

function loadReportePedidos() {
  _apiFetch("/api/reportes/pedidos?limit=200").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-pedidos tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='5'>Sin datos</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(r) {
      return "<tr><td>" + escHtml(r.id_pedido) + "</td><td>" + escHtml(r.solicitante || "") + "</td><td>" + escHtml(r.nombre_bodega || "") + "</td><td>" + escHtml(r.estado || "") + "</td><td>" + escHtml(r.fecha || "") + "</td></tr>";
    }).join("");
  }).catch(function(e) { console.error("loadReportePedidos error:", e); });
}

function loadReporteKardex() {
  _apiFetch("/api/reportes/kardex?limit=300").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-transferencias tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='6'>Sin datos</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(r) {
      return "<tr><td>" + escHtml(r.fecha || "") + "</td><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.tipo_movimiento || "") + "</td><td>" + fmtNum(r.delta_cantidad) + "</td><td>" + fmtMoney(r.costo_unitario || 0) + "</td><td>" + fmtNum(r.stock_resultante || 0) + "</td></tr>";
    }).join("");
  }).catch(function(e) { console.error("loadReporteKardex error:", e); });
}

function loadAuditoriaSensibles() {
  _apiFetch("/api/reportes/auditoria-sensible?limit=100").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-auditoria-sensibles tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='4'>Sin datos</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(r) {
      return "<tr><td>" + escHtml(r.fecha || "") + "</td><td>" + escHtml(r.accion || "") + "</td><td>" + escHtml(r.usuario || "") + "</td><td>" + escHtml(r.detalle || "") + "</td></tr>";
    }).join("");
  }).catch(function(e) { console.error("loadAuditoriaSensibles error:", e); });
}

function loadCuadresCaja() {
  _apiFetch("/api/reportes/cuadres-caja?limit=50").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-cuadres-caja tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='5'>Sin datos</td></tr>";
      return;
    }
  }).catch(function(e) { console.error("loadCuadresCaja error:", e); });
}

function loadTendenciaProducto() {
  _apiFetch("/api/reportes/tendencia-producto?limit=50").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(rows) {
    var body = document.querySelector("#view-r-tendencia-producto tbody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = "<tr><td colspan='4'>Sin datos</td></tr>";
      return;
    }
  }).catch(function(e) { console.error("loadTendenciaProducto error:", e); });
}

window.initReportes = initReportes;

console.log("reportes.js loaded");
})();