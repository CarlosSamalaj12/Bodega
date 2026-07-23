(function(){
if (!window.BodegaShared) { console.error("home.js: shared.js not loaded"); return; }

function initHomeDashboard() {
  if (window.loadHomeDashSummary) {
    window.loadHomeDashSummary();
  }
}

window.initHomeDashboard = initHomeDashboard;

console.log("home.js loaded");
})();