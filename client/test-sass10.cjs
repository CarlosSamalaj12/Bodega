const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Copio el _variables.scss completo
fs.copyFileSync('src/styles/abstracts/_variables.scss', path.join(tmpDir, '_vars.scss'));

fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
@use "vars" as v;
.x { color: v.$color-text; }
`);

try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK:', r.css);
} catch (e) { console.log('FAIL:', e.message); }

fs.rmSync(tmpDir, { recursive: true, force: true });
