import { FileChangedError, type TagFileIO } from './tags-store';

export interface DirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<DirectoryHandle | FileSystemFileHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface PickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandle>;
}

export function directoryTagIO(directory: DirectoryHandle): TagFileIO {
  const read = async () => {
    try { return await (await directory.getFileHandle('tags.json')).getFile().then(file => file.text()); }
    catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
  };
  return {
    read,
    async write(text, expected) {
      const handle = await directory.getFileHandle('tags.json', { create: true });
      // The browser commits its temporary file on close. An exclusive writer also
      // prevents two tabs from silently replacing each other's snapshots.
      const writable = await handle.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
      try {
        const current = await read();
        if (current !== expected && !(expected === null && current === '')) throw new FileChangedError('tags.json 正在被其他程序修改，请重试保存。');
        await writable.write(text);
        await writable.close();
      } catch (error) { await writable.abort().catch(() => undefined); throw error; }
    },
  };
}

export interface CachedDirectory { id: string; handle: DirectoryHandle }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('birdrecognizer-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readCachedDirectory(): Promise<CachedDirectory | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace');
      const request = transaction.objectStore('workspace').get('directory');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function updateCachedDirectory(value?: CachedDirectory): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite');
      const store = transaction.objectStore('workspace');
      if (value) store.put(value, 'directory');
      else store.delete('directory');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function cacheDirectory(value: CachedDirectory): Promise<void> { await updateCachedDirectory(value); }
export async function clearCachedDirectory(): Promise<void> { await updateCachedDirectory(); }
