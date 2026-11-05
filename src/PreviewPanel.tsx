import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Expand, Eye, EyeOff, Image as ImageIcon, Maximize2, Minus, Plus, RotateCcw, Tag } from 'lucide-react';
import type { ImageItem } from './types';

interface Props {
  image: ImageItem | undefined;
  index: number;
  total: number;
  onNavigate: (direction: number) => void;
  onLabel: (id: string, label: string) => void;
  onEditStart: (id: string) => void;
  onEditEnd: (id: string) => void;
  onImageError: (id: string) => void;
}

export default function PreviewPanel({ image, index, total, onNavigate, onLabel, onEditStart, onEditEnd, onImageError }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showLabel, setShowLabel] = useState(true);
  const [dimensions, setDimensions] = useState<{ imageId: string; width: number; height: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');

  useEffect(() => { setZoom(1); }, [image?.id]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === viewport.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const changeZoom = (change: number) => setZoom(value => Math.min(3, Math.max(0.5, Number((value + change).toFixed(2)))));
  const currentDimensions = dimensions?.imageId === image?.id ? dimensions : null;
  const isPortrait = Boolean(!image?.error && currentDimensions && currentDimensions.height > currentDimensions.width);
  const portraitHeight = isPortrait && currentDimensions && viewportWidth > 0
    ? Math.ceil(viewportWidth * currentDimensions.height / currentDimensions.width)
    : undefined;

  return (
    <section className={`panel preview-panel${isPortrait ? ' is-portrait' : ''}`} aria-labelledby="preview-heading">
      <div className="panel-heading preview-heading">
        <div className="heading-title"><ImageIcon size={17} /><h2 id="preview-heading">图片预览</h2><span className="preview-file-name" title={image?.path}>{image?.file.name}</span></div>
        <div className="preview-pagination"><span>{image ? index + 1 : 0}<span className="muted"> / {total}</span></span><button className="icon-button" aria-label="上一张图片" disabled={index <= 0} onClick={() => onNavigate(-1)}><ArrowLeft size={16} /></button><button className="icon-button" aria-label="下一张图片" disabled={index < 0 || index >= total - 1} onClick={() => onNavigate(1)}><ArrowRight size={16} /></button></div>
      </div>
      <div className={`preview-viewport ${image ? 'has-image' : ''}`} ref={viewport} style={!fullscreen && portraitHeight ? { height: portraitHeight } : undefined}>
        <div className="preview-corner corner-tl" /><div className="preview-corner corner-tr" /><div className="preview-corner corner-bl" /><div className="preview-corner corner-br" />
        {showLabel && image?.label.trim() && <div className="image-label is-labeled"><Tag size={14} /><span>{image.label.trim()}</span></div>}
        {image ? image.error ? (
          <div className="preview-empty"><ImageIcon size={43} strokeWidth={1.1} /><h3>这张图片暂时无法预览</h3><p>文件可能已损坏，或浏览器不支持其编码</p><p>你仍可编辑标签或切换到其他图片</p></div>
        ) : (
          <div className="image-scroll" key={image.id}>
            <div className="image-stage" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img className="preview-image" src={image.url} alt={image.label.trim() ? `${image.file.name}，标签：${image.label}` : image.file.name} onLoad={event => setDimensions({ imageId: image.id, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => onImageError(image.id)} draggable={false} />
            </div>
          </div>
        ) : (
          <div className="preview-empty"><div className="preview-empty-icon"><ImageIcon size={43} strokeWidth={1.1} /><span className="decorative-plus">+</span></div><h3>让每一张照片，都有名字</h3><p>导入图片后，在这里查看主体与物种标签</p><span className="preview-empty-tip">支持文件夹导入 · 图片仅在本机预览</span></div>
        )}
        <div className="preview-tools">
          <div className="preview-view-tools"><button className="dark-icon-button" onClick={() => setShowLabel(value => !value)} aria-label={showLabel ? '隐藏图片标签' : '显示图片标签'} title={showLabel ? '隐藏标签' : '显示标签'}>{showLabel ? <Eye size={16} /> : <EyeOff size={16} />}</button><span className="tool-divider" /><button className="dark-icon-button" disabled={!image || image.error} aria-label="适应窗口" title="适应窗口" onClick={() => setZoom(1)}><Maximize2 size={15} /></button></div>
          <div className="zoom-tools"><button className="dark-icon-button" disabled={!image || image.error || zoom <= 0.5} aria-label="缩小图片" onClick={() => changeZoom(-0.25)}><Minus size={15} /></button><span className="zoom-value">{Math.round(zoom * 100)}%</span><button className="dark-icon-button" disabled={!image || image.error || zoom >= 3} aria-label="放大图片" onClick={() => changeZoom(0.25)}><Plus size={15} /></button><span className="tool-divider" /><button className="dark-icon-button fullscreen-button" aria-label={fullscreen ? '退出全屏预览' : '全屏预览'} title={fullscreen ? '退出全屏' : '全屏预览'} onClick={async () => {
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await viewport.current?.requestFullscreen();
              setFullscreenError('');
            } catch { setFullscreenError('当前浏览器暂不支持全屏预览'); }
          }}><Expand size={15} /></button></div>
        </div>
        {fullscreenError && <p className="fullscreen-error" role="status">{fullscreenError}</p>}
      </div>
      <div className="preview-meta"><span className="preview-meta-name">{image ? image.path : '尚未选择图片'}</span><span>{currentDimensions ? `${currentDimensions.width.toLocaleString()} × ${currentDimensions.height.toLocaleString()} px` : '—'}</span></div>
      <div className="annotation-bar"><div className="annotation-input"><label htmlFor="active-label"><Tag size={16} />物种标签</label><input id="active-label" value={image?.label ?? ''} disabled={!image?.writable} onFocus={() => image && onEditStart(image.id)} onBlur={() => image && onEditEnd(image.id)} onChange={event => image && onLabel(image.id, event.target.value)} placeholder={image?.writable ? '多个标签用逗号分隔，自动保存' : '选择图片文件夹后可编辑标签'} /></div><span className={`annotation-status ${image?.label.trim() ? 'has-label' : ''}`}>{image?.label.trim() ? <><Tag size={12} /> 已标注</> : <><RotateCcw size={12} /> 待标注</>}</span></div>
    </section>
  );
}
