/** Owned, tightly packed, top-down RGBA8 in display/signal color space. */
export type RgbaImage = {
	width: number;
	height: number;
	pixels: Uint8Array<ArrayBuffer>;
};
