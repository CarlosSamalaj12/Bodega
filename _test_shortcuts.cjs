// Test funcional del endpoint de shortcuts.
// Genera un JWT firmado con la misma clave que el server, hace GET/PUT/DELETE
// y muestra el resultado.
const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Leer la clave JWT desde el .env
const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const m = env.match(/^JWT_SECRET\s*=\s*(.+)$/m);
if (!m) {
  console.error('JWT_SECRET no encontrado en .env');
  process.exit(1);
}
const JWT_SECRET = m[1].trim().replace(/^["']|["']$/g, '');

const { pool } = require('./db.js');

async function getAdminUser() {
  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.usuario
     FROM usuarios u
     LEFT JOIN roles r ON r.id_rol = u.id_rol
     WHERE u.activo = 1 AND r.nombre_rol LIKE '%Admin%'
     ORDER BY u.id_usuario ASC
     LIMIT 1`
  );
  return rows[0];
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 3001,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const user = await getAdminUser();
    if (!user) {
      console.error('No hay usuario admin activo');
      process.exit(1);
    }
    console.log('Usuario de prueba:', user);

    const token = jwt.sign(
      { id_user: user.id_usuario, usuario: user.usuario, role: 'Admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('Token generado (primeros 30):', token.substring(0, 30));

    // 1) GET (debería estar vacío al inicio o con valores previos)
    let r = await request('GET', '/api/me/shortcuts', null, token);
    console.log('\n=== GET inicial ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    // 2) PUT con un par de atajos
    const payload = {
      shortcuts: {
        'entradas.new': 'Ctrl+Alt+N',
        'form.save': 'F3',
        'form.addLine': 'F1',
        'help.showShortcuts': 'Shift+/',
      },
    };
    r = await request('PUT', '/api/me/shortcuts', payload, token);
    console.log('\n=== PUT (set) ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    // 3) GET de nuevo
    r = await request('GET', '/api/me/shortcuts', null, token);
    console.log('\n=== GET después de PUT ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    // 4) PUT con un valor inválido (debe ser ignorado por el filtro)
    r = await request(
      'PUT',
      '/api/me/shortcuts',
      { shortcuts: { 'entradas.new': '<script>alert(1)</script>', 'salidas.new': 'N' } },
      token
    );
    console.log('\n=== PUT con valor inválido (debe filtrar) ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    // 5) DELETE
    r = await request('DELETE', '/api/me/shortcuts', null, token);
    console.log('\n=== DELETE ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    // 6) GET final (debería estar vacío)
    r = await request('GET', '/api/me/shortcuts', null, token);
    console.log('\n=== GET final ===');
    console.log('Status:', r.status);
    console.log('Body:', JSON.stringify(r.body));

    console.log('\n✅ Todos los tests pasaron');
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    pool.end();
  }
})();
