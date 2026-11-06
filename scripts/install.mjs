import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
function run(command, args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', [command, ...args].join(' ')], { stdio:'inherit' })
    : spawnSync(command, args, { stdio:'inherit' });
  if (result.error || result.status !== 0) throw new Error('Dependency installation/build failed. Check the network and npm output above, then retry install.cmd.');
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 LTS or newer is required. Download it from https://nodejs.org/.');
  let prebuilt = true;
  try { await access('dist/index.html'); } catch { prebuilt = false; }
  console.log(prebuilt ? 'Installing runtime dependencies for the prebuilt release...' : 'Installing build dependencies for the source download...');
  run('npm', ['ci', ...(prebuilt ? ['--omit=dev'] : []), '--no-audit', '--no-fund']);
  if (!prebuilt) run('npm', ['run', 'build']);
  await import('sharp');
  console.log('\nInstallation complete. Run start.cmd (Windows), or npm start.');
  console.log('Open the displayed localhost URL, then configure your own API key and import the official eBird v2026 CSV in Model settings.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
