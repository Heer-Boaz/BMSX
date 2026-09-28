import type { ClipboardImageData } from '../common/clipboard';
import type { RgbaImage } from '../../machine/ts/render/image';
import type { ImageDecoder, PngImageEncoder } from '../common/image';

export const encodePngImage: PngImageEncoder = async ({ width, height, pixels }) => {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return readImageBlob(blob);
};

/** Browser-owned encoding boundary, also used by native clipboard files. */
export function readImageBlob(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export const decodeImage: ImageDecoder = async (url, maxWidth, maxHeight) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Image read failed (${response.status})`);
	const source = await createImageBitmap(await response.blob());
	try {
		return imagePreview(source, maxWidth, maxHeight);
	} finally { source.close(); }
};

/** Decode at the external clipboard boundary, before enabling submission. Non-PNG formats
 * are converted here, rather than asking message consumers to interpret browser file types. */
export async function readClipboardImage(blob: Blob): Promise<ClipboardImageData> {
	const source = await createImageBitmap(blob);
	try {
		let png = blob;
		if (blob.type !== 'image/png') {
			const canvas = new OffscreenCanvas(source.width, source.height);
			canvas.getContext('2d')!.drawImage(source, 0, 0);
			png = await canvas.convertToBlob({ type: 'image/png' });
		}
		return { url: await readImageBlob(png), preview: imagePreview(source, 512, 512) };
	} finally { source.close(); }
}

function imagePreview(source: ImageBitmap, maxWidth: number, maxHeight: number): RgbaImage {
	const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
	const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
	const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')!;
	context.drawImage(source, 0, 0, width, height);
	return { width, height, pixels: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer) };
}
