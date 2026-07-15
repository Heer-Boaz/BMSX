#pragma once

#include "common/primitives.h"

#include <array>

namespace bmsx {

class Memory;

constexpr u32 GX_CHARACTER_PLANE_CONTROL_ENABLE = 1u << 0u;
constexpr u32 GX_CHARACTER_PLANE_PALETTE_OPAQUE = 1u << 15u;
constexpr u32 GX_CHARACTER_PLANE_CELL_GLYPH_MASK = 0xffu;
constexpr u32 GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT = 8u;
constexpr u32 GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT = 12u;
constexpr u32 GX_CHARACTER_PLANE_CELL_PALETTE_MASK = 0x0fu;
constexpr u32 GX_CHARACTER_PLANE_GLYPH_WIDTH = 4u;
constexpr u32 GX_CHARACTER_PLANE_GLYPH_HEIGHT = 6u;
constexpr u32 GX_CHARACTER_PLANE_COLUMNS = 160u;
constexpr u32 GX_CHARACTER_PLANE_ROWS = 80u;
constexpr size_t GX_CHARACTER_PLANE_PALETTE_WORDS = 16u;
constexpr size_t GX_CHARACTER_PLANE_GLYPH_WORDS = 256u;
constexpr size_t GX_CHARACTER_PLANE_CELL_WORDS = GX_CHARACTER_PLANE_COLUMNS * GX_CHARACTER_PLANE_ROWS;
constexpr size_t GX_CHARACTER_PLANE_WORD_BYTES = 4u;
constexpr size_t GX_CHARACTER_PLANE_PALETTE_BYTES = GX_CHARACTER_PLANE_PALETTE_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;
constexpr size_t GX_CHARACTER_PLANE_GLYPH_BYTES = GX_CHARACTER_PLANE_GLYPH_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;
constexpr size_t GX_CHARACTER_PLANE_CELL_BYTES = GX_CHARACTER_PLANE_CELL_WORDS * GX_CHARACTER_PLANE_WORD_BYTES;

struct GxCharacterPlaneState {
	u32 controlWord = 0u;
	u32 paletteAddressWord = 0u;
	u32 glyphAddressWord = 0u;
	u32 cellAddressWord = 0u;
	std::array<u8, GX_CHARACTER_PLANE_PALETTE_BYTES> paletteBytes{};
	std::array<u8, GX_CHARACTER_PLANE_GLYPH_BYTES> glyphBytes{};
	std::array<u8, GX_CHARACTER_PLANE_CELL_BYTES> cellBytes{};
};

struct GxCharacterPlaneOutput {
	u32 controlWord = 0u;
	const std::array<u8, GX_CHARACTER_PLANE_PALETTE_BYTES>& paletteBytes;
	const std::array<u8, GX_CHARACTER_PLANE_GLYPH_BYTES>& glyphBytes;
	const std::array<u8, GX_CHARACTER_PLANE_CELL_BYTES>& cellBytes;
	u32 paletteRevision = 0u;
	u32 glyphRevision = 0u;
	u32 cellRevision = 0u;
};

class GxCharacterPlane {
public:
	explicit GxCharacterPlane(Memory& memory);
	void reset();
	GxCharacterPlaneState captureState() const;
	void restoreState(const GxCharacterPlaneState& state);
	const GxCharacterPlaneOutput& readDeviceOutput();

private:
	u32 m_controlWord = 0u;
	u32 m_paletteAddressWord = 0u;
	u32 m_glyphAddressWord = 0u;
	u32 m_cellAddressWord = 0u;
	std::array<u8, GX_CHARACTER_PLANE_PALETTE_BYTES> m_paletteBytes{};
	std::array<u8, GX_CHARACTER_PLANE_GLYPH_BYTES> m_glyphBytes{};
	std::array<u8, GX_CHARACTER_PLANE_CELL_BYTES> m_cellBytes{};
	u32 m_paletteRevision = 0u;
	u32 m_glyphRevision = 0u;
	u32 m_cellRevision = 0u;
	GxCharacterPlaneOutput m_deviceOutput;

	static u64 readRegister(void* context, u32 address);
	static void writeRegister(void* context, u32 address, u64 value);
	void publishPaletteRevision();
	void publishGlyphRevision();
	void publishCellRevision();
};

} // namespace bmsx
