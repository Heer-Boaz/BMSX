#include "machine/devices/gx/character_plane.h"

#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"

namespace bmsx {
namespace {

u32 nextGxCharacterPlaneRevision = 0u;

} // namespace

GxCharacterPlane::GxCharacterPlane(Memory& memory)
	: m_deviceOutput{0u, m_paletteBytes, m_glyphBytes, m_cellBytes, 0u, 0u, 0u} {
	memory.mapIoRead(IO_GX_CHARACTER_CONTROL, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_PALETTE_ADDRESS, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_PALETTE_DATA, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_GLYPH_ADDRESS, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_GLYPH_DATA, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_CELL_ADDRESS, this, &GxCharacterPlane::readRegister);
	memory.mapIoRead(IO_GX_CHARACTER_CELL_DATA, this, &GxCharacterPlane::readRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_CONTROL, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_PALETTE_ADDRESS, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_PALETTE_DATA, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_GLYPH_ADDRESS, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_GLYPH_DATA, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_CELL_ADDRESS, this, &GxCharacterPlane::writeRegister);
	memory.mapIoWrite(IO_GX_CHARACTER_CELL_DATA, this, &GxCharacterPlane::writeRegister);
}

void GxCharacterPlane::reset() {
	m_controlWord = 0u;
	m_paletteAddressWord = 0u;
	m_glyphAddressWord = 0u;
	m_cellAddressWord = 0u;
	m_paletteBytes.fill(0u);
	m_glyphBytes.fill(0u);
	m_cellBytes.fill(0u);
	publishPaletteRevision();
	publishGlyphRevision();
	publishCellRevision();
}

GxCharacterPlaneState GxCharacterPlane::captureState() const {
	GxCharacterPlaneState state;
	state.controlWord = m_controlWord;
	state.paletteAddressWord = m_paletteAddressWord;
	state.glyphAddressWord = m_glyphAddressWord;
	state.cellAddressWord = m_cellAddressWord;
	state.paletteBytes = m_paletteBytes;
	state.glyphBytes = m_glyphBytes;
	state.cellBytes = m_cellBytes;
	return state;
}

void GxCharacterPlane::restoreState(const GxCharacterPlaneState& state) {
	m_controlWord = state.controlWord;
	m_paletteAddressWord = state.paletteAddressWord;
	m_glyphAddressWord = state.glyphAddressWord;
	m_cellAddressWord = state.cellAddressWord;
	m_paletteBytes = state.paletteBytes;
	m_glyphBytes = state.glyphBytes;
	m_cellBytes = state.cellBytes;
	publishPaletteRevision();
	publishGlyphRevision();
	publishCellRevision();
}

const GxCharacterPlaneOutput& GxCharacterPlane::readDeviceOutput() {
	m_deviceOutput.controlWord = m_controlWord;
	m_deviceOutput.paletteRevision = m_paletteRevision;
	m_deviceOutput.glyphRevision = m_glyphRevision;
	m_deviceOutput.cellRevision = m_cellRevision;
	return m_deviceOutput;
}

void GxCharacterPlane::publishPaletteRevision() {
	nextGxCharacterPlaneRevision += 1u;
	m_paletteRevision = nextGxCharacterPlaneRevision;
}

void GxCharacterPlane::publishGlyphRevision() {
	nextGxCharacterPlaneRevision += 1u;
	m_glyphRevision = nextGxCharacterPlaneRevision;
}

void GxCharacterPlane::publishCellRevision() {
	nextGxCharacterPlaneRevision += 1u;
	m_cellRevision = nextGxCharacterPlaneRevision;
}

u64 GxCharacterPlane::readRegister(void* context, u32 address) {
	auto& plane = *static_cast<GxCharacterPlane*>(context);
	switch (address) {
		case IO_GX_CHARACTER_CONTROL:
			return valueNumber(static_cast<double>(plane.m_controlWord));
		case IO_GX_CHARACTER_PALETTE_ADDRESS:
			return valueNumber(static_cast<double>(plane.m_paletteAddressWord));
		case IO_GX_CHARACTER_PALETTE_DATA: {
			const size_t index = plane.m_paletteAddressWord & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1u);
			plane.m_paletteAddressWord = static_cast<u32>((index + 1u) & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1u));
			return valueNumber(static_cast<double>(readLE32(plane.m_paletteBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES)));
		}
		case IO_GX_CHARACTER_GLYPH_ADDRESS:
			return valueNumber(static_cast<double>(plane.m_glyphAddressWord));
		case IO_GX_CHARACTER_GLYPH_DATA: {
			const size_t index = plane.m_glyphAddressWord & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1u);
			plane.m_glyphAddressWord = static_cast<u32>((index + 1u) & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1u));
			return valueNumber(static_cast<double>(readLE32(plane.m_glyphBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES)));
		}
		case IO_GX_CHARACTER_CELL_ADDRESS:
			return valueNumber(static_cast<double>(plane.m_cellAddressWord));
		case IO_GX_CHARACTER_CELL_DATA: {
			const size_t index = plane.m_cellAddressWord % GX_CHARACTER_PLANE_CELL_WORDS;
			plane.m_cellAddressWord = index + 1u == GX_CHARACTER_PLANE_CELL_WORDS ? 0u : static_cast<u32>(index + 1u);
			return valueNumber(static_cast<double>(readLE32(plane.m_cellBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES)));
		}
	}
	throw BMSX_RUNTIME_ERROR("GX character-plane register read outside mapped registerfile.");
}

void GxCharacterPlane::writeRegister(void* context, u32 address, u64 value) {
	auto& plane = *static_cast<GxCharacterPlane*>(context);
	const u32 word = toU32(value);
	switch (address) {
		case IO_GX_CHARACTER_CONTROL:
			plane.m_controlWord = word;
			return;
		case IO_GX_CHARACTER_PALETTE_ADDRESS:
			plane.m_paletteAddressWord = word;
			return;
		case IO_GX_CHARACTER_PALETTE_DATA: {
			const size_t index = plane.m_paletteAddressWord & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1u);
			writeLE32(plane.m_paletteBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES, word);
			plane.m_paletteAddressWord = static_cast<u32>((index + 1u) & (GX_CHARACTER_PLANE_PALETTE_WORDS - 1u));
			plane.publishPaletteRevision();
			return;
		}
		case IO_GX_CHARACTER_GLYPH_ADDRESS:
			plane.m_glyphAddressWord = word;
			return;
		case IO_GX_CHARACTER_GLYPH_DATA: {
			const size_t index = plane.m_glyphAddressWord & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1u);
			writeLE32(plane.m_glyphBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES, word);
			plane.m_glyphAddressWord = static_cast<u32>((index + 1u) & (GX_CHARACTER_PLANE_GLYPH_WORDS - 1u));
			plane.publishGlyphRevision();
			return;
		}
		case IO_GX_CHARACTER_CELL_ADDRESS:
			plane.m_cellAddressWord = word;
			return;
		case IO_GX_CHARACTER_CELL_DATA: {
			const size_t index = plane.m_cellAddressWord % GX_CHARACTER_PLANE_CELL_WORDS;
			writeLE32(plane.m_cellBytes.data() + index * GX_CHARACTER_PLANE_WORD_BYTES, word);
			plane.m_cellAddressWord = index + 1u == GX_CHARACTER_PLANE_CELL_WORDS ? 0u : static_cast<u32>(index + 1u);
			plane.publishCellRevision();
			return;
		}
	}
	throw BMSX_RUNTIME_ERROR("GX character-plane register write outside mapped registerfile.");
}

} // namespace bmsx
