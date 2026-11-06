import { setTimeout as delay } from 'node:timers/promises';

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function parseModelJson(content) {
  if (typeof content !== 'string') throw new ProviderError('模型未返回文本，请检查模型是否支持视觉和 JSON 输出。');
  let value;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new ProviderError('模型返回了无效 JSON，本张图片未覆盖旧标签。'); }
  if (!value || !['bird', 'non_bird', 'no_animal', 'unclear'].includes(value.subject) || !Array.isArray(value.candidates) || value.candidates.length > 3
    || typeof value.needs_review !== 'boolean' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
    || !Array.isArray(value.evidence) || value.evidence.some(t => typeof t !== 'string')
    || !Array.isArray(value.missing_features) || value.missing_features.some(t => typeof t !== 'string')
    || value.candidates.some(t => !t || typeof t.english_name !== 'string' || typeof t.scientific_name !== 'string')
    || (value.image_adjustment !== undefined && !['none', 'brighten'].includes(value.image_adjustment))) throw new ProviderError('模型结果结构不正确，本张图片未覆盖旧标签。');
  return value;
}

export function buildChatRequest(config, { model, messages, stage = 'primary' }) {
  const body = { model, messages, response_format: { type: 'json_object' }, stream: false };
  if (new URL(config.baseUrl).hostname === 'api.deepseek.com') {
    // DeepSeek uses max_tokens, and defaults to high-effort thinking when omitted.
    body.max_tokens = stage === 'review' ? 8192 : 4096;
    body.thinking = { type: stage === 'review' ? 'enabled' : 'disabled' };
    if (stage === 'review') body.reasoning_effort = 'low';
  } else body.max_completion_tokens = 4096;
  return body;
}

export async function callVlm(config, { model, messages, signal, stage = 'primary', onUsage }, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const started = Date.now();
    const report = async (outcome, usage = null, httpStatus = null, actualModel = model) => {
      try { await onUsage?.({ kind: 'request', provider: config.baseUrl, model: actualModel, stage, attempt: attempt + 1, outcome, usage, httpStatus, durationMs: Date.now()-started }); }
      catch { /* Accounting must not prevent saving a recognition result. */ }
    };
    let response;
    const body = buildChatRequest(config, { model, messages, stage });
    try {
      response = await fetcher(`${config.baseUrl}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(90000)]),
      });
    } catch (error) {
      await report(signal?.aborted ? 'aborted' : 'transport_error');
      if (signal?.aborted) throw error;
      throw new ProviderError(error.name === 'TimeoutError' ? '模型请求超过 90 秒，请重试或更换模型。' : '无法连接模型 API，请检查 API 地址和网络。');
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after'));
      const errorBody = await response.json().catch(() => null);
      await report('http_error', errorBody?.usage, response.status);
      await delay(Math.min(30000, Math.max((2 ** attempt) * 1000, Number.isFinite(seconds) ? seconds * 1000 : 0)), undefined, { signal });
      continue;
    }
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      await report('http_error', errorBody?.usage, response.status);
      const hints = { 400: '请检查模型的图片、JSON 输出与输出长度参数是否兼容', 401: '请检查 API 密钥', 403: '账号无权访问该模型', 404: '请检查 API 地址（通常以 /v1 结尾）及模型名', 429: '触发模型限流，请降低并发或稍后继续' };
      const error = new ProviderError(`模型 API HTTP ${response.status}：${hints[response.status] || '服务暂不可用，请稍后重试'}。`, response.status === 401 || response.status === 403 ? 503 : 502);
      error.providerStatus = response.status;
      throw error;
    }
    let result;
    try { result = await response.json(); } catch { await report('invalid_output', null, response.status); throw new ProviderError('API 未返回有效 JSON。'); }
    let value;
    try {
      if (result.choices?.[0]?.finish_reason === 'length') throw new ProviderError(`模型输出被截断，超出 ${body.max_tokens ?? body.max_completion_tokens} 输出 token 上限。`);
      value = parseModelJson(result.choices?.[0]?.message?.content);
    } catch (error) { await report('invalid_output', result.usage, response.status, typeof result.model === 'string' ? result.model : model); throw error; }
    await report('ok', result.usage, response.status, typeof result.model === 'string' ? result.model : model);
    return { value, usage: result.usage ?? null };
  }
}
