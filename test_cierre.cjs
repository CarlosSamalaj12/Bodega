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
        try {
          resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Token para un usuario de bodega #12 (Gelato) con rol bodeguero
  // id_user=3 (Jperez) es de bodega #1, no #12. Creamos un token directo con id_warehouse=12
  const token = jwt.sign(
    { id_user: 3, usuario: 'test', id_role: 2, id_warehouse: 12, full_name: 'Test' },
    SECRET, { expiresIn: '1h' }
  );

  console.log('=== 1. Estado actual bodega #12 ===');
  const estado = await request('GET', '/api/cierre-dia/estado', null, token);
  console.log('status:', estado.status);
  console.log('body:', JSON.stringify(estado.body, null, 2));

  if (estado.body && estado.body.days_missing > 0) {
    const required = estado.body.required_close_date;
    console.log(`\n=== 2. Intentar cerrar día FUTURO (saltando uno) ===`);
    const skip = await request('POST', '/api/cierre-dia', {
      fecha: '2026-07-30',
      confirmar: 1,
    }, token);
    console.log('status:', skip.status);
    console.log('body:', JSON.stringify(skip.body, null, 2));

    console.log(`\n=== 3. Cerrar día correcto: ${required} (sin conteo) ===`);
    const ok = await request('POST', '/api/cierre-dia', {
      fecha: required,
      confirmar: 1,
    }, token);
    console.log('status:', ok.status);
    console.log('body:', JSON.stringify(ok.body, null, 2).slice(0, 800));
  }
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
