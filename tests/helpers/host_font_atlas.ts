import { BFont, type FontRendering } from '../../machine/ts/render/shared/bitmap_font';
import type { HostAtlas } from '../../machine/ts/render/host_overlay/atlas';

/** Identical glyph ids and raster modes, but different atlas dimensions and ink. */
export function createFontAtlasPair(rendering: FontRendering): [BFont, BFont] {
	return [0, 1].map(index => {
		const width = 4 + index * 4, height = 4 + index * 2, u = 1 + index, v = 1 + index;
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
			const offset = ((v + y) * width + u + x) * 4;
			const coverage = (x === y) === (index === 0) ? 255 : 0;
			pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = rendering.raster === 'msdf' ? coverage : 255;
			pixels[offset + 3] = rendering.raster === 'msdf' ? 255 : coverage;
		}
		const atlas: HostAtlas = { width, height, pixels, srgb: false };
		return new BFont({ atlas, resolveGlyph: () => ({ width: 2, height: 2, advance: 3, offsetX: 0, offsetY: 0, u, v, w: 2, h: 2 }) },
			{ A: 'fixture', '?': 'fixture' }, 0, rendering);
	}) as [BFont, BFont];
}
