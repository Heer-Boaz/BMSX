import type { RgbaImage } from '../../machine/ts/render/image';

/** Host codec: owned display pixels to a PNG data URL. */
export type PngImageEncoder = (image: RgbaImage) => Promise<string>;

export type CapturedGameImage = {
	imageUrl: string;
	width: number;
	height: number;
	published: { presentationSequence: number; cycles: number; videoTick: number };
};

/** Injected host capture operation, independent of the visible IDE or provider. */
export interface GameImageCapture {
	/** Accepted readbacks reserve runtime task admission before returning; PNG encoding needs no machine lock. */
	capture(signal: AbortSignal): Promise<CapturedGameImage>;
}

/** Decode and fit an external image into a preview box; never modifies the message bytes. */
export type ImageDecoder = (url: string, width: number, height: number) => Promise<RgbaImage>;

/** Host encoders produce base64 data URLs; transports consume their media type and payload. */
export function imageDataUrlContent(url: string): { mimeType: string; data: string } {
	const separator = url.indexOf(';');
	return { mimeType: url.slice(5, separator), data: url.slice(url.indexOf(',') + 1) };
}
