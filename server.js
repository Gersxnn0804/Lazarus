const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'data', 'latest_tracking_client.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload, null, 2));
}

function safePublicPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const resolved = path.normalize(path.join(PUBLIC_DIR, cleanPath === '/' ? 'index.html' : cleanPath));
  return resolved.startsWith(PUBLIC_DIR) ? resolved : null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/lazarus-data' || req.url.startsWith('/api/lazarus-data?')) {
    fs.readFile(DATA_FILE, 'utf8', (err, content) => {
      if (err) {
        return sendJson(res, 404, {
          ok: false,
          hasData: false,
          message: 'No se encontró el archivo JSON en public/data/latest_tracking_client.json'
        });
      }
      try {
        const data = JSON.parse(content);
        return sendJson(res, 200, { ok: true, hasData: true, data });
      } catch (parseError) {
        return sendJson(res, 422, {
          ok: false,
          hasData: false,
          message: 'El archivo JSON existe, pero no tiene un formato válido.',
          detail: parseError.message
        });
      }
    });
    return;
  }

  const filePath = safePublicPath(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end('Acceso no permitido');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Lazarus Dashboard disponible en http://localhost:${PORT}`);
  console.log('JSON esperado en: public/data/latest_tracking_client.json');
});
