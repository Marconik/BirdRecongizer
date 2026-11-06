import { useEffect, useRef, useState } from 'react';
import { BarChart3, RefreshCw, X } from 'lucide-react';
import { api } from './recognition-api';

interface UsageCounters {
  processedImages: number; inferences: number; primaryInferences: number; reviewInferences: number;
  requests: number; successfulRequests: number; failedRequests: number;
  primaryRequests: number; reviewRequests: number; retryRequests: number; cacheHits: number;
  inputTokens: number; outputTokens: number; totalTokens: number;
  cachedInputTokens: number; reasoningTokens: number; missingUsageRequests: number;
  inputReports: number; outputReports: number; totalReports: number; cachedReports: number; reasoningReports: number;
}
interface UsageSummary extends UsageCounters {
  models: (UsageCounters & { model: string; provider: string })[];
  averageRequestMs: number | null; since: string | null; updatedAt: string | null;
  storageError: string; corruptRecords: number; pendingRecords: number;
  imageTrackingSince: string | null; legacyProcessingRecords: number;
}
const number = (value = 0) => value.toLocaleString('zh-CN');
export default function UsagePanel({ contextId, onClose }: { contextId: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [range, setRange] = useState<'all' | 'batch'>(contextId ? 'batch' : 'all');
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true, pending = false;
    const abort = new AbortController(); setData(null); setError('');
    const load = async () => {
      if (pending) return; pending = true;
      try {
        const result = await api<UsageSummary>(`usage${range === 'batch' && contextId ? `?contextId=${encodeURIComponent(contextId)}` : ''}`, 'GET', undefined, abort.signal);
        if (active) { setData(result); setError(''); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '无法读取用量。'); }
      finally { pending = false; }
    };
    void load();
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(tick, 2000);
    document.addEventListener('visibilitychange', tick);
    return () => { active = false; abort.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [range, contextId, refresh]);
  const tokenText = (value: number, reports: number) => data?.requests && !reports ? '—' : number(value);
  return <dialog ref={dialog} className="model-dialog usage-dialog" aria-labelledby="usage-title" onCancel={onClose}>
    <div className="usage-content">
      <header><h2 id="usage-title"><BarChart3 size={22} />API 用量</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭 API 用量"><X size={18} /></button></header>
      <p className="settings-intro">统计本工具发出的请求及服务商返回的 token，每 2 秒更新。金额、余额与最终账单请以服务商控制台为准。</p>
      <div className="usage-controls"><div className="usage-ranges" role="group" aria-label="统计范围"><button type="button" aria-pressed={range === 'all'} onClick={() => setRange('all')}>累计用量</button><button type="button" disabled={!contextId} aria-pressed={range === 'batch'} onClick={() => setRange('batch')}>本批用量</button></div><button type="button" className="icon-button" aria-label="刷新用量" title="刷新用量" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} /></button></div>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {!data && !error && <p className="settings-intro" role="status">正在读取用量…</p>}
      {data && <>
        <div className="usage-grid">
          <div className="usage-card"><span>累计处理次数</span><strong>{number(data.processedImages)}</strong><small>每次处理图片计一次，重新处理另计</small></div>
          <div className="usage-card"><span>推理次数</span><strong>{number(data.inferences)}</strong><small>首轮 {number(data.primaryInferences)} · 复核 {number(data.reviewInferences)}</small></div>
          <div className="usage-card"><span>API 请求</span><strong>{number(data.requests)}</strong><small>含 {number(data.retryRequests)} 次网络重试请求</small></div>
          <div className="usage-card"><span>本地结果缓存命中</span><strong>{number(data.cacheHits)}</strong><small>计入图片处理，不增加推理或 API 请求</small></div>
        </div>
        <div className="usage-grid usage-token-grid" aria-label="Token 用量">
          <div className="usage-card"><span>已报告总 token</span><strong>{tokenText(data.totalTokens, data.totalReports)}</strong><small>输入与输出合计</small></div>
          <div className="usage-card"><span>已报告输入 token</span><strong>{tokenText(data.inputTokens, data.inputReports)}</strong><small>其中缓存输入 {data.cachedReports ? number(data.cachedInputTokens) : '未报告'}</small></div>
          <div className="usage-card"><span>已报告输出 token</span><strong>{tokenText(data.outputTokens, data.outputReports)}</strong><small>其中推理 {data.reasoningReports ? number(data.reasoningTokens) : '未报告'}</small></div>
        </div>
        <dl className="usage-facts"><div><dt>失败 / 异常响应</dt><dd>{number(data.failedRequests)} 次</dd></div><div><dt>平均请求耗时</dt><dd>{data.averageRequestMs === null ? '—' : `${(data.averageRequestMs/1000).toFixed(1)} 秒`}</dd></div></dl>
        {data.legacyProcessingRecords > 0 && <p className="usage-warning">旧版记录缺少图片处理标识，累计处理次数只统计本次功能更新后的处理；旧 API 请求、缓存命中和可还原的推理次数仍保留。</p>}
        {data.missingUsageRequests > 0 && <p className="usage-warning" role="status">{number(data.missingUsageRequests)} 次请求未完整返回 token 用量，上方仅合计已报告数据。超时、取消或失败不代表一定没有计费。</p>}
        {(data.storageError || data.corruptRecords > 0) && <p className="settings-error" role="alert">{data.storageError}{data.corruptRecords > 0 ? ` 有 ${number(data.corruptRecords)} 条历史记录损坏，统计未包含这些记录。` : ''}</p>}
        {data.models.length > 0 && <div className="usage-table-wrap"><table className="usage-table"><caption>按模型汇总</caption><thead><tr><th scope="col">模型 / API 地址</th><th scope="col">请求</th><th scope="col">输入 token</th><th scope="col">输出 token</th></tr></thead><tbody>{data.models.map(model => <tr key={`${model.provider}|${model.model}`}><th scope="row"><strong>{model.model}</strong><span>{model.provider}</span></th><td>{number(model.requests)}</td><td>{model.inputReports ? number(model.inputTokens) : '—'}</td><td>{model.outputReports ? number(model.outputTokens) : '—'}</td></tr>)}</tbody></table></div>}
        {!data.requests && !data.cacheHits && !data.processedImages && <p className="usage-empty">暂无记录。首次识别后会自动累计；启用本功能之前的调用不追溯计入。</p>}
        <p className="settings-hint">图片进入识别流程即计一次处理，失败或重新识别也计数。推理按首轮/复核轮次统计，不重复计算网络重试；API 请求统计已结束的请求，包含重试。缓存输入与推理 token 分别属于输入与输出，不重复累加。</p>
        {data.since && <p className="usage-period">记录范围：{new Date(data.since).toLocaleString('zh-CN')} — {new Date(data.updatedAt || data.since).toLocaleString('zh-CN')}</p>}
      </>}
      <footer><button type="button" className="button" onClick={onClose}>关闭</button></footer>
    </div>
  </dialog>;
}
