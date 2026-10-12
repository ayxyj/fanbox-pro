'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs/promises');

// Separate origins allow normal web APIs without giving local HTML access to the app UI/API.
module.exports = function createHtmlPreview({ serveHtml, serveRaw }) {
  const roots = new Map();
  async function open(file) {
    file = await fs.realpath(file);
    if (!/\.html?$/i.test(file) || !(await fs.stat(file)).isFile()) throw Error('请选择 HTML 文件');
    const root = path.dirname(file);
    if (!roots.has(root)) {
      const pending = new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
          try {
            if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end(); return; }
            if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('This preview serves static files only.'); return; }
            const url = new URL(req.url, 'http://127.0.0.1');
            const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (relative.includes('\0') || relative.includes('\\')) throw Error('Invalid path');
            let target = await fs.realpath(path.resolve(root, relative));
            let rel = path.relative(root, target);
            if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
            if ((await fs.stat(target)).isDirectory()) target = await fs.realpath(path.join(target, 'index.html'));
            rel = path.relative(root, target);
            if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
            res.setHeader('Cache-Control', 'no-cache');
            if (/\.html?$/i.test(target)) await serveHtml(req, res, target, true);
            else serveRaw(req, res, target);
          } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
      });
      roots.set(root, pending);
      pending.catch(() => roots.delete(root));
    }
    const server = await roots.get(root);
    return `http://127.0.0.1:${server.address().port}/${encodeURIComponent(path.basename(file))}`;
  }
  async function close() { for (const pending of roots.values()) { try { (await pending).close(); } catch {} } roots.clear(); }
  return { open, close };
};
