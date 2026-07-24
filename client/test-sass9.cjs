const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Copio el contenido literal del _variables.scss pero reducido
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), `
// Design Tokens
$color-bg-0: var(--color-bg-0);
$color-text: var(--color-text);
$color-accent: #6b8e7f;
`);

fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
@use "vars" as v;
.x { color: v.$color-text; }
`);

try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK:', r.css);
} catch (e) { console.log('FAIL:', e.message); }

fs.rmSync(tmpDir, { recursive: true, force: true });
