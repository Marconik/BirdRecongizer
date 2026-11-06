import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem } from './types';
import { api, ApiError, encodeImage, type ModelSettings, type RecognitionContext, type RecognitionResult } from './recognition-api';
import { RecognitionQueue } from './recognition-queue';
import { captureDateError } from './capture-date';

interface BatchState { phase: 'idle' | 'preparing' | 'running' | 'paused' | 'complete'; total: number; done: number; failed: number; uncertain: number; active: number; contextId: string | null }
const INITIAL: BatchState = { phase: 'idle', total: 0, done: 0, failed: 0, uncertain: 0, active: 0, contextId: null };
export function useRecognition(images: ImageItem[], apply: (image: ImageItem, result: RecognitionResult) => Promise<boolean>, mark: (id: string, state: NonNullable<ImageItem['recognition']>) => void, notice: (message: string) => void) {
  const [state, setState] = useState(INITIAL);
  const queue = useRef<RecognitionQueue<ImageItem> | null>(null);
  const abort = useRef(new AbortController());
  const busy = useRef(false);
  const workspace = images[0]?.workspaceId;
  const libraryIdentity = images[0]?.id;
  const liveImages = useRef(images); liveImages.current = images;
  const liveApply = useRef(apply); liveApply.current = apply;
  const liveMark = useRef(mark); liveMark.current = mark;

  useEffect(() => {
    queue.current?.stop(); queue.current = null; abort.current.abort(); busy.current = false;
    setState(INITIAL);
    return () => { queue.current?.stop(); abort.current.abort(); };
  }, [workspace, libraryIdentity]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (busy.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, []);

  const start = useCallback(async (context: RecognitionContext) => {
    const dateError = captureDateError(context.capturedAt);
    if (dateError) { notice(dateError); return; }
    if (queue.current && state.phase === 'paused') { queue.current.start(); return; }
    if (busy.current) return;
    const targets = liveImages.current.filter(image => image.writable && !image.error && (!image.label.trim() || image.retry)).map(image => ({ ...image }));
    if (!targets.length) { notice('没有待识别图片。请选择可写文件夹，或勾选需要重识别的图片。'); return; }
    busy.current = true; abort.current = new AbortController(); const signal = abort.current.signal;
    setState({ ...INITIAL, phase: 'preparing', total: targets.length });
    try {
      const settings = await api<ModelSettings>('status', 'GET', undefined, signal);
      if (!settings.configured) throw new Error('请先打开“模型设置”，填写 API 密钥和模型名。');
      if (!settings.taxonomyReady) throw new Error(settings.taxonomyError);
      const { contextId } = await api<{ contextId: string }>('context', 'POST', context, signal);
      if (signal.aborted) return;
      setState(s => ({ ...s, contextId }));
      const currentQueue = new RecognitionQueue(targets, settings.concurrency, async image => {
        if (signal.aborted) return;
        // A queued image can have been edited before its request was dispatched.
        const current = liveImages.current.find(item => item.id === image.id);
        if (!current || current.label !== image.label || current.editRevision !== image.editRevision) { setState(s => ({ ...s, done: s.done + 1 })); return; }
        liveMark.current(image.id, { status: 'running', reason: '正在识别…' });
        try {
          const bytes = await encodeImage(image.file);
          if (signal.aborted) return;
          const result = await api<RecognitionResult>('recognize', 'POST', { image: bytes, contextId, force: image.retry }, signal);
          if (signal.aborted) return;
          const saved = await liveApply.current(image, result);
          if (signal.aborted) return;
          if (!saved) liveMark.current(image.id, { status: 'skipped', reason: '识别期间标签发生修改，已保留当前编辑。' });
          setState(s => ({ ...s, done: s.done + 1, uncertain: s.uncertain + (saved && result.retry ? 1 : 0) }));
        } catch (error) {
          if (signal.aborted) return;
          liveMark.current(image.id, { status: 'error', reason: error instanceof Error ? error.message : '识别失败，请重试。' });
          setState(s => ({ ...s, done: s.done + 1, failed: s.failed + 1 }));
          if (error instanceof ApiError && error.fatal) { currentQueue.pause(); notice(error.message); }
        }
      }, (pending, active, paused) => {
        if (signal.aborted) return;
        const complete = !pending && !active;
        if (complete) busy.current = false;
        setState(s => ({ ...s, active, phase: complete ? 'complete' : paused ? 'paused' : 'running' }));
      });
      queue.current = currentQueue; currentQueue.start();
    } catch (error) { if (!signal.aborted) { busy.current = false; setState(INITIAL); notice(error instanceof Error ? error.message : '无法启动识别。'); } }
  }, [state.phase, notice]);
  const pause = useCallback(() => queue.current?.pause(), []);
  const cancel = useCallback(() => {
    queue.current?.stop(); queue.current = null;
    abort.current.abort(); busy.current = false;
    setState(INITIAL);
  }, []);
  return { state, start, pause, cancel, busy: ['preparing', 'running', 'paused'].includes(state.phase) };
}
