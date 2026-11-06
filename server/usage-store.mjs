import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function normalizeUsage(usage) {
  const input = count(usage?.prompt_tokens) ?? count(usage?.input_tokens);
  const output = count(usage?.completion_tokens) ?? count(usage?.output_tokens);
  const cached = count(usage?.prompt_tokens_details?.cached_tokens) ?? count(usage?.input_tokens_details?.cached_tokens) ?? count(usage?.prompt_cache_hit_tokens);
  const reasoning = count(usage?.completion_tokens_details?.reasoning_tokens) ?? count(usage?.output_tokens_details?.reasoning_tokens);
  return {
    input, output,
    total: count(usage?.total_tokens) ?? (input !== null && output !== null ? input + output : null),
    cached: cached === null ? null : Math.min(cached, input ?? cached),
    reasoning: reasoning === null ? null : Math.min(reasoning, output ?? reasoning),
  };
}

function sanitizeProvider(value) {
  try { return new URL(value).origin.slice(0, 500); } catch { return 'unknown'; }
}
function safeRecord(event) {
  return {
    id: randomUUID(), timestamp: new Date().toISOString(),
    kind: ['cache_hit', 'image_process'].includes(event.kind) ? event.kind : 'request',
    contextId: String(event.contextId || '').slice(0, 80),
    processId: String(event.processId || '').slice(0, 80),
    provider: sanitizeProvider(event.provider), model: String(event.model || 'unknown').slice(0, 200),
    stage: event.stage === 'review' ? 'review' : 'primary',
    outcome: ['ok', 'http_error', 'transport_error', 'aborted', 'invalid_output'].includes(event.outcome) ? event.outcome : 'ok',
    httpStatus: count(event.httpStatus), attempt: count(event.attempt) ?? 1,
    durationMs: Math.max(0, Math.round(Number(event.durationMs) || 0)), tokens: normalizeUsage(event.usage),
  };
}
const totals = () => ({ processedImages: 0, inferences: 0, primaryInferences: 0, reviewInferences: 0, requests: 0, successfulRequests: 0, failedRequests: 0, primaryRequests: 0, reviewRequests: 0, retryRequests: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, inputReports: 0, outputReports: 0, totalReports: 0, cachedReports: 0, reasoningReports: 0, missingUsageRequests: 0, durationMs: 0 });
function add(target, record) {
  if (record.kind === 'image_process') { target.processedImages++; return; }
  if (record.kind === 'cache_hit') { target.cacheHits++; return; }
  target.requests++;
  target[record.outcome === 'ok' ? 'successfulRequests' : 'failedRequests']++;
  target[record.stage === 'review' ? 'reviewRequests' : 'primaryRequests']++;
  if (record.attempt > 1) target.retryRequests++;
  else {
    target.inferences++;
    target[record.stage === 'review' ? 'reviewInferences' : 'primaryInferences']++;
  }
  const t = record.tokens;
  for (const name of ['input', 'output', 'total', 'cached', 'reasoning']) if (t[name] !== null) target[`${name}Reports`]++;
  target.inputTokens += t.input ?? 0; target.outputTokens += t.output ?? 0;
  target.totalTokens += t.total ?? (t.input ?? 0) + (t.output ?? 0);
  // Cached input and reasoning are subsets, never added to total a second time.
  target.cachedInputTokens += t.cached ?? 0; target.reasoningTokens += t.reasoning ?? 0;
  if (t.input === null || t.output === null) target.missingUsageRequests++;
  target.durationMs += record.durationMs;
}
function bucket() { return { ...totals(), models: new Map(), since: null, updatedAt: null, imageTrackingSince: null, legacyProcessingRecords: 0 }; }
function addBucket(target, record) {
  add(target, record); target.since ??= record.timestamp; target.updatedAt = record.timestamp;
  if (record.kind === 'image_process') target.imageTrackingSince ??= record.timestamp;
  if (record.kind !== 'image_process' && !record.processId) target.legacyProcessingRecords++;
  if (record.kind !== 'request') return;
  const key = JSON.stringify([record.provider, record.model]);
  if (!target.models.has(key)) target.models.set(key, { ...totals(), provider: record.provider, model: record.model });
  add(target.models.get(key), record);
}

/** Append-only, process-serialized accounting. Records contain no prompts, keys or photos. */
export class UsageStore {
  constructor(directory) {
    this.directory = directory; this.file = resolve(directory, 'requests.jsonl');
    this.all = bucket(); this.batches = new Map(); this.pending = [];
    this.storageError = ''; this.historyError = ''; this.corruptRecords = 0; this.needsNewline = false;
    this.writes = Promise.resolve(); this.ready = this.load();
  }
  apply(record) {
    addBucket(this.all, record);
    if (record.contextId) {
      if (!this.batches.has(record.contextId)) this.batches.set(record.contextId, bucket());
      addBucket(this.batches.get(record.contextId), record);
    }
  }
  async load() {
    try {
      const content = await readFile(this.file, 'utf8');
      const seen = new Set();
      this.needsNewline = Boolean(content && !content.endsWith('\n'));
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (!['request', 'cache_hit', 'image_process'].includes(record.kind) || !record.tokens || !Number.isFinite(Date.parse(record.timestamp)) || typeof record.id !== 'string'
            || typeof record.model !== 'string' || typeof record.provider !== 'string' || typeof record.contextId !== 'string'
            || (record.processId !== undefined && typeof record.processId !== 'string')
            || !['primary', 'review'].includes(record.stage) || !['ok', 'http_error', 'transport_error', 'aborted', 'invalid_output'].includes(record.outcome)
            || count(record.durationMs) === null || count(record.attempt) === null) throw new Error('Invalid record');
          // Validate numeric data from disk; never treat broken counters as usage.
          for (const key of ['input', 'output', 'total', 'cached', 'reasoning']) if (record.tokens[key] !== null && count(record.tokens[key]) === null) throw new Error('Invalid token count');
          if (!seen.has(record.id)) { this.apply(record); seen.add(record.id); }
        } catch { this.corruptRecords++; }
      }
    } catch (error) { if (error.code !== 'ENOENT') this.historyError = '历史用量文件暂时无法读取，当前累计可能不完整。'; }
  }
  async record(event) {
    await this.ready;
    const record = safeRecord(event); this.apply(record); this.pending.push(record);
    this.writes = this.writes.then(async () => {
      if (!this.pending.length) return;
      const batch = [...this.pending];
      try {
        await mkdir(this.directory, { recursive: true });
        await appendFile(this.file, (this.needsNewline ? '\n' : '') + batch.map(value => JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
        this.needsNewline = false; this.pending.splice(0, batch.length); this.storageError = '';
      } catch { this.storageError = '用量记录暂未写入磁盘，当前数据保留在内存中。'; }
    });
    await this.writes;
  }
  async summary(contextId = '') {
    await this.ready; await this.writes;
    const current = contextId ? this.batches.get(contextId) ?? bucket() : this.all;
    const { models, ...values } = current;
    return { ...values, models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens), averageRequestMs: current.requests ? Math.round(current.durationMs/current.requests) : null, storageError: [this.historyError, this.storageError].filter(Boolean).join(' '), corruptRecords: this.corruptRecords, pendingRecords: this.pending.length };
  }
}
