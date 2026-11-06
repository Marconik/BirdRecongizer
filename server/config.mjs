import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DATA_DIR = resolve(process.env.BIRD_DATA_DIR || 'data');
const configPath = resolve(DATA_DIR, 'config.json');
export function validateConfig(value) {
  const url = new URL(value.baseUrl || 'https://api.openai.com/v1');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('API 地址需要 HTTPS，本机服务可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含账号、查询参数或片段。');
  const text = (name, max) => { const v = String(value[name] ?? '').trim(); if (v.length > max || /[\r\n]/.test(v)) throw new Error(`${name} 格式不正确。`); return v; };
  return { baseUrl: url.href.replace(/\/$/, ''), apiKey: text('apiKey', 1000), model: text('model', 200), reviewModel: text('reviewModel', 200), concurrency: Math.max(1, Math.min(8, Math.floor(Number(value.concurrency) || 4))) };
}
export async function readConfig() {
  let saved = {};
  try { saved = JSON.parse(await readFile(configPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return validateConfig({ baseUrl: process.env.VLM_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.VLM_API_KEY || '', model: process.env.VLM_MODEL || '', reviewModel: process.env.VLM_REVIEW_MODEL || '', concurrency: process.env.VLM_CONCURRENCY || 4, ...saved });
}
export async function saveConfig(input) {
  const previous = await readConfig();
  const next = validateConfig({ ...previous, ...input, apiKey: input.clearApiKey ? '' : input.apiKey || previous.apiKey });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(`${configPath}.tmp`, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await rename(`${configPath}.tmp`, configPath);
  return next;
}
export function publicConfig(config) { const { apiKey, ...rest } = config; return { ...rest, hasApiKey: Boolean(apiKey), configured: Boolean(apiKey && config.model) }; }
