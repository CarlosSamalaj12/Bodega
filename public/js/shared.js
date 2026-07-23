(function(){
var TOKEN_KEY = "bodega_jwt";
var USER_KEY = "bodega_user";
var API_BASE = "";

window.BodegaShared = {
  TOKEN_KEY: TOKEN_KEY,
  USER_KEY: USER_KEY,
  API_BASE: API_BASE,
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch(e) { return null; } }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function setUser(u) { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); }
function isLoggedIn() { return !!getToken(); }

window.BodegaShared.getToken = getToken;
window.BodegaShared.getUser = getUser;
window.BodegaShared.setToken = setToken;
window.BodegaShared.setUser = setUser;
window.BodegaShared.isLoggedIn = isLoggedIn;

var origFetch = window.fetch.bind(window);
function apiFetch(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  var token = getToken();
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (!opts.headers["Content-Type"] && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
  }
  var reqUrl = url.indexOf("://") === -1 ? API_BASE + url : url;
  return origFetch(reqUrl, opts);
}

function fetchWithTimeout(url, opts, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  opts = opts || {};
  return Promise.race([
    apiFetch(url, opts),
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("Timeout")); }, timeoutMs);
    }),
  ]);
}

window.fetch = apiFetch;
window.BodegaShared.apiFetch = apiFetch;
window.BodegaShared.fetchWithTimeout = fetchWithTimeout;

function $(id) { return document.getElementById(id); }
function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }
function val(el) { return el ? el.value : ""; }
function setVal(el, v) { if (el) { el.value = v; } }
function html(el, h) { if (el) el.innerHTML = h; }
function text(el, t) { if (el) el.textContent = t; }
function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
function closest(el, sel) { return el ? el.closest(sel) : null; }

function num(v) {
  if (v === null || typeof v === "undefined" || v === "") return 0;
  var n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString("es-GT", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtMoney(v) {
  return "Q" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function escHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function timeStr() {
  var d = new Date();
  return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}

function nowISO() { return new Date().toISOString(); }

function parseJwt(token) {
  try {
    var parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch(e) { return null; }
}

function logout() {
  setToken(null);
  setUser(null);
  window.location.href = "./login.html";
}

function handleApiError(res) {
  if (res.status === 401) { logout(); return null; }
  return res.json().catch(function(){ return { error: "Error " + res.status }; });
}

function notify(msg, type) {
  type = type || "info";
  var el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.classList.add("show"); }, 10);
  setTimeout(function() { el.classList.remove("show"); setTimeout(function() { el.remove(); }, 300); }, 4000);
}

function confirmar(msg) {
  return new Promise(function(resolve) {
    if (window.confirm(msg)) resolve(true);
    else resolve(false);
  });
}

window.$ = $;
window.qs = qs;
window.qsa = qsa;
window.show = show;
window.hide = hide;
window.val = val;
window.setVal = setVal;
window.html = html;
window.text = text;
window.on = on;
window.closest = closest;
window.num = num;
window.fmtNum = fmtNum;
window.fmtMoney = fmtMoney;
window.escHtml = escHtml;
window.todayStr = todayStr;
window.timeStr = timeStr;
window.nowISO = nowISO;
window.parseJwt = parseJwt;
window.logout = logout;
window.handleApiError = handleApiError;
window.notify = notify;
window.confirmar = confirmar;
window.getToken = getToken;
window.getUser = getUser;
window.setToken = setToken;
window.setUser = setUser;
window.isLoggedIn = isLoggedIn;
window.fetchWithTimeout = fetchWithTimeout;

console.log("shared.js loaded");
})();