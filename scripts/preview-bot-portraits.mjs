import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 3003, strictPort: true },
});
await server.listen();
process.stdout.write('Actual game model portraits: http://127.0.0.1:3003/scripts/bot-portraits.html\n');
