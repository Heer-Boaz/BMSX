import { readLE32 } from '../../common/endian';
import {
	GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT,
	GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT,
	GX_CHARACTER_PLANE_CELL_GLYPH_MASK,
	GX_CHARACTER_PLANE_CELL_PALETTE_MASK,
	GX_CHARACTER_PLANE_COLUMNS,
	GX_CHARACTER_PLANE_GLYPH_HEIGHT,
	GX_CHARACTER_PLANE_GLYPH_WIDTH,
	GX_CHARACTER_PLANE_GLYPH_WORDS,
	GX_CHARACTER_PLANE_PALETTE_OPAQUE,
	GX_CHARACTER_PLANE_PALETTE_WORDS,
	GX_CHARACTER_PLANE_ROWS,
	GX_CHARACTER_PLANE_WORD_BYTES,
} from '../../machine/devices/gx/character_plane';

export const GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH = 256;
export const GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT = GX_CHARACTER_PLANE_ROWS;
export const GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES = GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH * GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT * 4;
export const GX_CHARACTER_PLANE_GLYPH_TEXTURE_COLUMNS = 16;
export const GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH = GX_CHARACTER_PLANE_GLYPH_TEXTURE_COLUMNS * GX_CHARACTER_PLANE_GLYPH_WIDTH;
export const GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT = (GX_CHARACTER_PLANE_GLYPH_WORDS / GX_CHARACTER_PLANE_GLYPH_TEXTURE_COLUMNS) * GX_CHARACTER_PLANE_GLYPH_HEIGHT;
export const GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES = GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH * GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT * 4;
export const GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH = 64;
export const GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT = 1;
export const GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES = GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH * 4;

export function writeGxCharacterPlanePaletteTexture(source: Uint8Array, target: Uint8Array): void {
	for (let index = 0; index < GX_CHARACTER_PLANE_PALETTE_WORDS; index += 1) {
		const word = readLE32(source, index * GX_CHARACTER_PLANE_WORD_BYTES);
		const red5 = word & 0x1f;
		const green5 = (word >>> 5) & 0x1f;
		const blue5 = (word >>> 10) & 0x1f;
		const targetOffset = index * 4;
		target[targetOffset] = (red5 << 3) | (red5 >>> 2);
		target[targetOffset + 1] = (green5 << 3) | (green5 >>> 2);
		target[targetOffset + 2] = (blue5 << 3) | (blue5 >>> 2);
		target[targetOffset + 3] = (word & GX_CHARACTER_PLANE_PALETTE_OPAQUE) === 0 ? 0 : 255;
	}
}
export function writeGxCharacterPlaneGlyphTexture(source: Uint8Array, target: Uint8Array): void {
	for (let glyph = 0; glyph < GX_CHARACTER_PLANE_GLYPH_WORDS; glyph += 1) {
		const word = readLE32(source, glyph * GX_CHARACTER_PLANE_WORD_BYTES);
		const tileX = (glyph & (GX_CHARACTER_PLANE_GLYPH_TEXTURE_COLUMNS - 1)) * GX_CHARACTER_PLANE_GLYPH_WIDTH;
		const tileY = (glyph >>> 4) * GX_CHARACTER_PLANE_GLYPH_HEIGHT;
		for (let y = 0; y < GX_CHARACTER_PLANE_GLYPH_HEIGHT; y += 1) {
			for (let x = 0; x < GX_CHARACTER_PLANE_GLYPH_WIDTH; x += 1) {
				const targetOffset = ((tileY + y) * GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH + tileX + x) * 4;
				target[targetOffset] = (word & (1 << (y * GX_CHARACTER_PLANE_GLYPH_WIDTH + x))) === 0 ? 0 : 255;
				target[targetOffset + 1] = 0;
				target[targetOffset + 2] = 0;
				target[targetOffset + 3] = 255;
			}
		}
	}
}

export function writeGxCharacterPlaneCellTexture(source: Uint8Array, target: Uint8Array): void {
	for (let row = 0; row < GX_CHARACTER_PLANE_ROWS; row += 1) {
		for (let column = 0; column < GX_CHARACTER_PLANE_COLUMNS; column += 1) {
			const sourceIndex = row * GX_CHARACTER_PLANE_COLUMNS + column;
			const word = readLE32(source, sourceIndex * GX_CHARACTER_PLANE_WORD_BYTES);
			const targetOffset = (row * GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH + column) * 4;
			target[targetOffset] = word & GX_CHARACTER_PLANE_CELL_GLYPH_MASK;
			target[targetOffset + 1] = (word >>> GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK;
			target[targetOffset + 2] = (word >>> GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK;
			target[targetOffset + 3] = 255;
		}
	}
}
