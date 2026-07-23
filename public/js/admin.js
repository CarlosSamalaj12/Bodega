(function(){
if (!window.BodegaShared) { console.error("admin.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var $ = window.$;
var on = window.on;
var val = window.val;
var setVal = window.setVal;
var html = window.html;
var show = window.show;
var hide = window.hide;
var escHtml = window.escHtml;
var notify = window.notify;
var fmtNum = window.fmtNum;

function initAdmin(sectionId) {
  switch (sectionId) {
    case "categorias": initCategorias(); break;
    case "subcategorias": initSubcategorias(); break;
    case "motivos-movimiento": initMotivos(); break;
    case "proveedores": initProveedores(); break;
    case "productos": initProductos(); break;
    case "limites": initLimites(); break;
    case "reglas-subcategorias": initReglasSubcategorias(); break;
    case "usuarios": initUsuarios(); break;
    case "bodegas": initBodegas(); break;
    default: break;
  }
}

function initCategorias() {
  loadCategorias();
}

function loadCategorias() {
  _apiFetch("/api/catalog/categorias").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-categorias .wizListBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div class="wizListEmpty">Sin categorias</div>';
      return;
    }
    body.innerHTML = rows.map(function(c) {
      return '<div class="wizListItem" data-id="' + c.id_categoria + '"><span>' + escHtml(c.nombre_categoria) + '</span><span class="note">' + (c.activo ? "Activo" : "Inactivo") + "</span></div>";
    }).join("");
  }).catch(function(e) { console.error("loadCategorias error:", e); });
}

function initSubcategorias() {
  _apiFetch("/api/catalog/subcategorias").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.getElementById("subCatManageList");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = "<tr><td colspan='5'>Sin subcategorias</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function(s) {
      return "<tr><td>" + escHtml(s.id_subcategoria) + "</td><td>" + escHtml(s.nombre_categoria || "") + "</td><td>" + escHtml(s.nombre_subcategoria) + "</td><td>" + (s.activo ? "Si" : "No") + '</td><td><button class="btn soft btn-sm" type="button">Editar</button></td></tr>';
    }).join("");
  }).catch(function(e) { console.error("initSubcategorias error:", e); });
}

function initMotivos() {
  _apiFetch("/api/catalog/motivos").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-motivos-movimiento .wizListBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div class="wizListEmpty">Sin motivos</div>';
      return;
    }
    body.innerHTML = rows.map(function(m) {
      return '<div class="wizListItem"><span>' + escHtml(m.nombre_motivo) + '</span><span class="note">' + escHtml(m.tipo_movimiento || "") + " | " + (m.activo ? "Activo" : "Inactivo") + "</span></div>";
    }).join("");
  }).catch(function(e) { console.error("initMotivos error:", e); });
}

function initProveedores() {
  _apiFetch("/api/catalog/proveedores").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-proveedores .wizListBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div class="wizListEmpty">Sin proveedores</div>';
      return;
    }
    body.innerHTML = rows.map(function(p) {
      return '<div class="wizListItem"><span>' + escHtml(p.nombre_proveedor) + '</span><span class="note">' + escHtml(p.telefono || "") + " | " + (p.activo ? "Activo" : "Inactivo") + "</span></div>";
    }).join("");
  }).catch(function(e) { console.error("initProveedores error:", e); });
}

function initProductos() {
  loadProductos();
}

function loadProductos(q) {
  var url = "/api/catalog/productos?limit=200";
  if (q) url += "&q=" + encodeURIComponent(q);
  _apiFetch(url).then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-productos .wizListBody");
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div class="wizListEmpty">Sin productos</div>';
      return;
    }
    body.innerHTML = rows.map(function(p) {
      return '<div class="wizListItem" data-id="' + p.id_producto + '"><span>' + escHtml(p.nombre_producto) + '</span><span class="note">' + escHtml(p.sku || "") + " | " + fmtNum(p.stock || 0) + " uds</span></div>";
    }).join("");
  }).catch(function(e) { console.error("loadProductos error:", e); });
}

function initLimites() {
  _apiFetch("/api/catalog/limites?limit=200").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-limites tbody");
    if (body) {
      if (!rows.length) {
        body.innerHTML = "<tr><td colspan='5'>Sin limites configurados</td></tr>";
        return;
      }
      body.innerHTML = rows.map(function(l) {
        return "<tr><td>" + escHtml(l.nombre_bodega || "") + "</td><td>" + escHtml(l.nombre_producto) + "</td><td>" + fmtNum(l.minimo || 0) + "</td><td>" + fmtNum(l.maximo || 0) + "</td><td>" + (l.activo ? "Activo" : "Inactivo") + "</td></tr>";
      }).join("");
    }
  }).catch(function(e) { console.error("initLimites error:", e); });
}

function initReglasSubcategorias() {
  _apiFetch("/api/catalog/reglas-subcategorias").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    console.log("Reglas subcategorias:", data);
  }).catch(function(e) { console.error("initReglasSubcategorias error:", e); });
}

function initUsuarios() {
  _apiFetch("/api/admin/usuarios").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-usuarios tbody");
    if (body) {
      if (!rows.length) {
        body.innerHTML = "<tr><td colspan='5'>Sin usuarios</td></tr>";
        return;
      }
      body.innerHTML = rows.map(function(u) {
        return "<tr><td>" + escHtml(u.nombre_usuario || u.email) + "</td><td>" + escHtml(u.nombre_rol || "") + "</td><td>" + escHtml(u.nombre_bodega || "") + "</td><td>" + (u.activo ? "Activo" : "Inactivo") + '</td><td><button class="btn soft btn-sm" type="button">Editar</button></td></tr>';
      }).join("");
    }
  }).catch(function(e) { console.error("initUsuarios error:", e); });
}

function initBodegas() {
  _apiFetch("/api/catalog/bodegas").then(function(r) {
    if (!r.ok) return [];
    return r.json();
  }).then(function(data) {
    var rows = data.rows || data || [];
    var body = document.querySelector("#view-bodegas tbody");
    if (body) {
      if (!rows.length) {
        body.innerHTML = "<tr><td colspan='4'>Sin bodegas</td></tr>";
        return;
      }
      body.innerHTML = rows.map(function(b) {
        return "<tr><td>" + escHtml(b.nombre_bodega) + "</td><td>" + escHtml(b.tipo_bodega || "") + "</td><td>" + (b.activo ? "Activo" : "Inactivo") + '</td><td><button class="btn soft btn-sm" type="button">Editar</button></td></tr>';
      }).join("");
    }
  }).catch(function(e) { console.error("initBodegas error:", e); });
}

window.initAdmin = initAdmin;

console.log("admin.js loaded");
})();