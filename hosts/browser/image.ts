import type { PngImageEncoder } from '../common/image';

export const encodePngImage: PngImageEncoder = async ({ width, height, pixels }) => {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
};
