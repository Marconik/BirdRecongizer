export interface ImageItem {
  id: string;
  file: File;
  path: string;
  url: string;
  label: string;
  retry: boolean;
  error: boolean;
  writable: boolean;
  workspaceId?: string;
  directoryKey?: string;
  editRevision?: number;
  recognition?: { status: 'running' | 'confirmed' | 'needs_review' | 'error' | 'skipped'; reason: string };
}

export interface Coordinates {
  lat: number;
  lng: number;
}
