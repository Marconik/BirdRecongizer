import type { BirdReferenceList } from './reference-list';
import type { Coordinates } from './types';

export interface ModelSettings {
  baseUrl: string; model: string; reviewModel: string; concurrency: number;
  hasApiKey: boolean; configured: boolean;
  taxonomyReady: boolean; taxonomyVersion: string; taxonomyCount: number; taxonomyError: string; taxonomyUrl: string;
}
export interface RecognitionResult {
  labels: string[]; status: 'confirmed' | 'needs_review'; retry: boolean; reason: string;
  taxonomy_version: string; cached: boolean; duration_ms: number;
}
export class ApiError extends Error {
  fatal: boolean;
  constructor(message: string, fatal = false) { super(message); this.fatal = fatal; }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response;
  try { response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-WildScene-Client': '1' }, body: body === undefined ? undefined : JSON.stringify(body), signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new ApiError('无法连接本地识别服务，请确认程序仍在运行。', true); }
  const data = await response.json().catch(() => { throw new ApiError('本地服务响应格式不正确，请使用 npm run dev 启动完整程序。', true); });
  if (!response.ok) throw new ApiError(data.error || '识别请求失败。', data.fatal === true);
  return data;
}

/** A faithful JPEG inference copy. No image bytes are stored in browser storage. */
export async function encodeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片无法解码。');
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法生成识别图片。');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
    canvas.width = canvas.height = 1;
    if (data.length > 16 * 1024 * 1024) throw new Error('图片推理副本过大，请压缩后重试。');
    return data;
  } finally { URL.revokeObjectURL(url); }
}
export interface RecognitionContext {
  location: string; coordinates: Coordinates | null; capturedAt: string;
  reference: Pick<BirdReferenceList, 'fileName' | 'columns' | 'records'> | null;
}
