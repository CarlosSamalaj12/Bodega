const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Comparar: un archivo que funciona y el real
const workingContent = `
$color-bg-0: var(--color-bg-0);
$color-bg-1: var(--color-bg-1);
$color-text: var(--color-text);
$color-accent: #6b8e7f;
`;

const realContent = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const realFirstFew = realContent.split('\n').slice(0, 12).join('\n');

console.log('=== WORKING ===');
console.log(JSON.stringify(workingContent));
console.log('=== REAL first 12 lines ===');
console.log(JSON.stringify(realFirstFew));

// Probar con el real
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), realFirstFew);
fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
  @use "vars" as v;
  .x { color: v.$color-text; }
`);
try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('REAL 12 lines OK:', r.css.trim());
} catch (e) { console.log('REAL 12 lines FAIL:', e.message); }

fs.rmSync(tmpDir, { recursive: true, force: true });
