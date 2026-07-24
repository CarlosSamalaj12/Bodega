const sass = require('sass');
const path = require('path');

// Crear un archivo de prueba aislado
const fs = require('fs');
const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// _test.scss
fs.writeFileSync(path.join(tmpDir, '_test.scss'), `
$mi-var: red;
$otra-var: blue;
`);

// test.scss
fs.writeFileSync(path.join(tmpDir, 'test.scss'), `
@use "test" as t;
.x { color: t.$mi-var; }
.y { background: t.$otra-var; }
`);

try {
  const r = sass.compile(path.join(tmpDir, 'test.scss'));
  console.log('TEST OK:', r.css);
} catch (e) { console.log('TEST FAIL:', e.message); }

// Limpiar
fs.rmSync(tmpDir, { recursive: true, force: true });
