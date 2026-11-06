import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Bird, Check, Download, HardDrive, ImagePlus, Pause, Play, Settings, ShieldCheck, X } from 'lucide-react';
import FilePanel from './FilePanel';
import MapPanel from './MapPanel';
import PreviewPanel from './PreviewPanel';
import type { Coordinates } from './types';
import { useImageLibrary } from './useImageLibrary';
import ReferenceBirdImport from './ReferenceBirdImport';
import type { BirdReferenceList } from './reference-list';
import ModelSettings from './ModelSettings';
import { useRecognition } from './useRecognition';
import UsagePanel from './UsagePanel';
import { captureDateError } from './capture-date';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('birdrecognizer-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [dateInputError, setDateInputError] = useState('');
  const dateError = dateInputError || captureDateError(capturedAt);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [notice, setNotice] = useState('');
  const [referenceList, setReferenceList] = useState<BirdReferenceList | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const { images, setImages, importFiles, chooseDirectory, restoreOrRetry, clearSelection, hasSelection, clearing, syncStatus, loading, onLabel, onEditStart, onEditEnd, onRetry, applyRecognition, markRecognition } = useImageLibrary(setNotice);
  const recognition = useRecognition(images, applyRecognition, markRecognition, setNotice);
  const batch = recognition.state;
  const batchText = batch.phase === 'preparing' ? '正在准备…' : batch.phase === 'idle' ? '准备就绪' : `${batch.phase === 'paused' ? '已暂停' : batch.phase === 'complete' ? '已完成' : '识别中'} ${batch.done}/${batch.total}`;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('birdrecognizer-theme', theme); } catch { /* Theme switching also works without storage. */ }
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setSelectedId(current => images.some(image => image.id === current) ? current : images[0]?.id ?? null);
  }, [images]);
  useEffect(() => setQuery(''), [images[0]?.workspaceId]);

  const filteredImages = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? images.filter(image => `${image.path} ${image.label}`.toLocaleLowerCase().includes(term)) : images;
  }, [images, query]);
  const selectedIndex = images.findIndex(image => image.id === selectedId);
  const selectedImage = images[selectedIndex];
  const labeledCount = images.filter(image => image.label.trim()).length;
  const retryCount = images.filter(image => image.retry).length;
  const onImageError = useCallback((id: string) => setImages(previous => previous.map(image => image.id === id ? { ...image, error: true } : image)), []);
  const navigate = useCallback((direction: number) => {
    if (!images.length) return;
    const index = images.findIndex(image => image.id === selectedId);
    const next = Math.min(images.length - 1, Math.max(0, index + direction));
    setSelectedId(images[next].id);
  }, [images, selectedId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], .leaflet-container, dialog') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="app-shell" onDragEnter={event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); dragDepth.current++; setDragging(true);
    }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDragLeave={event => {
      event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);
    }} onDrop={event => {
      event.preventDefault(); dragDepth.current = 0; setDragging(false);
      importFiles(Array.from(event.dataTransfer.files));
    }}>
      <header className="app-header"><div className="brand"><button className="brand-symbol theme-toggle" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={`切换到${theme === 'light' ? '夜间' : '日间'}模式`} aria-pressed={theme === 'dark'} title={`点击切换到${theme === 'light' ? '夜间' : '日间'}模式`}><Bird size={24} strokeWidth={1.5} /></button><span className="brand-wordmark">WildScene<span>FIELDNOTES</span></span></div><div className="local-indicator"><span className="status-dot" /><span>本地工作空间</span><HardDrive size={14} /></div></header>
      <main className="workspace">
        <div className="workspace-grid"><aside className="sidebar"><FilePanel images={images} filteredImages={filteredImages} selectedId={selectedId} query={query} onQueryChange={setQuery} onImportFolder={chooseDirectory} onImportFiles={() => filesInput.current?.click()} onClearSelection={async () => { recognition.cancel(); if (await clearSelection()) { setSelectedId(null); setQuery(''); if (filesInput.current) filesInput.current.value = ''; } }} hasSelection={hasSelection} clearing={clearing} onSelect={setSelectedId} onLabel={onLabel} onEditStart={onEditStart} onEditEnd={onEditEnd} syncStatus={syncStatus} onSyncRetry={restoreOrRetry} loading={loading} onImageError={onImageError} onRetry={(id, value) => onRetry(new Set([id]), value)} onRetryAll={value => onRetry(new Set(filteredImages.map(image => image.id)), value)} /><MapPanel capturedAt={capturedAt} dateError={dateError} disabled={recognition.busy} coordinates={coordinates} onCapturedAtChange={(value, error) => { setCapturedAt(value); setDateInputError(error); }} onCoordinatesChange={setCoordinates} /></aside><div className="preview-column">
          <div className="workspace-toolbar"><div className="action-toolbar"><ReferenceBirdImport value={referenceList} onChange={setReferenceList} onNotice={setNotice} /><span className="batch-status" role="status" title={`待确认 ${batch.uncertain} 张 · 失败 ${batch.failed} 张 · 正在处理 ${batch.active} 张`}><span className="status-dot" />{batchText}</span><button className="icon-button model-settings-button" disabled={batch.phase === 'running' || batch.phase === 'preparing' || batch.active > 0} title="模型设置" aria-label="模型设置" onClick={() => setSettingsOpen(true)}><Settings size={17} /></button><button className="button start-button" disabled={Boolean(dateError) || loading || clearing || settingsOpen || (recognition.busy && batch.phase !== 'paused') || (batch.phase !== 'paused' && !images.some(image => image.writable && !image.error && (!image.label.trim() || image.retry)))} title="识别所有未标注或已勾选重识别的图片" onClick={() => void recognition.start({ location: '', coordinates, capturedAt, reference: referenceList ? { fileName: referenceList.fileName, columns: referenceList.columns, records: referenceList.records } : null })}><Play size={15} fill="currentColor" />{batch.phase === 'paused' ? '继续' : '开始'}</button><button className="button pause-button" disabled={batch.phase !== 'running'} title="暂停派发新图片，正在处理的图片会完成保存" onClick={recognition.pause}><Pause size={15} />暂停</button><button className="icon-button model-settings-button" title="API 用量" aria-label="API 用量" onClick={() => setUsageOpen(true)}><BarChart3 size={17} /></button><span className="action-divider" /><button className="button export-button" disabled title="导出功能尚未接入"><Download size={16} />导出已完成</button></div></div>
          {batch.phase !== 'idle' && <div className="recognition-progress" role="status"><progress max={batch.total || 1} value={batch.done} aria-label="识别进度" /><span>{batch.done}/{batch.total} · 待确认 {batch.uncertain} · 失败 {batch.failed}{batch.phase === 'paused' && batch.active ? ' · 当前图片正在收尾' : ''}</span></div>}
          <PreviewPanel image={selectedImage} index={selectedIndex} total={images.length} onNavigate={navigate} onLabel={onLabel} onEditStart={onEditStart} onEditEnd={onEditEnd} onImageError={onImageError} /></div></div>
        <footer className="workspace-footer"><span><ShieldCheck size={14} />本地标签 · 识别时调用所配置 API</span><span className="footer-stats"><span><span className="mini-dot" />{images.length} 张图片</span><span>{labeledCount} 张已标注</span><span>{retryCount} 张待重新识别</span></span><span className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> 切换图片</span></footer>
      </main>
      <input className="visually-hidden" tabIndex={-1} ref={filesInput} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.bmp" onChange={event => { importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {notice && <div className="toast" role="status"><Check size={16} /><span>{notice}</span><button className="icon-button tiny" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {settingsOpen && <ModelSettings onClose={() => setSettingsOpen(false)} onNotice={setNotice} />}
      {usageOpen && <UsagePanel contextId={batch.contextId} onClose={() => setUsageOpen(false)} />}
      {dragging && <div className="drop-overlay"><div><ImagePlus size={40} strokeWidth={1.2} /><h2>将图片放在这里</h2><p>松开即可添加到当前列表</p></div></div>}
      <div className="visually-hidden" aria-live="polite">{selectedImage ? `当前图片：${selectedImage.file.name}` : '尚未导入图片'}</div>
    </div>
  );
}
