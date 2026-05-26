import { PhotoLocation } from './types';

const toDecimal = (value: unknown, ref?: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return ref === 'S' || ref === 'W' ? -value : value;
  }

  if (Array.isArray(value) && value.length >= 3) {
    const [degrees, minutes, seconds] = value.map(Number);
    if ([degrees, minutes, seconds].every(Number.isFinite)) {
      const decimal = degrees + minutes / 60 + seconds / 3600;
      return ref === 'S' || ref === 'W' ? -decimal : decimal;
    }
  }

  return null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeExifLocation = (
  exif?: Record<string, unknown> | null,
): PhotoLocation | null => {
  if (!exif) return null;

  const latitudeRef = exif.GPSLatitudeRef;
  const longitudeRef = exif.GPSLongitudeRef;
  const directLatitude = toNumber(exif.latitude ?? exif.Latitude);
  const directLongitude = toNumber(exif.longitude ?? exif.Longitude);
  const gpsLatitude =
    directLatitude ??
    toDecimal(exif.GPSLatitude, typeof latitudeRef === 'string' ? latitudeRef : undefined);
  const gpsLongitude =
    directLongitude ??
    toDecimal(exif.GPSLongitude, typeof longitudeRef === 'string' ? longitudeRef : undefined);

  if (gpsLatitude === null || gpsLongitude === null) return null;

  const heading =
    toNumber(exif.PoseHeadingDegrees) ??
    toNumber(exif.GPSImgDirection) ??
    toNumber(exif.GPSDestBearing) ??
    0;

  return {
    latitude: gpsLatitude,
    longitude: gpsLongitude,
    heading,
  };
};

export const isJpegPhoto = (name: string, mimeType?: string): boolean => {
  const normalizedType = mimeType?.toLowerCase();
  return (
    normalizedType === 'image/jpeg' ||
    normalizedType === 'image/jpg' ||
    /\.(jpe?g)$/i.test(name)
  );
};
