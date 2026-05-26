import exifr from 'exifr';
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { PickedPhoto } from '../types';

type PhotoPickerProps = {
  disabled: boolean;
  onPhotosPicked: (photos: PickedPhoto[]) => void;
};

export function PhotoPicker({ disabled, onPhotosPicked }: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const pickedPhotos = await Promise.all(
      files.map(async (file, index): Promise<PickedPhoto> => {
        let exif: Record<string, unknown> | null = null;
        try {
          exif = (await exifr.parse(file, {
            gps: true,
            xmp: true,
            tiff: true,
          })) as Record<string, unknown> | undefined ?? null;
        } catch {
          exif = null;
        }

        return {
          id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
          name: file.name,
          file,
          size: file.size,
          mimeType: file.type,
          exif,
        };
      }),
    );

    event.target.value = '';
    onPhotosPicked(pickedPhotos);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg"
        disabled={disabled}
        onChange={handleFiles}
        style={{ display: 'none' }}
      />
      <Pressable
        disabled={disabled}
        onPress={() => inputRef.current?.click()}
        style={({ pressed }) => [
          styles.button,
          disabled && styles.buttonDisabled,
          pressed && !disabled && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>Select JPEG photos</Text>
      </Pressable>
    </>
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
