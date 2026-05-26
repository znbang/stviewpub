import { UploadResult, QueuePhoto } from './types';

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const ensureOk = async (response: Response, fallbackMessage: string): Promise<unknown> => {
  const body = await parseJsonResponse(response);
  if (response.ok) return body;

  const message =
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'message' in body.error
      ? String(body.error.message)
      : fallbackMessage;

  const error = new Error(message);
  error.name = response.status === 401 ? 'UnauthorizedError' : 'GoogleApiError';
  throw error;
};

export const publishStreetViewPhoto = async (
  photo: QueuePhoto,
  accessToken: string,
): Promise<UploadResult> => {
  if (!photo.file) {
    throw new Error('Web upload requires a browser File object.');
  }
  if (!photo.location) {
    throw new Error('Photo is missing GPS metadata.');
  }

  const startUploadResponse = await fetch(
    'https://streetviewpublish.googleapis.com/v1/photo:startUpload',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const startUploadBody = (await ensureOk(
    startUploadResponse,
    'Unable to start Google Street View upload.',
  )) as { uploadUrl?: string };

  if (!startUploadBody.uploadUrl) {
    throw new Error('Google did not return an upload URL.');
  }

  const binaryUploadResponse = await fetch(startUploadBody.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': photo.file.type || 'image/jpeg',
    },
    body: photo.file,
  });
  await ensureOk(binaryUploadResponse, 'Unable to upload image bytes to Google.');

  const publishResponse = await fetch('https://streetviewpublish.googleapis.com/v1/photo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uploadReference: {
        uploadUrl: startUploadBody.uploadUrl,
      },
      pose: {
        latLngPair: {
          latitude: photo.location.latitude,
          longitude: photo.location.longitude,
        },
        heading: photo.location.heading,
      },
    }),
  });
  const publishBody = (await ensureOk(
    publishResponse,
    'Unable to publish Google Street View photo.',
  )) as { shareLink?: string; mapsPublishStatus?: string };

  return {
    shareLink: publishBody.shareLink ?? '',
    publishStatus: publishBody.mapsPublishStatus ?? 'UNKNOWN',
    response: publishBody,
  };
};
