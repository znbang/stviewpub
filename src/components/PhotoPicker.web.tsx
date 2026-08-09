import exifr from 'exifr';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { PickedPhoto } from '../types';

type PhotoPickerProps = {
  disabled: boolean;
  onPhotosPicked: (photos: PickedPhoto[]) => void;
};

export function PhotoPicker({ disabled, onPhotosPicked }: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const parseFiles = async (files: Array<{ file: File; sourcePath: string }>) => {
    const pickedPhotos = await Promise.all(
      files.map(async ({ file, sourcePath }): Promise<PickedPhoto> => {
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
          id: `${sourcePath}-${file.size}-${file.lastModified}`,
          name: file.name,
          file,
          size: file.size,
          mimeType: file.type,
          exif,
        };
      }),
    );

    onPhotosPicked(pickedPhotos);
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).map((file) => ({
      file,
      sourcePath: file.name,
    }));

    event.target.value = '';
    await parseFiles(files);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => !!entry);
    const droppedFiles = entries.length
      ? (await Promise.all(entries.map((entry) => filesFromDroppedEntry(entry)))).flat()
      : Array.from(event.dataTransfer.files).map((file) => ({
          file,
          sourcePath: file.name,
        }));

    await parseFiles(droppedFiles.filter(({ file }) => isJpegFile(file)));
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        void handleDrop(event);
      }}
      style={{
        alignItems: 'center',
        backgroundColor: isDragging ? '#e8f1ff' : '#f8fafc',
        border: `2px dashed ${isDragging ? '#166bff' : '#b8c2d1'}`,
        borderRadius: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'center',
        minHeight: 68,
        opacity: disabled ? 0.5 : 1,
        padding: 12,
      }}
    >
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
      <span style={{ color: '#526070', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
        or drag multiple folders here (subfolders are not included)
      </span>
    </div>
  );
}

const isJpegFile = (file: File) =>
  file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);

const readFileEntry = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readDirectoryEntries = (entry: FileSystemDirectoryEntry) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => {
    const reader = entry.createReader();
    const entries: FileSystemEntry[] = [];

    const readNextBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readNextBatch();
      }, reject);
    };

    readNextBatch();
  });

const filesFromDroppedEntry = async (
  entry: FileSystemEntry,
): Promise<Array<{ file: File; sourcePath: string }>> => {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return [{ file: await readFileEntry(fileEntry), sourcePath: entry.fullPath }];
  }

  if (entry.isDirectory) {
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    const directFiles = children.filter((child): child is FileSystemFileEntry => child.isFile);
    return Promise.all(
      directFiles.map(async (child) => ({
        file: await readFileEntry(child),
        sourcePath: child.fullPath,
      })),
    );
  }

  return [];
};

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
