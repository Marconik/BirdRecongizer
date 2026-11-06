import { createServer } from 'vite';
import { createAppServer } from '../server/http.mjs';

const api = await createAppServer();
await new Promise((resolve, reject) => { api.once('error', reject); api.listen(5174, '127.0.0.1', resolve); });
try {
  const vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await vite.listen(); vite.printUrls();
  console.log('WildScene API: http://127.0.0.1:5174 (eBird v2026 / English)');
  const close = async () => { await vite.close(); api.closeAllConnections(); api.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch (error) { api.close(); throw error; }
