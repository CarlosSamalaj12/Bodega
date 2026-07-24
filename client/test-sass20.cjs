const sass = require('sass');
const path = require('path');
const fs = require('fs');

const tmpDir = path.resolve('test-tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Copia literal
fs.copyFileSync('src/styles/abstracts/_variables.scss', path.join(tmpDir, '_vars.scss'));

const varsContent = fs.readFileSync(path.join(tmpDir, '_vars.scss'), 'utf8');
const lines = varsContent.split('\n');
const colorTextLine = lines.findIndex(l => l.includes('$color-text:'));
console.log(`$color-text está en línea ${colorTextLine + 1}: ${lines[colorTextLine]}`);
console.log(`Total líneas: ${lines.length}`);
console.log(`Primeras 5 líneas:`);
for (let i = 0; i < 5; i++) console.log(`  ${i+1}: ${JSON.stringify(lines[i])}`);

fs.writeFileSync(path.join(tmpDir, 'main.scss'), `
  @use "vars" as v;
  .x { color: v.$color-text; }
`);
try {
  const r = sass.compile(path.join(tmpDir, 'main.scss'), { loadPaths: [tmpDir] });
  console.log('OK:', r.css.trim());
} catch (e) { console.log('FAIL:', e.message); }

fs.rmSync(tmpDir, { recursive: true, force: true });
