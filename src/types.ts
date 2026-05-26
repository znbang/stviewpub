export type PhotoStatus =
  | 'pending'
  | 'skipped'
  | 'uploading'
  | 'publishing'
  | 'success'
  | 'error';

export type PhotoLocation = {
  latitude: number;
  longitude: number;
  heading: number;
};

export type PickedPhoto = {
  id: string;
  name: string;
  uri?: string;
  file?: File;
  size?: number;
  mimeType?: string;
  exif?: Record<string, unknown> | null;
};

export type QueuePhoto = PickedPhoto & {
  location: PhotoLocation | null;
  status: PhotoStatus;
  error?: string;
  shareLink?: string;
  publishStatus?: string;
};

export type UploadResult = {
  shareLink: string;
  publishStatus: string;
  response: unknown;
};
