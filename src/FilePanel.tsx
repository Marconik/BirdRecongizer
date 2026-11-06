import { useEffect, useRef, useState } from 'react';
import { Check, FileImage, FolderOpen, ImagePlus, Images, Search, X } from 'lucide-react';
import type { ImageItem } from './types';
import type { SyncStatus } from './useImageLibrary';

interface Props {
  images: ImageItem[];
  filteredImages: ImageItem[];
  selectedId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onImportFolder: () => void;
  onImportFiles: () => void;
  onClearSelection: () => void;
  hasSelection: boolean;
  clearing: boolean;
  onSelect: (id: string) => void;
  onLabel: (id: string, label: string) => void;
  onEditStart: (id: string) => void;
  onEditEnd: (id: string) => void;
  syncStatus: SyncStatus;
  onSyncRetry: () => void;
  loading: boolean;
  onRetry: (id: string, value: boolean) => void;
  onRetryAll: (value: boolean) => void;
  onImageError: (id: string) => void;
}

const ROW_HEIGHT = 72;

export default function FilePanel({ images, filteredImages, selectedId, query, onQueryChange, onImportFolder, onImportFiles, onClearSelection, hasSelection, clearing, onSelect, onLabel, onEditStart, onEditEnd, syncStatus, onSyncRetry, loading, onRetry, onRetryAll, onImageError }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const lastSelectedId = useRef(selectedId);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);
  const [bodyWidth, setBodyWidth] = useState(0);
  const retryCount = filteredImages.filter(image => image.retry).length;
  const libraryId = images[0]?.id;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3);
  const end = Math.min(filteredImages.length, start + Math.ceil(height / ROW_HEIGHT) + 7);

  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
      setBodyWidth(entry.contentRect.width);
    });
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (allCheckbox.current) allCheckbox.current.indeterminate = retryCount > 0 && retryCount < filteredImages.length;
  }, [retryCount, filteredImages.length]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [query, libraryId]);

  useEffect(() => {
    // Tag polling changes the array identity even when selection stays the same.
    // Only a new selected image should take control of the user's scroll position.
    if (lastSelectedId.current === selectedId) return;
    lastSelectedId.current = selectedId;
    const index = filteredImages.findIndex(image => image.id === selectedId);
    const container = scroller.current;
    if (!container || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < container.scrollTop) container.scrollTo({ top });
    else if (top + ROW_HEIGHT > container.scrollTop + container.clientHeight) container.scrollTo({ top: top + ROW_HEIGHT - container.clientHeight });
  }, [selectedId, filteredImages]);

  return (
    <section className="panel file-panel" aria-labelledby="files-heading">
      <div className="panel-heading file-panel-heading">
        <div className="heading-title"><Images size={17} /><h2 id="files-heading">图片文件</h2><span className="count-badge">{images.length}</span></div>
        <div className="file-import-actions">
          <button className="button import-button" disabled={loading || clearing} onClick={onImportFolder}><FolderOpen size={15} />{loading ? '正在打开…' : '选择文件夹'}</button>
          <button className="icon-button add-files-button" disabled={loading || clearing} aria-label="选择图片文件" title="添加图片" onClick={onImportFiles}><ImagePlus size={17} /></button>
          <button className="icon-button add-files-button clear-selection-button" disabled={!hasSelection || loading || clearing} aria-label="取消当前文件选择" aria-busy={clearing} title="取消当前文件夹或图片选择，保留图片和标签" onClick={onClearSelection}><X size={17} /></button>
        </div>
      </div>
      {(syncStatus.error || syncStatus.restore) && <div className={`library-sync${syncStatus.error ? ' sync-error' : ''}`} role={syncStatus.error ? 'alert' : 'status'}>
        <span>{syncStatus.text}</span>
        <button className="text-button" onClick={onSyncRetry}>{syncStatus.restore ? '继续打开' : '重试'}</button>
      </div>}
      <div className="file-search">
        <Search size={15} aria-hidden="true" />
        <input aria-label="搜索文件或标签" placeholder="搜索文件名或标签…" value={query} onChange={event => onQueryChange(event.target.value)} />
        {query && <button className="icon-button tiny" aria-label="清空搜索" onClick={() => onQueryChange('')}><X size={14} /></button>}
      </div>
      <div className="file-table" role="table" aria-label="图片文件列表" aria-rowcount={filteredImages.length + 1} aria-colcount={3}>
        <div role="row" className="file-table-head file-grid" style={bodyWidth ? { width: bodyWidth } : undefined}>
          <span role="columnheader">文件列表</span>
          <span role="columnheader">物种标签</span>
          <span role="columnheader" className="retry-heading"><label title="勾选当前列表的所有图片"><input ref={allCheckbox} type="checkbox" aria-label="全部勾选重新识别" disabled={!filteredImages.some(image => image.writable)} checked={filteredImages.length > 0 && retryCount === filteredImages.length} onChange={event => onRetryAll(event.target.checked)} /><span>重识别</span></label></span>
        </div>
        <div ref={scroller} className="file-scroll" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
          <div className="file-body" style={{ height: Math.max(filteredImages.length * ROW_HEIGHT, height) }}>
            <div className="file-column-guides file-grid" aria-hidden="true"><span /><span /><span /></div>
          {images.length === 0 ? (
            <div className="files-empty">
              <div className="empty-folder"><FolderOpen size={29} strokeWidth={1.3} /><span className="empty-folder-dot"><Check size={10} /></span></div>
              <strong>从一组照片开始</strong>
              <p>选择文件夹，或将图片拖到这里</p>
              <button className="small-button" onClick={onImportFolder}><FolderOpen size={14} /> 选择文件夹</button>
              <span className="supported-formats">JPG · PNG · WEBP · GIF · AVIF · BMP</span>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="files-empty no-results"><Search size={25} strokeWidth={1.4} /><strong>没有匹配的图片</strong><p>试试其他文件名或标签</p><button className="text-button" onClick={() => onQueryChange('')}>清空搜索</button></div>
          ) : (
            <div role="rowgroup" className="virtual-file-list" style={{ height: filteredImages.length * ROW_HEIGHT }}>
              {filteredImages.slice(start, end).map((image, offset) => (
                <div role="row" aria-rowindex={start + offset + 2} key={image.id} className={`file-row file-grid ${selectedId === image.id ? 'selected' : ''}`} style={{ top: (start + offset) * ROW_HEIGHT }}>
                  <div role="cell" className="file-name-cell">
                    <button className="file-select" onClick={() => onSelect(image.id)} aria-label={`预览 ${image.path}`} aria-pressed={selectedId === image.id} title={image.path}>
                      <span className="thumbnail">{image.error ? <FileImage size={19} /> : <img src={image.url} alt="" loading="lazy" decoding="async" onError={() => onImageError(image.id)} />}</span>
                      <span className="file-name-text"><strong>{image.file.name}</strong><span title={image.recognition?.reason}>{image.recognition ? { running: '识别中…', confirmed: '已识别 · eBird v2026', needs_review: '待确认', error: '识别失败', skipped: '保留手动编辑' }[image.recognition.status] : image.error ? '无法预览' : image.file.size < 1024 * 1024 ? `${Math.max(1, Math.round(image.file.size / 1024))} KB` : `${(image.file.size / (1024 * 1024)).toFixed(1)} MB`}</span></span>
                    </button>
                  </div>
                  <div role="cell" className="file-label-cell"><input aria-label={`${image.path} 的标签`} value={image.label} disabled={!image.writable} onFocus={() => onEditStart(image.id)} onBlur={() => onEditEnd(image.id)} onChange={event => onLabel(image.id, event.target.value)} placeholder="待标注" title={image.writable ? image.label || '多个标签用逗号分隔，自动保存' : '请选择图片所在文件夹以保存标签'} /></div>
                  <div role="cell" className="retry-cell"><input type="checkbox" aria-label={`重新识别 ${image.path}`} disabled={!image.writable} checked={image.retry} onChange={event => onRetry(image.id, event.target.checked)} /></div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
      <div className="file-list-footer"><span>{query ? `匹配 ${filteredImages.length} 张` : `共 ${images.length} 张图片`}</span><span>{images.filter(image => image.retry).length} 张待重新识别</span></div>
    </section>
  );
}
