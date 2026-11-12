import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// Fictional state only. Separate experiments, shared local server behavior.
const initial = () => ({ approvalMode: 'NEVER', intentDetectionMode: 'AI_SUGGESTION', revision: 1 });
const settings = { react: initial(), a2ui: initial() };
export default defineConfig({
  root,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { 'next/navigation': path.join(root, '../ai-provider-failure/next-navigation.ts') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 4188, strictPort: true, fs: { allow: [path.resolve(root, '../../../..')] } },
  build: { manifest: true },
  plugins: [{ name: 'fictional-settings-only', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/__prototype/')) return next();
      const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
      const variant = request.url.split('/')[2];
      if (!Object.hasOwn(settings, variant)) return reply(404, {});
      if (request.method === 'GET') return reply(200, settings[variant]);
      let body;
      try { const chunks = []; for await (const chunk of request) { chunks.push(chunk); if (Buffer.concat(chunks).length > 4096) return reply(413, {}); } body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reply(400, {}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, {});
      if (request.url.endsWith('/reset')) { settings[variant] = initial(); return reply(200, settings[variant]); }
      if (request.method !== 'POST' || !request.url.endsWith('/confirm')) return reply(405, {});
      await new Promise(resolve => setTimeout(resolve, 500));
      // These switches simulate server outcomes; they are not production authorization.
      if (body.environment === 'forbidden') return reply(403, { code: 'FORBIDDEN' });
      if (body.environment === 'outage') return reply(503, { code: 'UNAVAILABLE' });
      if (body.environment === 'conflict' || body.revision !== settings[variant].revision) return reply(409, { code: 'CONFLICT' });
      const patches = { review: { approvalMode: 'ALWAYS' }, suggestion: { intentDetectionMode: 'AI_SUGGESTION' } };
      if (!Object.hasOwn(patches, body.scenario)) return reply(400, { code: 'INVALID_PROPOSAL' });
      settings[variant] = { ...settings[variant], ...patches[body.scenario], revision: settings[variant].revision + 1 };
      return reply(200, settings[variant]);
    });
  }}],
});
