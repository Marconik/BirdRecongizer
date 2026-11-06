import { access, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = `v${pkg.version}`;
if (!/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new Error('Invalid release version.');
if (process.platform !== 'win32') throw new Error('This release packager currently uses Windows PowerShell.');
await access('dist/index.html');
const destination = resolve('artifacts/releases');
await mkdir(destination, { recursive:true });
const staging = await mkdtemp(join(destination, 'stage-'));
const bundle = join(staging, `WildScene-${version}`);
await mkdir(bundle);
const rootFiles = new Set(['package.json','package-lock.json','README.md','QUICKSTART.md','LICENSE','THIRD_PARTY_NOTICES.md','.env.example','.gitignore','install.cmd','start.cmd','index.html','tsconfig.json','vite.config.ts']);
const sourceFolders = new Set(['src','server','scripts','public','docs','tests']);
const tracked = execFileSync('git', ['ls-files','-z'], { encoding:'utf8' }).split('\0').filter(Boolean);
const files = tracked.filter(file => rootFiles.has(file) || sourceFolders.has(file.split('/')[0]));
const forbidden = file => /(^|\/)(data|artifacts|node_modules|\.git|\.codex|\.agents|\.aws|photos|datasets|exports)(\/|$)/i.test(file) || /(^|\/)tags\.json$/i.test(file) || /\.local(?:\.|$)/i.test(file) || /\.(pem|key|p12|pfx|log)$/i.test(file) || /(^|\/)\.env(?:\.|$)/i.test(file) && file !== '.env.example' || /^scripts\/(benchmark|summarize-benchmark)\.mjs$/.test(file);
for (const file of files) {
  if (forbidden(file)) throw new Error(`Private file is tracked; refusing release: ${file}`);
  await mkdir(resolve(bundle, file, '..'), { recursive:true });
  await cp(resolve(root,file), resolve(bundle,file));
}
await cp('dist', join(bundle,'dist'), { recursive:true });
async function walk(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile()) out.push(file);
    else throw new Error('Release cannot contain symlinks.');
  }
  return out;
}
// Compare the actual local API key in memory only; it is never logged/packaged.
const secrets = [];
try { const local = JSON.parse(await readFile('data/config.json','utf8')); if (typeof local.apiKey === 'string' && local.apiKey.length > 6) secrets.push(local.apiKey); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { for (const line of (await readFile('.env','utf8')).split(/\r?\n/)) { const match=line.match(/^\s*\w*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?(.+?)["']?\s*$/i); if(match && match[1].length>6) secrets.push(match[1]); } } catch (error) { if(error.code!=='ENOENT') throw error; }
const stagedFiles = await walk(bundle);
for (const file of stagedFiles) {
  const name = relative(bundle,file).replaceAll('\\','/');
  if (forbidden(name)) throw new Error(`Forbidden archive entry: ${name}`);
  const bytes = await readFile(file);
  const content = bytes.toString('utf8');
  if (secrets.some(secret=>content.includes(secret)) || /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) throw new Error(`Possible secret in release: ${name}`);
}
const commit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await writeFile(join(bundle,'release-manifest.json'), JSON.stringify({ application:'WildScene', version:pkg.version, commit, node:pkg.engines.node, files:stagedFiles.map(f=>relative(bundle,f).replaceAll('\\','/')).sort() },null,2)+'\n');
const archive = join(destination,`WildScene-${version}.zip`);
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/archive-release.ps1'),'-Source',bundle,'-Destination',archive],{stdio:'inherit'});
console.log(JSON.stringify({ version, archive:relative(root,archive), staging:relative(root,bundle), files:stagedFiles.length+1 }));
