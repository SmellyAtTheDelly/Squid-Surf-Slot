'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../shared/contract');
const { Publication, DemoRgs } = require('./demo-rgs');
const { writeConfig } = require('./build');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function createServer(options = {}) {
  const front = path.resolve(options.frontend || path.join(root, 'frontend'));
  const rgs = options.rgs || new DemoRgs(new Publication(options.math || path.join(root, 'dist/math')));
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) { res.writeHead(403); res.end(); return; }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      } catch { res.writeHead(403); res.end(); return; }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }
      if (req.method === 'POST' && /^\/(wallet\/|bet\/event$)/.test(url.pathname)) {
        let data = '', bytes = 0;
        for await (const part of req) { bytes += part.length; if (bytes > 32768) throw new Error('Request too large'); data += part; }
        try { json(200, await rgs.call(url.pathname, JSON.parse(data))); }
        catch (error) { json(400, { error: error.code || 'ERR_VAL', message: error.message }); }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const replay = /^\/bet\/replay\/local-game\/1\/([a-z_]+)\/(\d+)$/.exec(url.pathname);
      if (replay) {
        const book = await rgs.publication.replay(replay[1], Number(replay[2]));
        if (!book) { res.writeHead(404); res.end(); return; }
        json(200, { state: book.events, costMultiplier: C.mode(replay[1]).cost, payoutMultiplier: book.payoutMultiplier / 100 });
        return;
      }
      if (url.pathname === '/' && !url.searchParams.has('sessionID') && !url.searchParams.has('replay')) {
        const host = req.headers.host;
        if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw new Error('Invalid local host');
        const params = new URLSearchParams({ sessionID: 'local-demo', rgs_url: 'http://' + host, demo: 'true', lang: 'en', currency: 'USD' });
        res.writeHead(302, { Location: '/?' + params }); res.end(); return;
      }
      const route = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(front, '.' + route);
      if (!file.startsWith(front + path.sep)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(front) + path.sep)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch { if (!res.headersSent) json(500, { error: 'ERR_GEN', message: 'Local demo request failed' }); else res.end(); }
  });
}

if (require.main === module) {
  writeConfig();
  const port = Number(process.argv[2] || 5177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  createServer().listen(port, '127.0.0.1', () => console.log('Squid Squad local RGS running at http://localhost:' + port));
}
module.exports = { createServer };
