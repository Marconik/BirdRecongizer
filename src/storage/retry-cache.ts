export const RETRY_KEY = 'birdrecognizer-retry';

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function readRetry(storage: StorageLike, folderId: string): Set<string> {
  try {
    const raw = storage.getItem(RETRY_KEY);
    if (!raw) return new Set();
    const value = JSON.parse(raw);
    if (value.folderId !== folderId || !Array.isArray(value.paths) || value.paths.some((path: unknown) => typeof path !== 'string')) return new Set();
    return new Set(value.paths);
  } catch { return new Set(); }
}

export function writeRetry(storage: StorageLike, folderId: string, paths: string[]): void {
  storage.setItem(RETRY_KEY, JSON.stringify({ folderId, paths }));
}

export function clearRetry(storage: StorageLike): void { storage.removeItem(RETRY_KEY); }
