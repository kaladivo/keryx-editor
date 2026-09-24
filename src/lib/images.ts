const JPEG_QUALITY = 0.82;
const SMALL_PNG_BYTES = 200_000;

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

const dataUrlBytes = (url: string) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

/** Downscales an image to fit `maxSize` and returns it as a data URL (JPEG, or PNG when transparent and small). */
export async function imageToDataUrl(source: Blob, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  if (hasTransparency(ctx, w, h)) {
    const png = canvas.toDataURL('image/png');
    if (dataUrlBytes(png) <= SMALL_PNG_BYTES) return png;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export const dataUrlToBlob = async (url: string): Promise<Blob> => (await fetch(url)).blob();

export function firstDataImage(html: string): string | undefined {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.images].map((img) => img.getAttribute('src') ?? '').find((src) => src.startsWith('data:image/'));
}
