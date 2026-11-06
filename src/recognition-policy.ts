import type { ImageItem } from './types';

export function canApplyRecognition(current: ImageItem | undefined, original: ImageItem, workspaceId: string | undefined, editingId: string | undefined | null): current is ImageItem {
  return Boolean(current?.writable && current.id === original.id && current.workspaceId === workspaceId && current.workspaceId === original.workspaceId && current.label === original.label && current.editRevision === original.editRevision && editingId !== current.id);
}
