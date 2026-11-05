import { useRef, useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import { MAX_REFERENCE_BYTES, parseReferenceList, type BirdReferenceList } from './reference-list';

interface Props {
  value: BirdReferenceList | null;
  onChange: (list: BirdReferenceList | null) => void;
  onNotice: (message: string) => void;
}

export default function ReferenceBirdImport({ value, onChange, onNotice }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function importList(file: File) {
    setLoading(true);
    setError('');
    try {
      if (file.size > MAX_REFERENCE_BYTES) throw new Error('参考列表不能超过 10 MB。');
      const list = parseReferenceList(await file.arrayBuffer(), file.name);
      onChange(list);
      onNotice(`已导入参考列表「${file.name}」，共 ${list.records.length.toLocaleString()} 条。`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '参考列表导入失败，请重试。';
      setError(message);
      onNotice(message);
    } finally { setLoading(false); }
  }

  return (
    <div className="reference-import">
      <div className="reference-import-controls">
        <button className={`button reference-import-button${value ? ' has-reference' : ''}`} disabled={loading} onClick={() => input.current?.click()} aria-label={value ? '更换参考鸟类列表' : '导入参考鸟类列表'} title={value ? `参考列表：${value.fileName}（点击更换）` : '导入 CSV 或 TXT 参考鸟类列表'}>
          <ListPlus size={16} />
          <span className="reference-file-name">{loading ? '正在导入…' : value?.fileName ?? '导入参考鸟类列表'}</span>
          {value && <span className="reference-count">{value.records.length.toLocaleString()} 条</span>}
        </button>
        {value && <button className="icon-button reference-remove" disabled={loading} aria-label="移除参考鸟类列表" title="移除参考列表" onClick={() => { onChange(null); setError(''); onNotice('已移除参考列表。'); }}><X size={14} /></button>}
      </div>
      {error && <span className="reference-import-error" role="alert">{error}</span>}
      <span className="visually-hidden" role="status">{value ? `已导入参考列表 ${value.fileName}，${value.records.length} 条` : '尚未导入参考鸟类列表'}</span>
      <input ref={input} className="visually-hidden" tabIndex={-1} type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="参考鸟类列表文件" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void importList(file);
      }} />
    </div>
  );
}
