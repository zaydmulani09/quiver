import { defineConfig, type Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Dev-only: lets tools/og.html POST rendered PNGs straight into public/. */
function assetSaver(): Plugin {
  return {
    name: 'quiver-asset-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = (url.searchParams.get('name') ?? '').replace(/[^a-z0-9._-]/gi, '');
        if (req.method !== 'POST' || !name) { res.statusCode = 400; res.end('bad request'); return; }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(resolve('public'), { recursive: true });
          writeFileSync(resolve('public', name), Buffer.concat(chunks));
          res.setHeader('content-type', 'text/plain');
          res.end(`saved public/${name} (${Buffer.concat(chunks).length} bytes)`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [assetSaver()],
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  server: { port: 5188, strictPort: true, host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
