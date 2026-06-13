import { defineConfig, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint: POST a data-URL to /__shot?name=foo and it lands in ./shots/foo.jpg
function screenshotSink(): Plugin {
  return {
    name: 'screenshot-sink',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const url = new URL(req.url ?? '', 'http://x');
            const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9-_]/gi, '');
            const b64 = body.replace(/^data:image\/\w+;base64,/, '');
            const dir = path.resolve(__dirname, 'shots');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(b64, 'base64'));
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// NAS/SMB shares don't support native fs.watch — poll instead.
// `base` is overridden to the repo subpath for GitHub Pages builds (VITE_BASE).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [screenshotSink()],
  server: {
    host: true, // bind 0.0.0.0 — reachable via Tailscale/LAN, not just this machine
    watch: {
      usePolling: true,
      interval: 1200,
    },
  },
});
