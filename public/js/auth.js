(function(){
if (!window.BodegaShared) { console.error("auth.js: shared.js not loaded"); return; }

var _getToken = window.BodegaShared.getToken;
var _setToken = window.BodegaShared.setToken;
var _setUser = window.BodegaShared.setUser;
var _getUser = window.BodegaShared.getUser;
var _apiFetch = window.BodegaShared.apiFetch;
var _parseJwt = window.parseJwt;

function checkSession() {
  var token = _getToken();
  if (!token) {
    window.location.href = "./login.html";
    return null;
  }
  var payload = _parseJwt(token);
  if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
    _setToken(null);
    _setUser(null);
    window.location.href = "./login.html";
    return null;
  }
  return payload;
}

function refreshUser() {
  return _apiFetch("/api/me/profile").then(function(r) {
    if (!r.ok) throw new Error("No se pudo cargar perfil");
    return r.json();
  }).then(function(data) {
    if (data.user) _setUser(data.user);
    return data.user;
  }).catch(function(e) {
    console.error("refreshUser error:", e);
    return null;
  });
}

window.authCheck = checkSession;
window.authRefresh = refreshUser;

console.log("auth.js loaded");
})();