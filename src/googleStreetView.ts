import { UploadResult, QueuePhoto } from './types';

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const getRetryDelayMs = (response: Response | null, attemptIndex: number) => {
  const retryAfter = response?.headers.get('Retry-After');
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds)) {
      return retryAfterSeconds * 1000;
    }

    const retryAfterDate = Date.parse(retryAfter);
    if (!Number.isNaN(retryAfterDate)) {
      return Math.max(retryAfterDate - Date.now(), 0);
    }
  }

  return BASE_RETRY_DELAY_MS * 2 ** attemptIndex;
};

const fetchWithRetry = async (request: () => Promise<Response>): Promise<Response> => {
  let lastNetworkError: unknown;

  for (let attemptIndex = 0; attemptIndex <= MAX_RETRY_ATTEMPTS; attemptIndex += 1) {
    try {
      const response = await request();

      if (!RETRYABLE_STATUS_CODES.has(response.status) || attemptIndex === MAX_RETRY_ATTEMPTS) {
        return response;
      }

      await wait(getRetryDelayMs(response, attemptIndex));
    } catch (error) {
      lastNetworkError = error;
      if (attemptIndex === MAX_RETRY_ATTEMPTS) {
        throw error;
      }

      await wait(getRetryDelayMs(null, attemptIndex));
    }
  }

  throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Network request failed.');
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
  const file = photo.file;
  const location = photo.location;

  const startUploadResponse = await fetchWithRetry(() =>
    fetch('https://streetviewpublish.googleapis.com/v1/photo:startUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  );
  const startUploadBody = (await ensureOk(
    startUploadResponse,
    'Unable to start Google Street View upload.',
  )) as { uploadUrl?: string };

  if (!startUploadBody.uploadUrl) {
    throw new Error('Google did not return an upload URL.');
  }
  const uploadUrl = startUploadBody.uploadUrl;

  const binaryUploadResponse = await fetchWithRetry(() =>
    fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': file.type || 'image/jpeg',
      },
      body: file,
    }),
  );
  await ensureOk(binaryUploadResponse, 'Unable to upload image bytes to Google.');

  const publishResponse = await fetchWithRetry(() =>
    fetch('https://streetviewpublish.googleapis.com/v1/photo', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uploadReference: {
          uploadUrl,
        },
        pose: {
          latLngPair: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          heading: location.heading,
        },
      }),
    }),
  );
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
