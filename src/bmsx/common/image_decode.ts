export type DecodedImage = {
	width: number;
	height: number;
	pixels: Uint8Array;
};

export async function decodePngToRgba(buffer: Uint8Array): Promise<DecodedImage> {
	if (!('createImageBitmap' in globalThis)) {
		throw new Error('[decodePngToRgba] createImageBitmap is not available.');
	}
	const blob = new Blob([buffer as any], { type: 'image/png' });
	const bitmap = await globalThis.createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as any);
	const width = bitmap.width;
	const height = bitmap.height;
	if (width <= 0 || height <= 0) {
		throw new Error(`[decodePngToRgba] Invalid image size ${width}x${height}.`);
	}

	let canvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		canvas = new OffscreenCanvas(width, height);
	} else if (typeof document !== 'undefined' && document.createElement) {
		canvas = document.createElement('canvas');
	} else {
		throw new Error('[decodePngToRgba] Canvas API not available.');
	}
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!ctx) {
		throw new Error('[decodePngToRgba] Failed to get 2D context.');
	}
	// Narrow to 2D context so TypeScript knows getImageData exists
	const ctx2d = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	ctx2d.drawImage(bitmap as any, 0, 0);
	const imageData = ctx2d.getImageData(0, 0, width, height);
	const pixels = new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
	if ('close' in bitmap) {
		(bitmap as { close: () => void }).close();
	}
	return { width, height, pixels };
}
