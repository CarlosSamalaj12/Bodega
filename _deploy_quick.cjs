const { Client } = require('ssh2');
const conn = new Client();
const VPS = { host: '2.25.166.211', port: 22, username: 'root', password: '&Za&6uaK#OdYri' };

function run(cmd) {
  const fullCmd = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH=$PATH:/usr/local/bin:/usr/bin; ${cmd}`;
  return new Promise((resolve, reject) => {
    conn.exec(fullCmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('close', code => { console.log(`  [exit ${code}]`); resolve({ out, code }); })
        .on('data', d => { out += d; process.stdout.write(d); })
        .stderr.on('data', d => { out += d; process.stderr.write(d); });
    });
  });
}

conn.on('ready', async () => {
  console.log('\n🔌 SSH conectado. Desplegando filtro de visibilidad de productos...\n');
  try {
    await run('cd /var/www/bodega && git pull');
    await run('pm2 restart bodega-app');
    await run('pm2 list');
    console.log('\n✅ Despliegue completado.');
  } catch(e) {
    console.error('❌ Error:', e);
  } finally {
    conn.end();
  }
}).connect(VPS);
