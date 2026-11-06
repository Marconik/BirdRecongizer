import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ImageItem } from './types';
import { cacheDirectory, clearCachedDirectory, directoryTagIO, readCachedDirectory, type CachedDirectory, type DirectoryHandle, type PickerWindow } from './storage/file-system';
import { RETRY_KEY, clearRetry, readRetry, writeRetry } from './storage/retry-cache';
import { TagsStore, splitLabels, type SaveState } from './storage/tags-store';
import type { RecognitionResult } from './recognition-api';
import { canApplyRecognition } from './recognition-policy';

const SUPPORTED_IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
interface Workspace { id: string; handle: DirectoryHandle; stores: Map<string, TagsStore>; states: Map<string, SaveState> }
export interface SyncStatus { text: string; error: boolean; pending: boolean; restore: boolean }
const INITIAL_STATUS: SyncStatus = { text: '选择图片文件夹，自动保存 tags.json', error: false, pending: false, restore: false };

export function useImageLibrary(onNotice: (message: string) => void) {
  const [images, reactSetImages] = useState<ImageItem[]>([]);
  const [syncStatus, setSyncStatus] = useState(INITIAL_STATUS);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const closing = useRef(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const setImages = useCallback((update: SetStateAction<ImageItem[]>) => {
    const next = typeof update === 'function' ? update(imagesRef.current) : update;
    imagesRef.current = next;
    reactSetImages(next);
  }, []);
  const workspace = useRef<Workspace | null>(null);
  const cached = useRef<CachedDirectory | undefined>(undefined);
  const urls = useRef(new Set<string>());
  const generation = useRef(0);
  const edit = useRef<{ id: string; dirty: boolean } | null>(null);
  const notice = useRef(onNotice);
  notice.current = onNotice;

  const publishStatus = useCallback(() => {
    const session = workspace.current;
    if (!session) return;
    const error = [...session.states.values()].find(state => state.error)?.error;
    const pending = [...session.states.values()].some(state => state.pending);
    setSyncStatus({ text: error || (pending ? '正在保存 tags.json…' : `${session.handle.name} · tags.json 已同步`), error: Boolean(error), pending, restore: false });
  }, []);

  const flush = useCallback(async () => {
    await Promise.all([...workspace.current?.stores.values() ?? []].map(store => store.flush()));
  }, []);

  const attachDirectory = useCallback(async (handle: DirectoryHandle, previous?: CachedDirectory, shouldContinue: () => boolean = () => true) => {
    const version = ++generation.current;
    setLoading(true);
    const records: { file: File; path: string; directoryKey: string }[] = [];
    const directories = new Map<string, DirectoryHandle>();
    const newUrls = new Set<string>();
    try {
      await flush();
      const sameFolder = previous ? await previous.handle.isSameEntry(handle) : false;
      const id = sameFolder ? previous!.id : crypto.randomUUID();
      const scan = async (directory: DirectoryHandle, prefix: string) => {
        for await (const entry of directory.values()) {
          if (entry.kind === 'directory') await scan(entry as DirectoryHandle, `${prefix}${entry.name}/`);
          else if (SUPPORTED_IMAGE.test(entry.name)) {
            const file = await (entry as FileSystemFileHandle).getFile();
            directories.set(prefix, directory);
            records.push({ file, path: `${handle.name}/${prefix}${file.name}`, directoryKey: prefix });
          }
        }
      };
      await scan(handle, '');
      if (!shouldContinue() || version !== generation.current) return;
      if (!sameFolder) { try { clearRetry(localStorage); } catch { /* No cached marks to restore. */ } }
      const marks = readRetry(localStorage, id);
      const imported = records.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true })).map(record => {
        const url = URL.createObjectURL(record.file);
        newUrls.add(url);
        return { ...record, id: crypto.randomUUID(), url, workspaceId: id, writable: true, label: '', retry: marks.has(record.path), error: false };
      });
      const old = workspace.current;
      old?.stores.forEach(store => store.dispose());
      const session: Workspace = { id, handle, stores: new Map(), states: new Map() };
      workspace.current = session;
      setHasSelection(true);
      const oldUrls = urls.current;
      urls.current = newUrls;
      edit.current = null;
      setImages(imported);
      oldUrls.forEach(url => URL.revokeObjectURL(url));
      for (const [key, directory] of directories) {
        const store = new TagsStore(directoryTagIO(directory), tags => {
          if (workspace.current !== session) return;
          setImages(current => current.map(image => {
            if (image.workspaceId !== id || image.directoryKey !== key || edit.current?.id === image.id) return image;
            const label = (tags[image.file.name] ?? []).join(', ');
            return image.label === label ? image : { ...image, label };
          }));
        }, state => {
          if (workspace.current !== session) return;
          session.states.set(key, state);
          publishStatus();
        });
        session.stores.set(key, store);
      }
      await Promise.all([...session.stores.values()].map(store => store.open().catch(() => undefined)));
      if (workspace.current !== session || version !== generation.current) return;
      cached.current = { id, handle };
      try { await cacheDirectory(cached.current); }
      catch { notice.current('文件夹已打开；浏览器未允许记住文件夹，下次刷新后请重新选择。'); }
      publishStatus();
      if (!imported.length) notice.current('这个文件夹中没有支持的图片。');
    } catch (error) {
      newUrls.forEach(url => { if (!urls.current.has(url)) URL.revokeObjectURL(url); });
      throw error;
    } finally { if (version === generation.current) setLoading(false); }
  }, [flush, publishStatus]);

  const chooseDirectory = useCallback(async () => {
    if (closing.current) return;
    const version = generation.current;
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      setSyncStatus({ text: '当前浏览器不支持文件夹读写，请在 Edge 或 Chrome 中打开本地应用。', pending: false, error: true, restore: false });
      return;
    }
    try {
      const handle = await picker.call(window, { mode: 'readwrite', id: 'birdrecognizer-images' });
      if (version !== generation.current || closing.current) return;
      const previous = cached.current ?? await readCachedDirectory().catch(() => undefined);
      if (version !== generation.current || closing.current) return;
      await attachDirectory(handle, previous);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSyncStatus({ text: error instanceof Error ? error.message : '无法打开文件夹，请检查读写权限。', error: true, pending: false, restore: false });
    }
  }, [attachDirectory]);

  const restoreOrRetry = useCallback(async () => {
    if (closing.current) return;
    const version = generation.current;
    try {
      if (workspace.current) {
        if (await workspace.current.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请允许文件夹读写，以保存和读取 tags.json。');
        await flush();
        await Promise.all([...workspace.current.stores.values()].map(store => store.refresh()));
        return;
      }
      const previous = cached.current;
      if (!previous) return;
      if (await previous.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请允许文件夹读写，以保存和读取 tags.json。');
      if (version !== generation.current || closing.current) return;
      await attachDirectory(previous.handle, previous);
    } catch (error) { setSyncStatus({ text: error instanceof Error ? error.message : '无法保存标签', error: true, pending: false, restore: !workspace.current }); }
  }, [attachDirectory, flush]);

  useEffect(() => {
    let active = true;
    const version = generation.current;
    void (async () => {
      try {
        const previous = await readCachedDirectory();
        if (!active || !previous || version !== generation.current) return;
        cached.current = previous;
        setHasSelection(true);
        const permission = await previous.handle.queryPermission({ mode: 'readwrite' });
        if (!active || version !== generation.current) return;
        if (permission === 'granted') {
          if (active) await attachDirectory(previous.handle, previous, () => active);
        } else if (active) setSyncStatus({ text: `继续打开「${previous.handle.name}」以恢复标签`, error: false, pending: false, restore: true });
      } catch { /* Folder selection remains available when IndexedDB is unavailable. */ }
    })();
    return () => { active = false; };
  }, [attachDirectory]);

  useEffect(() => {
    const syncMarks = () => {
      const session = workspace.current;
      if (!session) return;
      const marks = readRetry(localStorage, session.id);
      setImages(current => current.some(image => image.retry !== marks.has(image.path)) ? current.map(image => ({ ...image, retry: marks.has(image.path) })) : current);
    };
    const tick = () => {
      syncMarks();
      workspace.current?.stores.forEach(store => { void store.refresh().catch(() => undefined); });
    };
    const storageChanged = (event: StorageEvent) => { if (!event.key || event.key === RETRY_KEY) syncMarks(); };
    const visibilityChanged = () => { if (document.visibilityState === 'visible') tick(); else void flush().catch(() => undefined); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...workspace.current?.stores.values() ?? []].some(store => store.hasPending)) { event.preventDefault(); event.returnValue = ''; }
    };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', tick);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', tick);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [flush]);

  useEffect(() => () => {
    generation.current++;
    workspace.current?.stores.forEach(store => store.dispose());
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    if (closing.current) return;
    if (workspace.current) { notice.current('当前文件夹已自动载入全部图片；如需更换，请使用“选择文件夹”。'); return; }
    const accepted = files.filter(file => SUPPORTED_IMAGE.test(file.name));
    const imported = accepted.map(file => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { id: crypto.randomUUID(), file, path: file.webkitRelativePath || file.name, url, label: '', retry: false, error: false, writable: false };
    });
    setImages(current => [...current, ...imported]);
    if (imported.length) setHasSelection(true);
    setSyncStatus({ text: '只读预览：请选择图片所在文件夹，以读取和自动保存标签。', error: false, pending: false, restore: false });
    notice.current(`已添加 ${imported.length} 张预览图片；保存标签需要选择文件夹。`);
  }, []);

  const onLabel = useCallback((id: string, label: string) => {
    if (closing.current) return;
    const image = imagesRef.current.find(item => item.id === id);
    if (!image?.writable || image.workspaceId !== workspace.current?.id) return;
    if (edit.current?.id === id) edit.current.dirty = true;
    const next = imagesRef.current.map(item => item.id === id ? { ...item, label, editRevision: (item.editRevision ?? 0) + 1, recognition: undefined } : item);
    imagesRef.current = next;
    setImages(next);
    workspace.current?.stores.get(image.directoryKey ?? '')?.set(image.file.name, splitLabels(label));
  }, []);

  const onEditStart = useCallback((id: string) => { edit.current = { id, dirty: false }; }, []);
  const onEditEnd = useCallback((id: string) => {
    const image = imagesRef.current.find(item => item.id === id);
    if (!image || image.workspaceId !== workspace.current?.id) return;
    const store = workspace.current?.stores.get(image.directoryKey ?? '');
    const label = edit.current?.dirty ? splitLabels(image.label).join(', ') : (store?.snapshot[image.file.name] ?? []).join(', ');
    edit.current = null;
    setImages(current => current.map(item => item.id === id ? { ...item, label } : item));
    void store?.flush().catch(() => undefined);
  }, []);

  const onRetry = useCallback((ids: Set<string>, value: boolean) => {
    if (closing.current) return;
    const session = workspace.current;
    if (!session) return;
    const next = imagesRef.current.map(image => ids.has(image.id) ? { ...image, retry: value } : image);
    try { writeRetry(localStorage, session.id, next.filter(image => image.retry).map(image => image.path)); }
    catch { notice.current('浏览器缓存不可写，未保存重新识别勾选。'); return; }
    imagesRef.current = next;
    setImages(next);
  }, []);

  const markRecognition = useCallback((id: string, recognition: NonNullable<ImageItem['recognition']>) => {
    const session = workspace.current;
    if (!session) return;
    const next = imagesRef.current.map(image => image.id === id ? { ...image, recognition, ...(recognition.status === 'error' ? { retry: true } : {}) } : image);
    imagesRef.current = next; setImages(next);
    if (recognition.status === 'error') {
      try { writeRetry(localStorage, session.id, next.filter(image => image.retry).map(image => image.path)); } catch { notice.current('重识别标记未能写入浏览器缓存。'); }
    }
  }, []);

  const applyRecognition = useCallback(async (original: ImageItem, result: RecognitionResult) => {
    if (closing.current) return false;
    const session = workspace.current;
    const image = imagesRef.current.find(item => item.id === original.id);
    if (!session || !canApplyRecognition(image, original, session.id, edit.current?.id)) return false;
    const store = session.stores.get(image.directoryKey ?? '');
    if (!store) return false;
    // Refresh immediately before committing to catch external tags.json edits.
    await store.refresh();
    if (closing.current || workspace.current !== session || edit.current?.id === image.id || imagesRef.current.find(i => i.id === image.id)?.editRevision !== original.editRevision) return false;
    if ((store.snapshot[image.file.name] ?? []).join(', ') !== original.label) return false;
    const label = result.labels.length ? result.labels.join(', ') : original.label;
    const next = imagesRef.current.map(item => item.id === image.id ? { ...item, label, retry: result.retry, recognition: { status: result.status, reason: result.reason } } : item);
    imagesRef.current = next; setImages(next);
    try { writeRetry(localStorage, session.id, next.filter(item => item.retry).map(item => item.path)); }
    catch { notice.current('标签会保存，但浏览器未允许保存重识别勾选。'); }
    if (result.labels.length) { store.set(image.file.name, result.labels); await store.flush(); }
    return true;
  }, []);

  const clearSelection = useCallback(async (): Promise<boolean> => {
    if (closing.current) return false;
    closing.current = true; setClearing(true);
    generation.current++;
    try {
      // Keep the current workspace available if any pending tag cannot be saved.
      await flush();
      try { await clearCachedDirectory(); }
      catch {
        if (workspace.current || cached.current) {
          notice.current('浏览器未能清除上次文件夹记录，暂未取消选择，请重试。');
          return false;
        }
        // A plain file preview can still be closed when IndexedDB is unavailable.
      }
      const session = workspace.current;
      workspace.current = null;
      cached.current = undefined;
      edit.current = null;
      session?.stores.forEach(store => store.dispose());
      urls.current.forEach(url => URL.revokeObjectURL(url));
      urls.current.clear();
      setImages([]);
      setHasSelection(false);
      setLoading(false);
      setSyncStatus(INITIAL_STATUS);
      try { clearRetry(localStorage); } catch { /* The detached workspace no longer restores marks. */ }
      notice.current('已取消文件选择，图片和已保存标签保持不变。');
      return true;
    } catch (error) {
      setSyncStatus({ text: error instanceof Error ? error.message : '标签未能保存，暂未取消选择。', error: true, pending: true, restore: false });
      notice.current('标签尚未保存，已保留当前文件选择；请处理保存错误后重试。');
      return false;
    } finally { closing.current = false; setClearing(false); }
  }, [flush, setImages]);

  return { images, setImages, importFiles, chooseDirectory, restoreOrRetry, clearSelection, hasSelection, clearing, syncStatus, loading, onLabel, onEditStart, onEditEnd, onRetry, applyRecognition, markRecognition };
}
