export class HeadlessPresentSurface {
	private widthValue = 0;
	private heightValue = 0;
	private pixels: Uint8Array = new Uint8Array(0);

	public get width(): number {
		return this.widthValue;
	}

	public get height(): number {
		return this.heightValue;
	}

	public present2D(pixels: Uint8Array, width: number, height: number): void {
		this.widthValue = width;
		this.heightValue = height;
		this.pixels = pixels;
	}

	public borrowPixels(): Uint8Array {
		return this.pixels;
	}
}
