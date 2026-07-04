export class VdpFbmUnit {
	private _width: number;
	private _height: number;
	private displayFrameBufferCpuReadback: Uint8Array;

	public constructor(width: number, height: number) {
		this._width = width;
		this._height = height;
		this.displayFrameBufferCpuReadback = new Uint8Array(width * height * 4);
	}

	public get width(): number {
		return this._width;
	}

	public get height(): number {
		return this._height;
	}

	public configure(width: number, height: number): void {
		this._width = width;
		this._height = height;
		this.displayFrameBufferCpuReadback = new Uint8Array(width * height * 4);
	}

	public captureDisplayReadback(): Uint8Array {
		const byteLength = this._width * this._height * 4;
		const pixels = new Uint8Array(byteLength);
		for (let index = 0; index < byteLength; index += 1) {
			pixels[index] = this.displayFrameBufferCpuReadback[index]!;
		}
		return pixels;
	}

	public restoreDisplayReadback(pixels: Uint8Array): void {
		for (let index = 0; index < pixels.byteLength; index += 1) {
			this.displayFrameBufferCpuReadback[index] = pixels[index]!;
		}
	}

	public get displayReadback(): Uint8Array {
		return this.displayFrameBufferCpuReadback;
	}
}
