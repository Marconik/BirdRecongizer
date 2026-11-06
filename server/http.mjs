import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { DATA_DIR, readConfig, saveConfig, publicConfig } from './config.mjs';
import { loadTaxonomy, TAXONOMY_URL, TAXONOMY_VERSION } from './taxonomy.mjs';
import { Recognizer, WORKFLOW_VERSION } from './recognition.mjs';
import { installTaxonomy } from '../scripts/setup-taxonomy.mjs';
import { prepareReference } from './recognition.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { UsageStore } from './usage-store.mjs';
import { captureDateError } from '../src/capture-date.ts';

function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json') || request.headers['x-wildscene-client'] !== '1') throw problem('请求格式不正确。', 403);
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 24 * 1024 * 1024) throw problem('单次请求超过 24 MB，请缩小图片或参考列表。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem('请求不是有效 JSON。'); }
}
function validateContext(body) {
  if (!body || typeof body !== 'object') throw problem('批次信息不正确。');
  if (typeof body.location !== 'string' || body.location.length > 2000) throw problem('拍摄地点不能超过 2,000 个字符。');
  if (body.coordinates && (!Number.isFinite(body.coordinates.lat) || Math.abs(body.coordinates.lat) > 90 || !Number.isFinite(body.coordinates.lng) || Math.abs(body.coordinates.lng) > 180)) throw problem('坐标格式不正确。');
  const dateError = captureDateError(body.capturedAt);
  if (dateError) throw problem(dateError);
  if (body.reference && (!Array.isArray(body.reference.records) || body.reference.records.length > 100000 || body.reference.records.some(row => !Array.isArray(row) || row.length > 100 || row.some(cell => typeof cell !== 'string' || cell.length > 5000)))) throw problem('参考列表格式不正确或过大。');
  return body;
}
export async function createAppServer({ production = false, port = 5174, provider, dataDirectory = DATA_DIR, readConfiguration = readConfig, writeConfiguration = saveConfig } = {}) {
  const taxonomyDirectory = resolve(dataDirectory, 'taxonomy');
  let catalog = null, taxonomyError = '', active = 0;
  const contexts = new Map();
  const usage = new UsageStore(resolve(dataDirectory, 'usage'));
  async function reloadCatalog() {
    try { catalog = await loadTaxonomy(taxonomyDirectory); taxonomyError = ''; }
    catch (error) { catalog = null; taxonomyError = error.code === 'ENOENT' ? '尚未安装 eBird v2026 分类表，请在模型设置中导入官方 CSV。' : error.message; }
  }
  await reloadCatalog();
  const send = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); };
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw problem('仅允许本机访问。', 403);
      const origin = request.headers.origin;
      if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) throw problem('不允许跨站访问本地 API。', 403);
      const path = new URL(request.url, `http://${host}`).pathname;
      if (path === '/api/usage' && request.method === 'GET') {
        const contextId = new URL(request.url, `http://${host}`).searchParams.get('contextId') || '';
        if (contextId && !/^[a-f0-9-]{36}$/i.test(contextId)) throw problem('批次 ID 不正确。');
        return send(response, 200, await usage.summary(contextId));
      }
      if (path === '/api/status' && request.method === 'GET') {
        if (!catalog) await reloadCatalog();
        const config = await readConfiguration();
        return send(response, 200, { ...publicConfig(config), workflowVersion: WORKFLOW_VERSION, taxonomyVersion: TAXONOMY_VERSION, taxonomyReady: Boolean(catalog), taxonomyCount: catalog?.rows.length ?? 0, taxonomyError, taxonomyUrl: TAXONOMY_URL, active });
      }
      if (path === '/api/config' && request.method === 'PUT') return send(response, 200, publicConfig(await writeConfiguration(await jsonBody(request))));
      if (path === '/api/context' && request.method === 'POST') {
        if (!catalog) await reloadCatalog();
        if (!catalog) throw problem(taxonomyError, 503);
        const context = validateContext(await jsonBody(request));
        const contextId = randomUUID();
        const preparedReference = prepareReference(context.reference, catalog);
        const referenceKey = createHash('sha512').update(JSON.stringify(context.reference || null)).digest('hex');
        // A list is uploaded and resolved only once per batch, not once per image.
        contexts.set(contextId, { location: context.location, coordinates: context.coordinates, capturedAt: context.capturedAt, preparedReference, referenceKey, used: Date.now() });
        for (const [key, value] of contexts) if (Date.now()-value.used > 24*60*60*1000) contexts.delete(key);
        if (contexts.size > 100) contexts.delete(contexts.keys().next().value);
        return send(response, 200, { contextId });
      }
      if (path === '/api/taxonomy' && request.method === 'PUT') {
        if (active) throw problem('请等待当前图片完成后再更换分类表。', 409);
        const body = await jsonBody(request);
        if (typeof body.fileName !== 'string' || !/v2026.*\.csv$/i.test(body.fileName) || typeof body.csv !== 'string') throw problem('请选择名称包含 v2026 的官方 eBird Taxonomy CSV。');
        try { await installTaxonomy(body.csv, `local:${body.fileName.replace(/[/\\]/g, '')}`, taxonomyDirectory); } catch (e) { throw problem(e.message); }
        await reloadCatalog(); return send(response, 200, { version: TAXONOMY_VERSION, count: catalog.rows.length });
      }
      if (path === '/api/recognize' && request.method === 'POST') {
        const body = await jsonBody(request), config = await readConfiguration();
        if (!body || typeof body.image !== 'string' || body.image.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw problem('请提供不超过 12 MB 的有效图片。');
        const context = contexts.get(body.contextId);
        if (!context) throw problem('批次上下文已过期或程序已重启，请刷新页面后重新开始。', 503);
        context.used = Date.now();
        const input = { ...context, image: body.image, force: body.force === true };
        if (!config.apiKey || !config.model) throw problem('请先在模型设置中填写 API 密钥和模型名。', 503);
        if (!catalog) throw problem(taxonomyError, 503);
        if (active >= config.concurrency) throw problem('本地并发已满，请稍后继续。', 429);
        const abort = new AbortController();
        response.on('close', () => { if (!response.writableEnded) abort.abort(); });
        active++;
        try {
          const engine = new Recognizer({ catalog, cacheDirectory: resolve(dataDirectory, 'cache'), provider, onUsage: event => usage.record({ ...event, contextId: body.contextId }) });
          const result = await engine.recognize(input, config, abort.signal);
          if (!abort.signal.aborted) send(response, 200, result);
        } finally { active--; }
        return;
      }
      if (path.startsWith('/api/')) throw problem('API 不存在。', 404);
      if (!production || !['GET', 'HEAD'].includes(request.method)) throw problem('页面不存在。', 404);
      const root = resolve('dist'), relative = decodeURIComponent(path).replace(/^\/+/, '');
      let file = resolve(root, relative || 'index.html');
      if (!file.startsWith(root + sep)) throw problem('页面不存在。', 404);
      try { if (!(await stat(file)).isFile()) throw problem('文件不存在。', 404); } catch { if (extname(file)) throw problem('文件不存在。', 404); file = resolve(root, 'index.html'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      // Never relay provider response bodies, credentials, images or local file paths.
      const known = error.status || (error.message?.includes('Input') ? 400 : 500);
      send(response, known, { error: known === 500 ? '本地服务处理失败，请检查图片格式或本地配置文件。' : error.message, fatal: [400, 401, 403, 404, 503].includes(error.providerStatus ?? known) });
    }
  });
  server.requestTimeout = 600000;
  return server;
}
