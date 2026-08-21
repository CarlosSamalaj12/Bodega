import { generateSKU, generateSKUForced } from './client/src/utils/skuGenerator.js';

function show(label, fn) {
  console.log(label);
  for (let i = 0; i < 3; i++) {
    process.stdout.write('  ' + fn() + '\n');
  }
}

show('Sin categoría:', () => generateSKU());
show('Categoría "Abarrotes":', () => generateSKU('Abarrotes'));
show('Categoría "Lácteos":', () => generateSKU('Lácteos'));
show('Categoría con acentos "Cárnicos y Embutidos":', () => generateSKU('Cárnicos y Embutidos'));
show('Categoría con símbolos "Frutas/Verduras #1":', () => generateSKU('Frutas/Verduras #1'));
show('Sin letras "!!!":', () => generateSKU('!!!'));
show('null:', () => generateSKU(null));

console.log('\nCon existingSkus:');
const taken = new Set(['PRD-A1B2', 'PRD-A1B3']);
for (let i = 0; i < 5; i++) {
  process.stdout.write('  ' + generateSKU('Productos', taken) + '\n');
}

console.log('\nForced:');
for (let i = 0; i < 3; i++) {
  process.stdout.write('  ' + generateSKUForced('Harinas') + '\n');
}
