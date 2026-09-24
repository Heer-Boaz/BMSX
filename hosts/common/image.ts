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
