const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const content = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const lines = content.split('\n');

// Copiar hasta la línea 13 (que es $color-stroke-focus)
const test = lines.slice(0, 13).join('\n');
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), test);
fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
  @use "vars" as v;
  .x { color: v.$color-text; }
`);
try {
  sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK con 13 líneas');
} catch (e) { console.log('FAIL con 13:', e.message.split('\n').slice(0,3).join(' | ')); }

console.log('---CONTENIDO---');
console.log(test);

fs.rmSync(tmpDir, { recursive: true, force: true });
