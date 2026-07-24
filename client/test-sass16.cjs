const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Solo las primeras 4 vars (sin comentarios)
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), `
$color-bg-0: var(--color-bg-0);
$color-bg-1: var(--color-bg-1);
$color-text: var(--color-text);
`);

fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
  @use "vars" as v;
  .x { color: v.$color-text; }
`);
try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK 3 vars:', r.css.trim());
} catch (e) { console.log('FAIL 3 vars:', e.message); }

// Ahora con 4 vars (incluye una con punto y coma al final)
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), `
$color-bg-0: var(--color-bg-0);
$color-bg-1: var(--color-bg-1);
$color-text: var(--color-text);
$color-accent: #6b8e7f;
`);

try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK 4 vars:', r.css.trim());
} catch (e) { console.log('FAIL 4 vars:', e.message); }

fs.rmSync(tmpDir, { recursive: true, force: true });
