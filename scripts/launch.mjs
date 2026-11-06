import { access } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 LTS or newer is required.');
  try { await access('dist/index.html'); await import('sharp'); }
  catch { throw new Error('Application files/dependencies are missing. Run install.cmd first, or node scripts/install.mjs.'); }
  try { await access('.env'); loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot load .env. Check the file permissions and syntax.'); }
  await import('./start.mjs');
} catch (error) { console.error(error.message); process.exitCode = 1; }
