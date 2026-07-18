// server-lib/ids.js  —  ID normalization, tokenized search filter, list utilities

function normalizeWarehouseIdList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((x) => Number(x || 0)).filter((x) => Number.isInteger(x) && x > 0)));
}

function buildNamedInClause(values, prefix) {
  const ids = normalizeWarehouseIdList(values);
  if (!ids.length) return { sql: "NULL", params: {}, ids };
  const params = {};
  const placeholders = ids.map((id, idx) => { const key = `${prefix}${idx}`; params[key] = id; return `:${key}`; });
  return { sql: placeholders.join(", "), params, ids };
}

function normalizeLogoData(value) {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (s.startsWith("data:image/") || s.startsWith("http")) return s;
  return null;
}

function isAvatarTableMissingError(e) {
  if (!e) return false;
  const msg = String(e.message || "").toLowerCase();
  return msg.includes("usuario_avatar") || msg.includes("unknown table") || msg.includes("doesn't exist");
}

function isWarehouseLogoTableMissingError(e) {
  if (!e) return false;
  const msg = String(e.message || "").toLowerCase();
  return msg.includes("bodega_logo") || msg.includes("unknown table") || msg.includes("doesn't exist");
}

function buildTokenizedLikeFilter(rawInput, columns = [], paramPrefix = "qtk") {
  const safeCols = Array.isArray(columns) ? columns.filter((c) => typeof c === "string" && c.trim()) : [];
  const raw = String(rawInput || "").trim();
  if (!raw || !safeCols.length) return { clause: "1=1", params: {}, hasTokens: false };
  const normalizeSearchToken = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00f1\u00d1]/g, "n").toLowerCase().trim();
  const normalizedSqlExpr = (col) => `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '\u00e1','a'), '\u00e9','e'), '\u00ed','i'), '\u00f3','o'), '\u00fa','u'), '\u00c1','a'), '\u00c9','e'), '\u00cd','i'), '\u00d3','o'), '\u00da','u'), '\u00f1','n'), '\u00d1','n'))`;
  const tokens = raw.split(/\s+/).map((t) => normalizeSearchToken(t)).filter(Boolean).slice(0, 8);
  if (!tokens.length) return { clause: "1=1", params: {}, hasTokens: false };
  const params = {};
  const groups = tokens.map((token, idx) => { const key = `${paramPrefix}${idx}`; params[key] = `%${token}%`; const orCols = safeCols.map((col) => `${normalizedSqlExpr(col)} LIKE :${key}`).join(" OR "); return `(${orCols})`; });
  return { clause: groups.join(" AND "), params, hasTokens: true };
}

export {
  normalizeWarehouseIdList, buildNamedInClause, normalizeLogoData,
  isAvatarTableMissingError, isWarehouseLogoTableMissingError,
  buildTokenizedLikeFilter,
};
