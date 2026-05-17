export class HeadlessPresentSurface {
	private widthValue = 0;
	private heightValue = 0;
	private pixels = new Uint8Array(0);

	public get width(): number {
		return this.widthValue;
	}

	public get height(): number {
		return this.heightValue;
	}

	public present2D(srcPixels: Uint8Array, srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): void {
		if (srcWidth <= 0 || srcHeight <= 0) {
			throw new Error(`[HeadlessPresentSurface] Invalid source size ${srcWidth}x${srcHeight}.`);
		}
		if (dstWidth <= 0 || dstHeight <= 0) {
			throw new Error(`[HeadlessPresentSurface] Invalid destination size ${dstWidth}x${dstHeight}.`);
		}
		const expectedBytes = srcWidth * srcHeight * 4;
		if (srcPixels.byteLength !== expectedBytes) {
			throw new Error(`[HeadlessPresentSurface] Source pixel byte length mismatch (${srcPixels.byteLength} != ${expectedBytes}).`);
		}
		this.ensureSize(dstWidth, dstHeight);
		let srcY = 0;
		let srcYStep = 0;
		for (let y = 0; y < dstHeight; y += 1) {
			const dstRow = y * dstWidth * 4;
			const srcRow = srcY * srcWidth * 4;
			let srcX = 0;
			let srcXStep = 0;
			for (let x = 0; x < dstWidth; x += 1) {
				const srcIndex = srcRow + srcX * 4;
				const dstIndex = dstRow + x * 4;
				this.pixels[dstIndex + 0] = srcPixels[srcIndex + 0];
				this.pixels[dstIndex + 1] = srcPixels[srcIndex + 1];
				this.pixels[dstIndex + 2] = srcPixels[srcIndex + 2];
				this.pixels[dstIndex + 3] = srcPixels[srcIndex + 3];
				srcXStep += srcWidth;
				while (srcXStep >= dstWidth) {
					srcXStep -= dstWidth;
					srcX += 1;
				}
			}
			srcYStep += srcHeight;
			while (srcYStep >= dstHeight) {
				srcYStep -= dstHeight;
				srcY += 1;
			}
		}
	}

	public copyPixels(): Uint8Array {
		return new Uint8Array(this.pixels);
	}

	private ensureSize(width: number, height: number): void {
		if (this.widthValue === width && this.heightValue === height && this.pixels.byteLength === width * height * 4) {
			return;
		}
		this.widthValue = width;
		this.heightValue = height;
		this.pixels = new Uint8Array(width * height * 4);
	}
}
