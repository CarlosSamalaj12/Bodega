const fs = require('fs');
const path = require('path');

function findBundle(prefix) {
  const dir = 'client/dist/assets';
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.js'));
  if (!files.length) return null;
  return path.join(dir, files[0]);
}

const ent = findBundle('ReporteEntradasPage-');
const sal = findBundle('ReporteSalidasPage-');
const entSrc = fs.readFileSync(ent, 'utf8');
const salSrc = fs.readFileSync(sal, 'utf8');

// Extract thead: from '<thead' to '</thead>'
function extractThead(src) {
  const i = src.indexOf('`thead`');
  if (i < 0) return 'NO TH';
  return src.slice(i, i + 1200).replace(/\s+/g, ' ');
}

// Extract tbody parent row: from 'flatMap' + 'parentRow' area
function extractParentRow(src, helper) {
  // find the row: starts near "mov-row`"
  const i = src.indexOf('mov-row`');
  if (i < 0) return 'NO ROW';
  return src.slice(i, i + 1600).replace(/\s+/g, ' ');
}

console.log('=== ENTRADAS thead+row ===');
console.log(extractThead(entSrc));
console.log();
console.log(extractParentRow(entSrc, 'Se'));

console.log('\n=== SALIDAS thead+row ===');
console.log(extractThead(salSrc));
console.log();
console.log(extractParentRow(salSrc, 'Ee'));
