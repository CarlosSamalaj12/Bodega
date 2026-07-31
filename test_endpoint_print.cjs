// Test: hace un fetch real al endpoint /api/print/corte-diario con ?fecha=...
// para ver qué HTML devuelve y si la fecha del encabezado es la correcta.
require('dotenv/config');
const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 3000, // ajustar si tu server usa otro puerto
  path: '/api/print/corte-diario?fecha=2026-07-27',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + (process.env.TEST_TOKEN || ''),
  },
};

console.log('Probando:', `http://${options.hostname}:${options.port}${options.path}\n`);

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    // Buscar la línea que muestra la fecha
    const match = body.match(/Fecha del corte:[^<]*<b>([^<]+)<\/b>([^<]*)/);
    if (match) {
      console.log('\n[Encabezado encontrado]');
      console.log('Fecha mostrada:', JSON.stringify(match[1]));
      console.log('Etiqueta:', JSON.stringify(match[2]));
    } else {
      console.log('\n[NO se encontró "Fecha del corte" en el HTML]');
      console.log('Primeros 500 chars del HTML:');
      console.log(body.slice(0, 500));
    }
  });
});
req.on('error', (e) => console.error('Error de conexión:', e.message));
req.end();
