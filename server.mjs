// Tiny static preview server. node server.mjs  ->  http://localhost:4321
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = new URL('./dist/', import.meta.url).pathname;
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript',
  '.json':'application/json', '.xml':'application/xml', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml' };

createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let file = join(ROOT, p);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  }
}).listen(4321, () => console.log('→ http://localhost:4321'));
