import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PhotoPicker } from './components/PhotoPicker';
import { GOOGLE_CLIENT_ID, STREET_VIEW_SCOPE } from './config';
import { isJpegPhoto, normalizeExifLocation } from './exif';
import { publishStreetViewPhoto } from './googleStreetView';
import { GoogleTokenResponse } from './global';
import { PickedPhoto, QueuePhoto } from './types';

const statusLabels: Record<QueuePhoto['status'], string> = {
  pending: 'Pending',
  skipped: 'Skipped',
  uploading: 'Uploading',
  publishing: 'Publishing',
  success: 'Success',
  error: 'Error',
};

const canUploadPhoto = (photo: QueuePhoto) =>
  !!photo.location && (photo.status === 'pending' || photo.status === 'error');

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

type GoogleUser = {
  name?: string;
  email?: string;
};

const loadGoogleIdentityServices = () =>
  new Promise<void>((resolve, reject) => {
    if (Platform.OS !== 'web') {
      resolve();
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google sign-in failed to load.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in failed to load.'));
    document.head.appendChild(script);
  });

const fetchGoogleUser = async (accessToken: string): Promise<GoogleUser | null> => {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;

  const body = (await response.json()) as GoogleUser;
  return {
    name: body.name,
    email: body.email,
  };
};

export default function App() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [mobilePreviewSignedIn, setMobilePreviewSignedIn] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [photos, setPhotos] = useState<QueuePhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const tokenExpiresAtRef = useRef(0);
  const pendingTokenRequestRef = useRef<{
    resolve: (token: string | null) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const tokenClientRef = useRef<ReturnType<
    NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']
  > | null>(null);

  const uploadablePhotos = useMemo(
    () => photos.filter(canUploadPhoto),
    [photos],
  );
  const skippedCount = photos.filter((photo) => photo.status === 'skipped').length;
  const successCount = photos.filter((photo) => photo.status === 'success').length;
  const errorCount = photos.filter((photo) => photo.status === 'error').length;
  const completedCount = photos.filter((photo) =>
    ['success', 'error', 'skipped'].includes(photo.status),
  ).length;

  const saveAccessToken = (token: string | null, expiresInSeconds?: number) => {
    const expiresAt = token && expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : 0;

    accessTokenRef.current = token;
    tokenExpiresAtRef.current = expiresAt;
    setAccessToken(token);
    if (!token) setGoogleUser(null);
  };

  const hasFreshAccessToken = () =>
    !!accessTokenRef.current &&
    !!tokenExpiresAtRef.current &&
    Date.now() < tokenExpiresAtRef.current - TOKEN_EXPIRY_BUFFER_MS;

  const requestGoogleToken = async (prompt?: '' | 'consent'): Promise<string | null> => {
    if (Platform.OS !== 'web') return null;
    try {
      await loadGoogleIdentityServices();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google sign-in failed to load.';
      setAuthMessage(message);
      throw new Error(message);
    }

    if (!window.google?.accounts?.oauth2) {
      const message = 'Google Identity Services is still loading. Try again in a moment.';
      setAuthMessage(message);
      throw new Error(message);
    }

    tokenClientRef.current ??= window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: STREET_VIEW_SCOPE,
      callback: async (response: GoogleTokenResponse) => {
        const pendingRequest = pendingTokenRequestRef.current;
        pendingTokenRequestRef.current = null;

        if (response.access_token) {
          saveAccessToken(response.access_token, response.expires_in);
          const user = await fetchGoogleUser(response.access_token).catch(() => null);
          setGoogleUser(user);
          setAuthMessage('Signed in for this browser session.');
          pendingRequest?.resolve(response.access_token);
          return;
        }

        const message = response.error_description ?? response.error ?? 'Google sign-in failed.';
        setAuthMessage(message);
        pendingRequest?.reject(new Error(message));
      },
      error_callback: (error: unknown) => {
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String(error.message)
            : 'Google sign-in popup failed or was closed.';

        pendingTokenRequestRef.current?.reject(new Error(message));
        pendingTokenRequestRef.current = null;
        setAuthMessage(message);
      },
    });

    return new Promise((resolve, reject) => {
      pendingTokenRequestRef.current = { resolve, reject };
      tokenClientRef.current?.requestAccessToken({
        prompt: prompt ?? (accessTokenRef.current ? '' : 'consent'),
      });
    });
  };

  const getFreshAccessToken = async () => {
    if (hasFreshAccessToken()) {
      return accessTokenRef.current;
    }

    return requestGoogleToken(accessTokenRef.current ? '' : 'consent');
  };

  const handlePhotosPicked = (pickedPhotos: PickedPhoto[]) => {
    const nextPhotos = pickedPhotos.map((photo): QueuePhoto => {
      if (!isJpegPhoto(photo.name, photo.mimeType)) {
        return {
          ...photo,
          location: null,
          status: 'skipped',
          error: 'Only JPEG images are supported.',
        };
      }

      const location = normalizeExifLocation(photo.exif);
      return {
        ...photo,
        location,
        status: location ? 'pending' : 'skipped',
        error: location ? undefined : 'Missing GPS EXIF metadata.',
      };
    });

    setPhotos(nextPhotos);
  };

  const updatePhoto = (id: string, patch: Partial<QueuePhoto>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    );
  };

  const startUpload = async () => {
    if (Platform.OS !== 'web') return;
    if (!accessToken) {
      setAuthMessage('Sign in with Google before uploading.');
      return;
    }

    setIsUploading(true);
    const queue = photos.filter(canUploadPhoto);
    let token: string | null = null;

    try {
      token = await getFreshAccessToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign in with Google before uploading.';
      setAuthMessage(message);
      setIsUploading(false);
      return;
    }

    if (!token) {
      setAuthMessage('Sign in with Google before uploading.');
      setIsUploading(false);
      return;
    }

    for (const photo of queue) {
      try {
        if (!hasFreshAccessToken()) {
          const message = 'Google token expired. Sign in again, then continue uploading.';

          saveAccessToken(null);
          setAuthMessage(message);
          updatePhoto(photo.id, { status: 'pending', error: message });
          break;
        }

        updatePhoto(photo.id, { status: 'uploading', error: undefined });
        updatePhoto(photo.id, { status: 'publishing' });
        const result = await publishStreetViewPhoto(photo, token);
        updatePhoto(photo.id, {
          status: 'success',
          shareLink: result.shareLink,
          publishStatus: result.publishStatus,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'UnauthorizedError') {
          const message = 'Google token expired. Sign in again, then continue uploading.';

          saveAccessToken(null);
          setAuthMessage(message);
          updatePhoto(photo.id, { status: 'pending', error: message });
          break;
        }

        const message = error instanceof Error ? error.message : 'Upload failed.';
        updatePhoto(photo.id, { status: 'error', error: message });
        break;
      }
    }

    setIsUploading(false);
  };

  const clearPhotos = () => {
    if (!isUploading) setPhotos([]);
  };

  const isSignedIn = Platform.OS === 'web' ? !!accessToken : mobilePreviewSignedIn;
  const canUpload = Platform.OS === 'web' && !!accessToken && uploadablePhotos.length > 0;
  const signedInLabel =
    Platform.OS === 'web' ? (googleUser?.email ?? 'Signed in') : 'Preview';
  const uploadButtonLabel =
    Platform.OS !== 'web'
      ? 'Web upload only'
      : photos.length === 0
        ? 'Select photos first'
        : uploadablePhotos.length === 0
          ? 'No photos ready'
          : 'Start upload';

  if (!isSignedIn) {
    return (
      <ScrollView contentContainerStyle={[styles.page, styles.loginPage]}>
        <View style={styles.loginShell}>
          <View style={styles.loginHeader}>
            <Text style={styles.loginTitle}>Street View Publisher</Text>
            <Text style={styles.loginSubtitle}>
              Publish 360 panorama photos.
            </Text>
          </View>

          <View style={styles.loginPanel}>
            {authMessage ? <Text style={styles.notice}>{authMessage}</Text> : null}
            <Pressable
              onPress={
                Platform.OS === 'web'
                  ? () => {
                      void requestGoogleToken();
                    }
                  : () => {
                      setMobilePreviewSignedIn(true);
                      setAuthMessage('');
                    }
              }
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.loginButtonPressed,
              ]}
            >
              <Text style={styles.loginButtonText}>
                {Platform.OS === 'web' ? 'Sign in with Google' : 'Continue to mobile preview'}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.shell}>
        <View style={styles.appHeader}>
          <View style={styles.header}>
            <Text style={styles.title}>Street View Publisher</Text>
            <Text style={styles.subtitle}>Publish 360 panorama photos.</Text>
          </View>
          <View style={styles.headerActions}>
            <Text numberOfLines={1} style={styles.connectionBadge}>
              {signedInLabel}
            </Text>
            {Platform.OS !== 'web' ? (
              <Pressable
                disabled={isUploading}
                onPress={() => {
                  setMobilePreviewSignedIn(false);
                  setPhotos([]);
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {authMessage ? <Text style={styles.notice}>{authMessage}</Text> : null}

        <View style={styles.queuePanel}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.muted}>
                {completedCount} / {photos.length} processed
              </Text>
            </View>
            <View style={styles.queueActions}>
              {photos.length > 0 ? (
                <Pressable disabled={isUploading} onPress={clearPhotos} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Clear</Text>
                </Pressable>
              ) : null}
              <PhotoPicker disabled={isUploading} onPhotosPicked={handlePhotosPicked} />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <SummaryChip label="Ready" value={uploadablePhotos.length} />
            <SummaryChip label="Skipped" value={skippedCount} />
            <SummaryChip label="Uploaded" value={successCount} />
            <SummaryChip label="Errors" value={errorCount} />
          </View>

          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.sectionTitle}>Upload progress</Text>
              <Text style={styles.muted}>{uploadablePhotos.length} ready to upload</Text>
            </View>
            <Pressable
              disabled={!canUpload || isUploading}
              onPress={startUpload}
              style={({ pressed }) => [
                styles.primaryButton,
                (!canUpload || isUploading) && styles.disabled,
                pressed && canUpload && !isUploading && styles.primaryButtonPressed,
              ]}
            >
              {isUploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>{uploadButtonLabel}</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: photos.length ? `${(completedCount / photos.length) * 100}%` : '0%' },
              ]}
            />
          </View>

          <View style={styles.list}>
            {photos.length === 0 ? (
              <Text style={styles.empty}>No photos selected.</Text>
            ) : (
              photos.map((photo) => <PhotoRow key={photo.id} photo={photo} />)
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryChip}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function PhotoRow({ photo }: { photo: QueuePhoto }) {
  const [copyMessage, setCopyMessage] = useState('');

  const openShareLink = async () => {
    if (!photo.shareLink) return;
    await Linking.openURL(photo.shareLink);
  };

  const copyShareLink = async () => {
    if (!photo.shareLink) return;

    if (Platform.OS === 'web' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(photo.shareLink);
      setCopyMessage('Copied');
      return;
    }

    setCopyMessage('Copy not available on this platform');
  };

  return (
    <View style={styles.photoRow}>
      {photo.uri ? <Image source={{ uri: photo.uri }} style={styles.thumbnail} /> : null}
      <View style={styles.photoBody}>
        <View style={styles.rowBetween}>
          <Text numberOfLines={1} style={styles.photoName}>
            {photo.name}
          </Text>
          <Text style={[styles.status, styles[`status_${photo.status}`]]}>
            {statusLabels[photo.status]}
          </Text>
        </View>
        {photo.location ? (
          <Text style={styles.meta}>
            {photo.location.latitude.toFixed(6)}, {photo.location.longitude.toFixed(6)} · heading{' '}
            {photo.location.heading.toFixed(0)}
          </Text>
        ) : null}
        {photo.shareLink ? (
          <View style={styles.actionRow}>
            <Pressable onPress={openShareLink} style={styles.linkAction}>
              <Text style={styles.linkActionText}>Open in Google Maps</Text>
            </Pressable>
            <Pressable onPress={copyShareLink} style={styles.linkAction}>
              <Text style={styles.linkActionText}>Copy link</Text>
            </Pressable>
            {copyMessage ? <Text style={styles.copyMessage}>{copyMessage}</Text> : null}
          </View>
        ) : null}
        {photo.error ? <Text style={styles.error}>{photo.error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    backgroundColor: '#f4f7fb',
    minHeight: '100%',
    padding: 18,
  },
  loginPage: {
    justifyContent: 'center',
  },
  shell: {
    gap: 14,
    maxWidth: 920,
    width: '100%',
  },
  loginShell: {
    gap: 20,
    maxWidth: 560,
    width: '100%',
  },
  loginHeader: {
    gap: 8,
  },
  loginTitle: {
    color: '#172033',
    fontSize: 34,
    fontWeight: '800',
  },
  loginSubtitle: {
    color: '#536172',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 520,
  },
  header: {
    gap: 6,
    paddingVertical: 12,
  },
  appHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 12,
  },
  connectionBadge: {
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    color: '#166534',
    fontSize: 13,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  title: {
    color: '#172033',
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: '#536172',
    fontSize: 16,
  },
  panel: {
    backgroundColor: '#fff',
    borderColor: '#dce3ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  queuePanel: {
    backgroundColor: '#fff',
    borderColor: '#dce3ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: 16,
  },
  loginPanel: {
    backgroundColor: '#fff',
    borderColor: '#dce3ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 22,
  },
  loginCopy: {
    color: '#536172',
    fontSize: 15,
    lineHeight: 22,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
  },
  queueActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryChip: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 104,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryValue: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '800',
  },
  summaryLabel: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 2,
  },
  sectionTitle: {
    color: '#1e293b',
    fontSize: 18,
    fontWeight: '800',
  },
  muted: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 3,
  },
  notice: {
    color: '#334155',
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 6,
    minWidth: 132,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonPressed: {
    backgroundColor: '#115e59',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  loginButton: {
    alignItems: 'center',
    backgroundColor: '#166bff',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  loginButtonPressed: {
    backgroundColor: '#0d56d8',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    borderColor: '#166bff',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonPressed: {
    backgroundColor: '#eaf1ff',
  },
  secondaryButtonText: {
    color: '#166bff',
    fontSize: 15,
    fontWeight: '800',
  },
  textButton: {
    padding: 8,
  },
  textButtonLabel: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  progressTrack: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#0f766e',
    height: 10,
  },
  list: {
    gap: 10,
  },
  empty: {
    color: '#64748b',
    fontSize: 14,
  },
  photoRow: {
    borderColor: '#e2e8f0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  thumbnail: {
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    height: 72,
    width: 72,
  },
  photoBody: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  photoName: {
    color: '#172033',
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  status: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  status_pending: {
    backgroundColor: '#e0f2fe',
    color: '#075985',
  },
  status_skipped: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
  },
  status_uploading: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  status_publishing: {
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
  },
  status_success: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  status_error: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  meta: {
    color: '#64748b',
    fontSize: 13,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  linkAction: {
    paddingVertical: 2,
  },
  linkActionText: {
    color: '#166bff',
    fontSize: 13,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  copyMessage: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    color: '#b42318',
    fontSize: 13,
  },
});
