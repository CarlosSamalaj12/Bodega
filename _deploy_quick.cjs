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
  console.log('\n🔌 SSH conectado. Desplegando sincronización en tiempo real para cambios del catálogo...\n');
  try {
    // 1. Pull de cambios
    await run('cd /var/www/Bodega && git pull');

    // 2. Reiniciar el backend para aplicar los cambios del WebSocket
    await run('pm2 restart bodega-app');

    // 3. Script rápido de Node temporal en el VPS para emitir el evento 'stock:changed' a Socket.io
    // Esto provocará que los clientes conectados se actualicen al instante y limpien el cache
    console.log('\n→ Emitiendo evento global stock:changed para actualizar todas las pantallas de los usuarios en tiempo real...');
    await run(`node -e "
      const io = require('socket.io-client');
      const socket = io('http://127.0.0.1:5183', { transports: ['websocket'] });
      socket.on('connect', () => {
        console.log('Conectado al socket local. Emitiendo evento de sincronización...');
        socket.emit('stock:changed', { action: 'catalog_changed', at: new Date().toISOString() });
        setTimeout(() => {
          socket.disconnect();
          console.log('Evento enviado con éxito. Desconectado.');
          process.exit(0);
        }, 1000);
      });
      socket.on('connect_error', (err) => {
        console.error('Error al conectar al socket:', err.message);
        process.exit(1);
      });
    " 2>&1 || true`);

    console.log('\n✅ Despliegue y actualización forzada en tiempo real completados.');
  } catch(e) { console.error('❌ Error:', e); }
  finally { conn.end(); }
}).connect(VPS);
