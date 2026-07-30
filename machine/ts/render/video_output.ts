export interface VideoOutput {
	setDisplaySize(width: number, height: number): void;
}

export interface SoftwareFrameOutput {
	presentSoftwareFrame(pixels: Uint8Array, width: number, height: number): void;
}
