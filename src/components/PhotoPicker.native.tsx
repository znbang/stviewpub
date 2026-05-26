import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { PickedPhoto } from '../types';

type PhotoPickerProps = {
  disabled: boolean;
  onPhotosPicked: (photos: PickedPhoto[]) => void;
};

export function PhotoPicker({ disabled, onPhotosPicked }: PhotoPickerProps) {
  const pickPhotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      exif: true,
      mediaTypes: ['images'],
      quality: 1,
    });

    if (result.canceled) return;

    onPhotosPicked(
      result.assets.map((asset, index): PickedPhoto => ({
        id: `${asset.assetId ?? asset.uri}-${index}`,
        name: asset.fileName ?? `photo-${index + 1}.jpg`,
        uri: asset.uri,
        size: asset.fileSize,
        mimeType: asset.mimeType,
        exif: asset.exif as Record<string, unknown> | null,
      })),
    );
  };

  return (
    <Pressable
      disabled={disabled}
      onPress={pickPhotos}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>Select photos</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#166bff',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    backgroundColor: '#0d56d8',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
