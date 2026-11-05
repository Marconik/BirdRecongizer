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
}

export interface Coordinates {
  lat: number;
  lng: number;
}
