// server-lib/dates.js  —  Date formatting and manipulation utilities

function ymd(value) { if (!value) return null; try { return new Date(value).toISOString().slice(0, 10); } catch { return null; } }

function dmy(value) { const s = ymd(value); if (!s) return ""; const [yyyy, mm, dd] = s.split("-"); return `${dd}-${mm}-${yyyy}`; }

function normalizeYmdInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) { const [dd, mm, yyyy] = raw.split("-"); return `${yyyy}-${mm}-${dd}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) { const [dd, mm, yyyy] = raw.split("/"); return `${yyyy}-${mm}-${dd}`; }
  return ymd(raw) || "";
}

function addDaysYmd(baseYmd, days) { const d = new Date(`${baseYmd}T00:00:00`); d.setDate(d.getDate() + Number(days || 0)); return d.toISOString().slice(0, 10); }

function onlyToday(dateTimeStr) { const d = new Date(dateTimeStr); const now = new Date(); return d.toDateString() === now.toDateString(); }

export { ymd, dmy, normalizeYmdInput };
