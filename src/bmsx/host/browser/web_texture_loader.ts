import { TextureColor, TextureSource, TextureSourceLoader } from '../../render/texturesource';

export class WebTextureSourceLoader implements TextureSourceLoader {
	async fromUri(uri: string): Promise<TextureSource> {
		const response = await fetch(uri);
		if (!response.ok) throw new Error(`HTTP ${response.status} when fetching texture '${uri}'.`);
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
		return bitmap;
	}

	async fromBytes(bytes: ArrayBuffer): Promise<TextureSource> {
		const blob = new Blob([bytes]);
		const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
		return bitmap;
	}

	async solid(size: number, color: TextureColor): Promise<TextureSource> {
		const side = size > 0 ? size : 1;
		const data = new Uint8Array(side * side * 4);
		const r = this.toByte(color[0]);
		const g = this.toByte(color[1]);
		const b = this.toByte(color[2]);
		const a = this.toByte(color[3]);
		const pixelCount = side * side;
		for (let i = 0; i < pixelCount; i++) {
			const offset = i * 4;
			data[offset] = r;
			data[offset + 1] = g;
			data[offset + 2] = b;
			data[offset + 3] = a;
		}
		return await createImageBitmap(new Blob([data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	}

	private toByte(value: number): number {
		if (value <= 1) return Math.round(value * 255);
		return Math.round(value);
	}
}
