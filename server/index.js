const path = require('path');
const os = require('os');
const express = require('express');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const webDist = path.join(__dirname, '..', 'web', 'dist');

app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDist, 'index.html'));
});

function localIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sistema de Inventário rodando em http://localhost:${PORT}`);
  for (const ip of localIps()) {
    console.log(`Acesse de outras máquinas da rede em: http://${ip}:${PORT}`);
  }
});
