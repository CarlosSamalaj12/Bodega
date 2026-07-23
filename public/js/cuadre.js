(function(){
if (!window.BodegaShared) { console.error("cuadre.js: shared.js not loaded"); return; }

var _getToken = window.BodegaShared.getToken;
var _getUser = window.BodegaShared.getUser;
var _parseJwt = window.parseJwt;

function initApp() {
  if (!_getToken()) {
    window.location.href = "./login.html";
    return;
  }

  var payload = _parseJwt(_getToken());
  if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
    window.logout();
    return;
  }

  if (window.loadMyPermissions) {
    window.loadMyPermissions().then(function() {
      initModules();
    });
  } else {
    initModules();
  }
}

function initModules() {
  if (window.initHomeDashboard) {
    window.initHomeDashboard();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

console.log("cuadre.js loaded");
})();