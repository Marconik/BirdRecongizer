import { readFile } from 'node:fs/promises';

export const TAXONOMY_VERSION = 'v2026';
export const TAXONOMY_URL = 'https://www.birds.cornell.edu/clementschecklist/wp-content/uploads/2026/11/eBird_Taxonomy_v2026-october-2026.csv';
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('分类表 CSV 引号未闭合。');
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}
export const normalizeName = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const header = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export class Taxonomy {
  constructor(rows) {
    this.rows = rows; this.index = new Map();
    for (const taxon of rows) for (const value of [taxon.english_name, taxon.scientific_name, taxon.species_code]) {
      const key = normalizeName(value), entries = this.index.get(key) ?? [];
      if (!entries.includes(taxon)) entries.push(taxon);
      this.index.set(key, entries);
    }
  }
  exact(value) { return this.index.get(normalizeName(value)) ?? []; }
  resolve(candidate) {
    // Codes invented by the model are never sufficient: require a name match.
    const en = this.exact(candidate?.english_name).filter(t => normalizeName(t.english_name) === normalizeName(candidate.english_name));
    const sci = this.exact(candidate?.scientific_name).filter(t => normalizeName(t.scientific_name) === normalizeName(candidate.scientific_name));
    if (en.length === 1 && sci.length === 1 && en[0] !== sci[0]) return null;
    return sci.length === 1 ? sci[0] : en.length === 1 ? en[0] : null;
  }
  search(query, limit = 12) {
    const q = normalizeName(query); if (!q) return [];
    const words = q.split(' ');
    return this.rows.map(taxon => {
      const en = normalizeName(taxon.english_name), sci = normalizeName(taxon.scientific_name);
      const score = en === q || sci === q ? 100 : (en.includes(q) || sci.includes(q) ? 40 : 0)
        + words.filter(w => w.length > 2 && (` ${en} ${sci} `).includes(` ${w} `)).length * 5;
      return { taxon, score };
    }).filter(t => t.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(t => t.taxon);
  }
}

export function taxonomyFromCsv(csv, minimumSpecies = 10000) {
  const [head, ...rows] = parseCsv(csv); if (!head) throw new Error('分类表为空。');
  const keys = head.map(header);
  const column = (...names) => keys.findIndex(k => names.includes(k));
  const fields = { species_code: column('speciescode'), english_name: column('primarycomname', 'englishname', 'comname'), scientific_name: column('sciname', 'scientificname'), category: column('category'), family: column('family', 'familycomname') };
  for (const key of ['species_code', 'english_name', 'scientific_name', 'category']) if (fields[key] < 0) throw new Error(`分类表缺少 ${key} 列，请使用官方 eBird Taxonomy v2026 CSV。`);
  const seen = new Set();
  const taxa = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, index]) => [key, index < 0 ? '' : row[index] ?? '']))).filter(taxon => {
    if (!taxon.english_name || !taxon.scientific_name || !/^[a-z0-9]+$/i.test(taxon.species_code) || seen.has(taxon.species_code)) return false;
    seen.add(taxon.species_code); return true;
  });
  if (taxa.filter(t => t.category === 'species').length < minimumSpecies) throw new Error('分类表不完整：需要完整的全球 eBird Taxonomy v2026（至少 10,000 个物种）。');
  return new Taxonomy(taxa);
}
export async function loadTaxonomy(directory) {
  const meta = JSON.parse(await readFile(`${directory}/metadata.json`, 'utf8'));
  if (meta.version !== TAXONOMY_VERSION) throw new Error('分类表版本必须为 v2026。');
  return taxonomyFromCsv(await readFile(`${directory}/ebird-v2026.csv`, 'utf8'));
}
