// Test directo de la función createDailyCloseForDate para verificar la validación
// secuencial sin necesidad del endpoint completo.
const http = require('http');
const jwt = require('jsonwebtoken');

const SECRET = 'JDL_bodega_2026_!s3cr3t#xP9vQ2mL7';
const PORT = 3001;
const HOST = '127.0.0.1';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Token para bodega #29 (Restaurante ElDeck) con rol bodeguero - tiene conteo final
  // y 2 días pendientes
  const token = jwt.sign(
    { id_user: 3, usuario: 'test', id_role: 2, id_warehouse: 29, full_name: 'Test' },
    SECRET, { expiresIn: '1h' }
  );

  console.log('=== Estado actual bodega #29 ===');
  const estado = await request('GET', '/api/cierre-dia/estado', null, token);
  console.log('last_closed:', estado.body?.last_closed_date);
  console.log('days_missing:', estado.body?.days_missing);
  console.log('pending_days:', estado.body?.pending_days);

  console.log('\n=== Intentar cerrar 2026-07-30 sin supervisor_pin (debería pedir PIN, no skip-day) ===');
  const skip = await request('POST', '/api/cierre-dia', {
    fecha: '2026-07-30',
    confirmar: 1,
  }, token);
  console.log('status:', skip.status);
  console.log('code:', skip.body?.code);
  console.log('error:', skip.body?.error);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
