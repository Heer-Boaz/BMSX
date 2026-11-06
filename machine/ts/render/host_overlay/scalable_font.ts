import type { BitmapFontSourceGlyph, GlyphMap } from '../shared/bitmap_font';
import { SCALABLE_FONT_ATLAS } from '../../../../hosts/fonts/jetbrains_mono/scalable_font.generated';

export type ScalableFontGlyph = BitmapFontSourceGlyph & {
	id: string;
	codepoint: number;
	italic: boolean;
};

/** Linear RGB signed distances, separate from the sRGB host-image atlas. */
export type ScalableFontAtlas = Readonly<{
	width: number;
	height: number;
	pixels: Uint8Array;
	lineHeight: number;
	distanceRange: number;
	glyphs: readonly ScalableFontGlyph[];
}>;

export { SCALABLE_FONT_ATLAS };

const glyphsById = new Map<string, ScalableFontGlyph>();
export const SCALABLE_FONT_MAPS: { normal: GlyphMap; italic: GlyphMap } = { normal: {}, italic: {} };
for (const glyph of SCALABLE_FONT_ATLAS.glyphs) {
	glyphsById.set(glyph.id, glyph);
	SCALABLE_FONT_MAPS[glyph.italic ? 'italic' : 'normal'][String.fromCodePoint(glyph.codepoint)] = glyph.id;
}
export const SCALABLE_FONT_SOURCE = {
	resolveGlyph(id: string): BitmapFontSourceGlyph { return glyphsById.get(id)!; },
};
