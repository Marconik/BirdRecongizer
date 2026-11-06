import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { taxonomyFromCsv, TAXONOMY_URL, TAXONOMY_VERSION } from '../server/taxonomy.mjs';
import { DATA_DIR } from '../server/config.mjs';

export async function installTaxonomy(csv, source, directory = resolve(DATA_DIR, 'taxonomy')) {
  const catalog = taxonomyFromCsv(csv);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'ebird-v2026.csv.tmp'), csv, 'utf8');
  await rename(resolve(directory, 'ebird-v2026.csv.tmp'), resolve(directory, 'ebird-v2026.csv'));
  await writeFile(resolve(directory, 'metadata.json.tmp'), JSON.stringify({ version: TAXONOMY_VERSION, source, installed_at: new Date().toISOString(), records: catalog.rows.length }, null, 2));
  await rename(resolve(directory, 'metadata.json.tmp'), resolve(directory, 'metadata.json'));
  return catalog;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const file = process.argv[2]; let csv;
    if (file) {
      if (!/v2026/i.test(basename(file))) throw new Error('本地文件名须包含 v2026，以确认你选择的是该版本官方 CSV。');
      csv = await readFile(resolve(file), 'utf8');
    } else {
      const response = await fetch(TAXONOMY_URL, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Cornell 下载返回 HTTP ${response.status}。可在网页下载官方 v2026 CSV，然后通过应用的“模型设置”导入。`);
      csv = await response.text();
    }
    const catalog = await installTaxonomy(csv, file ? `local:${basename(file)}` : TAXONOMY_URL);
    console.log(`eBird ${TAXONOMY_VERSION} 已安装：${catalog.rows.length} 个分类条目。`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
