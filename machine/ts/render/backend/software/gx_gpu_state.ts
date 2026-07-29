export class GxGpuSoftwareState {
	public readonly vram: Uint16Array;
	public readonly vramWordMask: number;
	public readonly vramSnapshotScratch: Uint8Array;
	public processedCommandCount = 0;
	public processedCommandSerial = 0;
	public vramSnapshotSerial = 0n;
	public interlacedPixels: Uint32Array;
	public interlacedWidth = 0;
	public interlacedHeight = 0;
	public interlacedValid = false;
	public interlacedVramReplacementSerial = 0n;

	constructor(vramByteCount: number, interlacedPixelCount: number) {
		this.vram = new Uint16Array(vramByteCount >>> 1);
		this.vramWordMask = this.vram.length - 1;
		this.vramSnapshotScratch = new Uint8Array(vramByteCount);
		this.interlacedPixels = new Uint32Array(interlacedPixelCount);
	}
}
