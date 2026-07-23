(function(){
if (!window.BodegaShared) { console.error("navigation.js: shared.js not loaded"); return; }

var _apiFetch = window.BodegaShared.apiFetch;
var _fetchWithTimeout = window.BodegaShared.fetchWithTimeout;
var $ = window.$;
var qs = window.qs;
var qsa = window.qsa;
var show = window.show;
var hide = window.hide;
var text = window.text;
var html = window.html;
var on = window.on;
var escHtml = window.escHtml;
var fmtNum = window.fmtNum;
var fmtMoney = window.fmtMoney;
var num = window.num;
var val = window.val;
var setVal = window.setVal;
var getUser = window.BodegaShared.getUser;
var notify = window.notify;
var todayStr = window.todayStr;

var CURRENT_SECTION = "home";
var PERMISOS = {};
var USER_SCOPE = null;
var DASHBOARD_PARAMS = { days: 30, mov_days: 30 };
var DASHBOARD_CACHE = {};
var HOME_DASH_KIND = "vigentes";

window.__NAV = {
  CURRENT_SECTION: CURRENT_SECTION,
  PERMISOS: PERMISOS,
  USER_SCOPE: USER_SCOPE,
};

function hasPerm(key) {
  return PERMISOS && PERMISOS[key] === 1;
}

function loadMyPermissions() {
  return _apiFetch("/api/me/permisos").then(function(r) {
    if (r.status === 401) { window.logout(); return null; }
    if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || "Error permisos"); });
    return r.json();
  }).then(function(data) {
    if (!data) return;
    PERMISOS = data.permisos || {};
    window.__NAV.PERMISOS = PERMISOS;
    if (data.is_admin_role !== undefined) {
      window.__NAV.is_admin_role = data.is_admin_role;
    }
    if (data.catalogo) window.__NAV.PERM_CATALOG = data.catalogo;
    initPermissionsUI();
    return data;
  }).catch(function(e) {
    console.error("loadMyPermissions error:", e);
  });
}

function initPermissionsUI() {
  var user = getUser();
  if (user) {
    var nameEl = document.getElementById("meName");
    if (nameEl) nameEl.textContent = (user.nombre_completo || user.nombre_usuario || user.email || "").trim() || "Usuario";
  }

  var hasHome = hasPerm("section.view.home");
  var sectionBtns = qsa("[data-section]");
  for (var i = 0; i < sectionBtns.length; i++) {
    var btn = sectionBtns[i];
    var sec = btn.getAttribute("data-section");
    var permKey = sectionToPermission(sec);
    if (!permKey) { show(btn); continue; }
    if (hasPerm(permKey)) {
      show(btn);
    } else {
      hide(btn);
    }
  }

  var groups = qsa("[data-menu-group]");
  for (var j = 0; j < groups.length; j++) {
    var group = groups[j];
    var groupKey = group.getAttribute("data-menu-group");
    var visible = hasGroupPermission(groupKey);
    if (visible) show(group); else hide(group);
  }

  if (hasHome || !hasPerm("section.view.home")) {
    showSection("home");
  } else {
    var firstBtn = qs("[data-section]:not(.hidden)");
    if (firstBtn) showSection(firstBtn.getAttribute("data-section"));
  }
}

function sectionToPermission(sec) {
  var map = {
    "home": "section.view.home",
    "entradas": "section.view.entradas",
    "salidas": "section.view.salidas",
    "ajustes": "section.view.ajustes",
    "pedidos": "section.view.pedidos",
    "pedidos-despachar": "section.view.pedidos-despachar",
    "cuadre-caja": "section.view.cuadre-caja",
    "categorias": "section.view.categorias",
    "subcategorias": "section.view.subcategorias",
    "motivos-movimiento": "section.view.motivos-movimiento",
    "proveedores": "section.view.proveedores",
    "productos": "section.view.productos",
    "limites": "section.view.limites",
    "reglas-subcategorias": "section.view.reglas-subcategorias",
    "usuarios": "section.view.usuarios",
    "bodegas": "section.view.bodegas",
    "r-existencias": "section.view.r-existencias",
    "r-corte-diario": "section.view.r-corte-diario",
    "r-entradas": "section.view.r-entradas",
    "r-salidas": "section.view.r-salidas",
    "r-pedidos": "section.view.r-pedidos",
    "r-transferencias": "section.view.r-transferencias",
    "r-auditoria-sensibles": "section.view.r-auditoria-sensibles",
    "r-cuadres-caja": "section.view.r-corte-diario",
    "r-tendencia-producto": "section.view.r-salidas",
  };
  return map[sec] || null;
}

function hasGroupPermission(groupKey) {
  var permMap = {
    "movimientos": ["section.view.entradas", "section.view.salidas", "section.view.ajustes", "section.view.pedidos", "section.view.pedidos-despachar", "section.view.cuadre-caja"],
    "reportes": ["section.view.r-existencias", "section.view.r-corte-diario", "section.view.r-entradas", "section.view.r-salidas", "section.view.r-pedidos", "section.view.r-transferencias", "section.view.r-auditoria-sensibles"],
    "agregar": ["section.view.categorias", "section.view.subcategorias", "section.view.motivos-movimiento", "section.view.proveedores", "section.view.productos", "section.view.limites", "section.view.reglas-subcategorias", "section.view.usuarios", "section.view.bodegas"],
  };
  var keys = permMap[groupKey] || [];
  for (var i = 0; i < keys.length; i++) {
    if (hasPerm(keys[i])) return true;
  }
  return false;
}

function showSection(sectionId) {
  if (!sectionId) return;
  CURRENT_SECTION = sectionId;
  window.__NAV.CURRENT_SECTION = sectionId;

  var views = qsa(".view");
  for (var i = 0; i < views.length; i++) {
    views[i].classList.add("hidden");
  }

  var target = document.getElementById("view-" + sectionId);
  if (target) target.classList.remove("hidden");

  var stageTitle = document.getElementById("stageTitle");
  if (stageTitle) {
    var labels = {
      "home": "Inicio",
      "entradas": "Entradas",
      "salidas": "Salidas",
      "ajustes": "Ajustes",
      "pedidos": "Realizar pedidos",
      "pedidos-despachar": "Pedidos x Despachar",
      "cuadre-caja": "Cuadre de caja",
      "categorias": "Categorias",
      "subcategorias": "Subcategorias",
      "motivos-movimiento": "Motivos de movimiento",
      "proveedores": "Proveedores",
      "productos": "Productos",
      "limites": "Minimos/Maximos",
      "reglas-subcategorias": "Reglas de subcategorias",
      "usuarios": "Usuarios",
      "bodegas": "Bodegas",
      "r-existencias": "Reporte de Existencias",
      "r-corte-diario": "Corte Diario",
      "r-entradas": "Reporte de Entradas",
      "r-salidas": "Reporte de Salidas",
      "r-pedidos": "Reporte de Pedidos",
      "r-transferencias": "Kardex",
      "r-auditoria-sensibles": "Auditoria sensible",
      "r-cuadres-caja": "Cuadres de caja",
      "r-tendencia-producto": "Tendencia de producto",
    };
    stageTitle.textContent = labels[sectionId] || sectionId;
  }

  var stageSub = document.getElementById("stageSub");
  if (stageSub) {
    stageSub.textContent = sectionId === "home" ? "Resumen general del inventario" : "";
  }

  var menu = document.querySelector(".menu");
  if (menu) menu.classList.remove("open");

  if (sectionId === "home") {
    initHomeDashboardSection();
  } else if (sectionId === "entradas") {
    if (window.initEntradas) window.initEntradas();
  } else if (sectionId === "salidas") {
    if (window.initSalidas) window.initSalidas();
  } else if (sectionId === "ajustes") {
    if (window.initAjustes) window.initAjustes();
  } else if (sectionId === "pedidos") {
    if (window.initPedidos) window.initPedidos();
  } else if (sectionId === "pedidos-despachar") {
    if (window.initDespachar) window.initDespachar();
  } else if (sectionId === "cuadre-caja") {
    if (window.initCuadreCaja) window.initCuadreCaja();
  } else if (sectionId.indexOf("r-") === 0) {
    if (window.initReportes) window.initReportes(sectionId);
  } else if (sectionId.indexOf("categorias") !== -1 || sectionId.indexOf("subcategorias") !== -1 || sectionId.indexOf("motivos") !== -1 || sectionId.indexOf("proveedores") !== -1 || sectionId.indexOf("productos") !== -1 || sectionId.indexOf("limites") !== -1 || sectionId.indexOf("reglas") !== -1 || sectionId.indexOf("usuarios") !== -1 || sectionId.indexOf("bodegas") !== -1) {
    if (window.initAdmin) window.initAdmin(sectionId);
  }

  closeMenu();
}

function closeMenu() {
  var menu = document.querySelector(".menu");
  if (menu) menu.classList.remove("open");
  var hamburger = document.getElementById("hamburgerBtn");
  if (hamburger) hamburger.classList.remove("open");
}

function toggleMenu() {
  var menu = document.querySelector(".menu");
  if (menu) menu.classList.toggle("open");
  var hamburger = document.getElementById("hamburgerBtn");
  if (hamburger) hamburger.classList.toggle("open");
}

function loadHomeDashSummary() {
  var scopeEl = document.getElementById("homeDashScope");
  if (scopeEl) scopeEl.textContent = "Cargando resumen...";

  _apiFetch("/api/dashboard/resumen?days=" + DASHBOARD_PARAMS.days + "&mov_days=" + DASHBOARD_PARAMS.mov_days).then(function(r) {
    if (!r.ok) throw new Error("Error al cargar resumen");
    return r.json();
  }).then(function(data) {
    renderDashboardSummary(data);
    DASHBOARD_CACHE.resumen = data;
    if (data.scope) {
      USER_SCOPE = data.scope;
      window.__NAV.USER_SCOPE = data.scope;
    }
    var cachedDetail = DASHBOARD_CACHE.detail;
    if (cachedDetail && cachedDetail.kind === HOME_DASH_KIND) {
      renderDashboardDetail(cachedDetail);
    } else {
      loadHomeDashDetail(HOME_DASH_KIND);
    }
  }).catch(function(e) {
    console.error("loadHomeDashSummary error:", e);
    if (scopeEl) scopeEl.textContent = "Error al cargar";
  });
}

function renderDashboardSummary(data) {
  if (!data || !data.resumen) return;
  var r = data.resumen;

  text($("homeCardVigentes"), fmtNum(r.productos_vigentes));
  text($("homeCardVencidos"), fmtNum(r.productos_vencidos));
  text($("homeCardProximos"), fmtNum(r.productos_proximos));
  text($("homeCardRotar"), fmtNum(r.productos_proximos));
  text($("homeCardBajoMinimo"), fmtNum(r.productos_bajo_minimo));
  text($("homeCardDinero"), fmtMoney(r.total_dinero));

  text($("homeCardVigentesQty"), "Cantidad: " + fmtNum(r.cantidad_vigente));
  text($("homeCardVencidosQty"), "Cantidad: " + fmtNum(r.cantidad_vencida));
  text($("homeCardProximosQty"), "Cantidad: " + fmtNum(r.cantidad_proxima));

  var entreMinimo = $("homeCardEntreMinimoIdeal");
  if (entreMinimo) entreMinimo.textContent = "Proximo a minimo: " + fmtNum(r.productos_proximo_minimo || 0);

  if (r.total_dinero !== undefined) {
    text($("homeCardDinero"), fmtMoney(r.total_dinero));
  }

  if (data.mas_movimiento) {
    text($("homeCardMasMov"), escHtml(data.mas_movimiento.nombre_producto || "-"));
    text($("homeCardMasMovQty"), "Mov: " + fmtNum(data.mas_movimiento.cantidad_movimiento));
  } else {
    text($("homeCardMasMov"), "Sin datos");
    text($("homeCardMasMovQty"), "Mov: 0");
  }

  if (data.menos_movimiento) {
    text($("homeCardMenosMov"), escHtml(data.menos_movimiento.nombre_producto || "-"));
    text($("homeCardMenosMovQty"), "Mov: " + fmtNum(data.menos_movimiento.cantidad_movimiento));
  } else {
    text($("homeCardMenosMov"), "Sin datos");
    text($("homeCardMenosMovQty"), "Mov: 0");
  }

  var scopeEl = document.getElementById("homeDashScope");
  if (scopeEl && data.scope) {
    var txt = data.scope.bodega_nombre || "Todas las bodegas";
    if (data.cache) {
      if (data.cache.warming) txt += " (generando...)";
      else if (data.cache.hit) txt += " (en cache)";
    }
    scopeEl.textContent = txt;
  }

  var refreshBtn = document.getElementById("homeDashRefresh");
  if (refreshBtn) refreshBtn.style.display = "";
}

function loadHomeDashDetail(kind) {
  HOME_DASH_KIND = kind || "vigentes";
  var titleEl = document.getElementById("homeDashDetailTitle");
  var labels = {
    vigentes: "Detalle: productos vigentes",
    vencidos: "Detalle: productos vencidos",
    proximos: "Detalle: productos proximos a vencer",
    rotar: "Detalle: productos por rotar",
    stock_minimo: "Detalle: control de stock minimo",
    mas_mov: "Detalle: mayor movimiento",
    menos_mov: "Detalle: menor movimiento",
  };
  if (titleEl) titleEl.textContent = labels[kind] || "Detalle";

  var metaEl = document.getElementById("homeDashDetailMeta");
  if (metaEl) metaEl.textContent = "Cargando...";

  _apiFetch("/api/dashboard/detalle?kind=" + encodeURIComponent(kind) + "&days=" + DASHBOARD_PARAMS.days + "&mov_days=" + DASHBOARD_PARAMS.mov_days + "&limit=300").then(function(r) {
    if (!r.ok) throw new Error("Error al cargar detalle");
    return r.json();
  }).then(function(data) {
    DASHBOARD_CACHE.detail = data;
    renderDashboardDetail(data);
  }).catch(function(e) {
    console.error("loadHomeDashDetail error:", e);
    if (metaEl) metaEl.textContent = "Error al cargar";
  });
}

function renderDashboardDetail(data) {
  if (!data || !data.rows) return;
  var rows = data.rows;
  var kind = data.kind || HOME_DASH_KIND;
  var headEl = document.getElementById("homeDashHead");
  var bodyEl = document.getElementById("homeDashBody");
  var metaEl = document.getElementById("homeDashDetailMeta");
  if (!headEl || !bodyEl) return;

  if (metaEl) metaEl.textContent = rows.length + " registros";

  if (kind === "stock_minimo") {
    headEl.innerHTML = "<tr><th>Bodega</th><th>Producto</th><th>SKU</th><th>Stock</th><th>Minimo</th><th>Maximo</th><th>Nivel</th></tr>";
    bodyEl.innerHTML = rows.map(function(r) {
      var levelClass = r.nivel_stock === "Bajo minimo" ? "bad" : "warn";
      return "<tr class='" + levelClass + "'><td>" + escHtml(r.nombre_bodega) + "</td><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.sku) + "</td><td>" + fmtNum(r.stock) + "</td><td>" + fmtNum(r.minimo_stock) + "</td><td>" + fmtNum(r.maximo_stock) + "</td><td>" + escHtml(r.nivel_stock) + "</td></tr>";
    }).join("");
  } else if (kind === "mas_mov" || kind === "menos_mov") {
    headEl.innerHTML = "<tr><th>Producto</th><th>SKU</th><th>Movimiento</th><th>Ultimo mov.</th><th>Stock actual</th></tr>";
    bodyEl.innerHTML = rows.map(function(r) {
      return "<tr><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.sku) + "</td><td>" + fmtNum(r.cantidad_movimiento) + "</td><td>" + escHtml(r.ultimo_movimiento || "-") + "</td><td>" + fmtNum(r.stock_actual) + "</td></tr>";
    }).join("");
  } else {
    headEl.innerHTML = "<tr><th>Bodega</th><th>Producto</th><th>SKU</th><th>Lote</th><th>Vencimiento</th><th>Dias</th><th>Stock</th><th>Costo U.</th><th>Total</th></tr>";
    bodyEl.innerHTML = rows.map(function(r) {
      var d = r.dias_para_vencer;
      var dayClass = d !== null && d <= 15 ? "bad" : d !== null && d <= 30 ? "warn" : "";
      var fecha = r.fecha_vencimiento || "S/C";
      return "<tr class='" + dayClass + "'><td>" + escHtml(r.nombre_bodega) + "</td><td>" + escHtml(r.nombre_producto) + "</td><td>" + escHtml(r.sku) + "</td><td>" + escHtml(r.lote || "-") + "</td><td>" + escHtml(fecha) + "</td><td>" + (d !== null ? d : "-") + "</td><td>" + fmtNum(r.stock) + "</td><td>" + fmtMoney(r.costo_unitario) + "</td><td>" + fmtMoney(r.total_linea) + "</td></tr>";
    }).join("");
  }
}

function initHomeDashboardSection() {
  loadHomeDashSummary();
}

var hamburgerBtn = document.getElementById("hamburgerBtn");
if (hamburgerBtn) {
  on(hamburgerBtn, "click", toggleMenu);
}

var menuCloseBtn = document.getElementById("menuCloseBtn");
if (menuCloseBtn) {
  on(menuCloseBtn, "click", closeMenu);
}

var menuBtns = qsa("[data-section]");
for (var i = 0; i < menuBtns.length; i++) {
  (function(btn) {
    on(btn, "click", function() {
      showSection(btn.getAttribute("data-section"));
    });
  })(menuBtns[i]);
}

var menuToggles = qsa("[data-menu-group-toggle]");
for (var j = 0; j < menuToggles.length; j++) {
  (function(toggle) {
    on(toggle, "click", function() {
      var group = toggle.closest("[data-menu-group]");
      if (group) {
        group.classList.toggle("is-collapsed");
        var expanded = toggle.getAttribute("aria-expanded") === "true" ? "false" : "true";
        toggle.setAttribute("aria-expanded", expanded);
      }
    });
  })(menuToggles[j]);
}

var logoutBtn = document.getElementById("logout");
if (logoutBtn) {
  on(logoutBtn, "click", function() {
    if (window.confirm("Cerrar sesion?")) window.logout();
  });
}

var homeDashCards = document.getElementById("homeDashCards");
if (homeDashCards) {
  on(homeDashCards, "click", function(e) {
    var card = closest(e.target, ".homeDashCard");
    if (card) {
      var kind = card.getAttribute("data-kind");
      if (kind) {
        loadHomeDashDetail(kind);
      }
    }
  });
}

var homeDashRefresh = document.getElementById("homeDashRefresh");
if (homeDashRefresh) {
  on(homeDashRefresh, "click", function() {
    DASHBOARD_CACHE = {};
    loadHomeDashSummary();
  });
}

window.loadMyPermissions = loadMyPermissions;
window.initPermissionsUI = initPermissionsUI;
window.showSection = showSection;
window.loadHomeDashSummary = loadHomeDashSummary;
window.loadHomeDashDetail = loadHomeDashDetail;
window.hasPerm = hasPerm;

console.log("navigation.js loaded");
})();