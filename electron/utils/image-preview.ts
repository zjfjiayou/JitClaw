import { nativeImage } from 'electron';

const IMAGE_PREVIEW_MAX_DIM = 512;

function resizePreviewImage(image: Electron.NativeImage): Electron.NativeImage {
  const size = image.getSize();
  const needsResize = size.width > IMAGE_PREVIEW_MAX_DIM || size.height > IMAGE_PREVIEW_MAX_DIM;

  if (!needsResize) {
    return image;
  }

  if (size.width >= size.height) {
    return image.resize({ width: IMAGE_PREVIEW_MAX_DIM });
  }

  return image.resize({ height: IMAGE_PREVIEW_MAX_DIM });
}

export async function generateImagePreview(filePath: string): Promise<string | null> {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      const previewImage = resizePreviewImage(image);
      return `data:image/png;base64,${previewImage.toPNG().toString('base64')}`;
    }
  } catch {
    // Fall through to sharp fallback below.
  }

  try {
    const { default: sharp } = await import('sharp');
    const buffer = await sharp(filePath)
      .resize({ width: IMAGE_PREVIEW_MAX_DIM, height: IMAGE_PREVIEW_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}
