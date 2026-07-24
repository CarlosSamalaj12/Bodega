const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Solo las primeras 15 líneas
const content = fs.readFileSync('src/styles/abstracts/_variables.scss', 'utf8');
const lines = content.split('\n');
const first10 = lines.slice(0, 15).join('\n');
fs.writeFileSync(path.join(tmpDir, '_vars.scss'), first10);

fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
@use "vars" as v;
.x { color: v.$color-text; }
`);

try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK con 15 líneas');
} catch (e) { console.log('FAIL con 15 líneas:', e.message.slice(0, 100)); }

fs.rmSync(tmpDir, { recursive: true, force: true });
