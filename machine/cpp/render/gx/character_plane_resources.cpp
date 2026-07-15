#include "render/gx/character_plane_resources.h"

#include "common/endian.h"

namespace bmsx {

void writeGxCharacterPlanePaletteTexture(
	const std::array<u8, GX_CHARACTER_PLANE_PALETTE_BYTES>& source,
	std::array<u8, GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES>& target) {
	for (size_t index = 0u; index < GX_CHARACTER_PLANE_PALETTE_WORDS; index += 1u) {
		const u32 word = readLE32(source.data() + index * GX_CHARACTER_PLANE_WORD_BYTES);
		const u32 red5 = word & 0x1fu;
		const u32 green5 = (word >> 5u) & 0x1fu;
		const u32 blue5 = (word >> 10u) & 0x1fu;
		const size_t targetOffset = index * 4u;
		target[targetOffset] = static_cast<u8>((red5 << 3u) | (red5 >> 2u));
		target[targetOffset + 1u] = static_cast<u8>((green5 << 3u) | (green5 >> 2u));
		target[targetOffset + 2u] = static_cast<u8>((blue5 << 3u) | (blue5 >> 2u));
		target[targetOffset + 3u] = (word & GX_CHARACTER_PLANE_PALETTE_OPAQUE) == 0u ? 0u : 255u;
	}
}

void writeGxCharacterPlaneGlyphTexture(
	const std::array<u8, GX_CHARACTER_PLANE_GLYPH_BYTES>& source,
	std::array<u8, GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES>& target) {
	for (size_t glyph = 0u; glyph < GX_CHARACTER_PLANE_GLYPH_WORDS; glyph += 1u) {
		const u32 word = readLE32(source.data() + glyph * GX_CHARACTER_PLANE_WORD_BYTES);
		const size_t tileX = (glyph & (GX_CHARACTER_PLANE_GLYPH_TEXTURE_COLUMNS - 1u)) * GX_CHARACTER_PLANE_GLYPH_WIDTH;
		const size_t tileY = (glyph >> 4u) * GX_CHARACTER_PLANE_GLYPH_HEIGHT;
		for (size_t y = 0u; y < GX_CHARACTER_PLANE_GLYPH_HEIGHT; y += 1u) {
			for (size_t x = 0u; x < GX_CHARACTER_PLANE_GLYPH_WIDTH; x += 1u) {
				const size_t targetOffset = ((tileY + y) * GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH + tileX + x) * 4u;
				target[targetOffset] = (word & (1u << (y * GX_CHARACTER_PLANE_GLYPH_WIDTH + x))) == 0u ? 0u : 255u;
				target[targetOffset + 1u] = 0u;
				target[targetOffset + 2u] = 0u;
				target[targetOffset + 3u] = 255u;
			}
		}
	}
}

void writeGxCharacterPlaneCellTexture(
	const std::array<u8, GX_CHARACTER_PLANE_CELL_BYTES>& source,
	std::array<u8, GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES>& target) {
	for (size_t row = 0u; row < GX_CHARACTER_PLANE_ROWS; row += 1u) {
		for (size_t column = 0u; column < GX_CHARACTER_PLANE_COLUMNS; column += 1u) {
			const size_t sourceIndex = row * GX_CHARACTER_PLANE_COLUMNS + column;
			const u32 word = readLE32(source.data() + sourceIndex * GX_CHARACTER_PLANE_WORD_BYTES);
			const size_t targetOffset = (row * GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH + column) * 4u;
			target[targetOffset] = static_cast<u8>(word & GX_CHARACTER_PLANE_CELL_GLYPH_MASK);
			target[targetOffset + 1u] = static_cast<u8>((word >> GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK);
			target[targetOffset + 2u] = static_cast<u8>((word >> GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK);
			target[targetOffset + 3u] = 255u;
		}
	}
}

} // namespace bmsx
