import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Settings, Upload, X } from 'lucide-react';
import { api, type ModelSettings as SettingsValue } from './recognition-api';

interface Props { onClose: () => void; onNotice: (message: string) => void }
export default function ModelSettings({ onClose, onNotice }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const taxonomyInput = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<SettingsValue | null>(null);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState(''); const [reviewModel, setReviewModel] = useState('');
  const [key, setKey] = useState(''); const [concurrency, setConcurrency] = useState(4);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal(); let active = true;
    void api<SettingsValue>('status').then(value => {
      if (!active) return;
      setSettings(value); setBaseUrl(value.baseUrl); setModel(value.model); setReviewModel(value.reviewModel); setConcurrency(value.concurrency);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return <dialog className="model-dialog" ref={dialog} onCancel={event => { if (saving) event.preventDefault(); else onClose(); }} aria-labelledby="model-settings-title">
    <form onSubmit={async event => {
      event.preventDefault(); setSaving(true); setError('');
      try {
        await api('config', 'PUT', { baseUrl, model, reviewModel, apiKey: key, concurrency });
        setKey(''); onNotice('模型配置已保存到本机。'); onClose();
      } catch (e) { setError(e instanceof Error ? e.message : '配置保存失败。'); }
      finally { setSaving(false); }
    }}>
      <header><h2 id="model-settings-title"><Settings size={18} />模型设置</h2><button className="icon-button" type="button" disabled={saving} aria-label="关闭模型设置" onClick={onClose}><X size={18} /></button></header>
      <p className="settings-intro">识别时会将图片推理副本及地点、参考信息发送至你配置的 API。原始照片保持不变。</p>
      <label>API 地址<input type="url" value={baseUrl} required onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" /></label>
      <label>API 密钥<input type="password" autoComplete="new-password" value={key} required={!settings?.hasApiKey || baseUrl !== settings?.baseUrl} onChange={e => setKey(e.target.value)} placeholder={settings?.hasApiKey ? '已保存；留空保留原密钥，修改地址时需重新填写' : '输入 API Key'} /></label>
      <label>主模型<input value={model} required onChange={e => setModel(e.target.value)} placeholder="填写服务商提供的视觉模型 ID" /></label>
      <div className="settings-row"><label>复核模型（可选）<input value={reviewModel} onChange={e => setReviewModel(e.target.value)} placeholder="留空使用主模型" /></label><label>并发图片数<input type="number" min="1" max="8" value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} /></label></div>
      <p className="settings-hint">模型须支持图片输入、Chat Completions 和 JSON mode。密钥仅保存在本机 data/config.json；网页不会读取已保存的密钥。</p>
      <section className="taxonomy-settings"><strong>eBird v2026 · English</strong><p>{settings?.taxonomyReady ? `分类表已就绪 · ${settings.taxonomyCount.toLocaleString()} 个分类条目` : settings?.taxonomyError || '正在检查分类表…'}</p>
        <div><a href={settings?.taxonomyUrl || 'https://www.birds.cornell.edu/clementschecklist/download/'} target="_blank" rel="noreferrer"><ExternalLink size={14} />官方 CSV</a><button className="small-button" type="button" disabled={saving || !settings} onClick={() => taxonomyInput.current?.click()}><Upload size={14} />导入 v2026 分类表</button></div>
        <input ref={taxonomyInput} type="file" accept=".csv" className="visually-hidden" tabIndex={-1} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          setSaving(true); setError('');
          try {
            if (file.size > 16 * 1024 * 1024) throw new Error('分类 CSV 不能超过 16 MB。');
            await api('taxonomy', 'PUT', { fileName: file.name, csv: await file.text() });
            setSettings(await api<SettingsValue>('status')); onNotice('eBird v2026 分类表已安装。');
          } catch (e) { setError(e instanceof Error ? e.message : '分类表导入失败。'); }
          finally { setSaving(false); }
        }} />
      </section>
      {error && <p className="settings-error" role="alert">{error}</p>}
      <footer><button type="button" className="button" disabled={saving} onClick={onClose}>取消</button><button className="button start-button" disabled={saving || !settings}>{saving ? '正在处理…' : '保存配置'}</button></footer>
    </form>
  </dialog>;
}
