import { fmix32 } from '../../../common/hash';

export const CRT_NOISE_WIDTH = 512;
export const CRT_NOISE_HEIGHT = 256;
export const CRT_NOISE_PHASE_MASK = CRT_NOISE_WIDTH * CRT_NOISE_HEIGHT - 1;

let bytes: Uint8Array;

/** R is pixel grain; G is the shared line component. Signal-linear RGBA8. */
export function crtNoiseTextureBytes(): Uint8Array {
	if (bytes === undefined) {
		bytes = new Uint8Array(CRT_NOISE_WIDTH * CRT_NOISE_HEIGHT * 4);
		for (let y = 0; y < CRT_NOISE_HEIGHT; ++y) {
			const line = fmix32(y ^ 0x63d83595) >>> 24;
			for (let x = 0; x < CRT_NOISE_WIDTH; ++x) {
				const pixel = y * CRT_NOISE_WIDTH + x;
				bytes[pixel * 4] = fmix32(pixel ^ 0xa511e9b3) >>> 24;
				bytes[pixel * 4 + 1] = line;
				bytes[pixel * 4 + 2] = 0;
				bytes[pixel * 4 + 3] = 255;
			}
		}
	}
	return bytes;
}
