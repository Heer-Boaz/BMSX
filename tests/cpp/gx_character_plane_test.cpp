#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/devices/gx/character_plane.h"
#include "machine/memory/memory.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_character_plane.h"
#include "render/gx/character_plane_resources.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

struct CharacterPlaneHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::GxCharacterPlane plane;

	CharacterPlaneHarness()
		: memory(bmsx::MemoryInit{{emptyRom.data(), 0u}, {emptyRom.data(), 0u}})
		, plane(memory) {
		plane.reset();
	}
};

void testRawIndexedRegisterfiles() {
	CharacterPlaneHarness harness;
	const bmsx::GxCharacterPlaneOutput& resetOutput = harness.plane.readDeviceOutput();

	require(resetOutput.controlWord == 0u, "GX character plane resets disabled");
	require(bmsx::readLE32(resetOutput.paletteBytes.data()) == 0u, "GX character palette SRAM resets clear");
	require(bmsx::readLE32(resetOutput.glyphBytes.data()) == 0u, "GX character glyph SRAM resets clear");
	require(bmsx::readLE32(resetOutput.cellBytes.data()) == 0u, "GX character cell SRAM resets clear");

	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CONTROL, 0x80000000u | bmsx::GX_CHARACTER_PLANE_CONTROL_ENABLE);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_CONTROL) == 0x80000001u, "GX character control retains raw word");

	const bmsx::u32 paletteRevisionBeforeWrite = harness.plane.readDeviceOutput().paletteRevision;
	const bmsx::u32 glyphRevisionBeforePaletteWrite = harness.plane.readDeviceOutput().glyphRevision;
	const bmsx::u32 cellRevisionBeforePaletteWrite = harness.plane.readDeviceOutput().cellRevision;
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, static_cast<bmsx::u32>(bmsx::GX_CHARACTER_PLANE_PALETTE_WORDS - 1u));
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0x89abcdefu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0x01234567u);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS) == 1u, "GX character palette address wraps");
	require(bmsx::readLE32(resetOutput.paletteBytes.data() + (bmsx::GX_CHARACTER_PLANE_PALETTE_WORDS - 1u) * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0x89abcdefu, "GX character palette stores high raw word");
	require(bmsx::readLE32(resetOutput.paletteBytes.data()) == 0x01234567u, "GX character palette stores wrapped raw word");
	require(harness.plane.readDeviceOutput().paletteRevision != paletteRevisionBeforeWrite, "GX character palette write publishes palette revision");
	require(harness.plane.readDeviceOutput().glyphRevision == glyphRevisionBeforePaletteWrite, "GX character palette write preserves glyph revision");
	require(harness.plane.readDeviceOutput().cellRevision == cellRevisionBeforePaletteWrite, "GX character palette write preserves cell revision");

	const bmsx::u32 paletteRevisionBeforeGlyphWrite = harness.plane.readDeviceOutput().paletteRevision;
	const bmsx::u32 glyphRevisionBeforeWrite = harness.plane.readDeviceOutput().glyphRevision;
	const bmsx::u32 cellRevisionBeforeGlyphWrite = harness.plane.readDeviceOutput().cellRevision;
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS, static_cast<bmsx::u32>(bmsx::GX_CHARACTER_PLANE_GLYPH_WORDS - 1u));
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_DATA, 0xfedcba98u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_DATA, 0x76543210u);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS) == 1u, "GX character glyph address wraps");
	require(bmsx::readLE32(resetOutput.glyphBytes.data() + (bmsx::GX_CHARACTER_PLANE_GLYPH_WORDS - 1u) * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0xfedcba98u, "GX character glyph stores high raw word");
	require(bmsx::readLE32(resetOutput.glyphBytes.data()) == 0x76543210u, "GX character glyph stores wrapped raw word");
	require(harness.plane.readDeviceOutput().paletteRevision == paletteRevisionBeforeGlyphWrite, "GX character glyph write preserves palette revision");
	require(harness.plane.readDeviceOutput().glyphRevision != glyphRevisionBeforeWrite, "GX character glyph write publishes glyph revision");
	require(harness.plane.readDeviceOutput().cellRevision == cellRevisionBeforeGlyphWrite, "GX character glyph write preserves cell revision");

	const bmsx::u32 paletteRevisionBeforeCellWrite = harness.plane.readDeviceOutput().paletteRevision;
	const bmsx::u32 glyphRevisionBeforeCellWrite = harness.plane.readDeviceOutput().glyphRevision;
	const bmsx::u32 cellRevisionBeforeWrite = harness.plane.readDeviceOutput().cellRevision;
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, static_cast<bmsx::u32>(bmsx::GX_CHARACTER_PLANE_CELL_WORDS - 1u));
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0xdeadbeefu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0x13579bdfu);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS) == 1u, "GX character cell address wraps");
	require(bmsx::readLE32(resetOutput.cellBytes.data() + (bmsx::GX_CHARACTER_PLANE_CELL_WORDS - 1u) * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0xdeadbeefu, "GX character cell stores high raw word");
	require(bmsx::readLE32(resetOutput.cellBytes.data()) == 0x13579bdfu, "GX character cell stores wrapped raw word");
	require(harness.plane.readDeviceOutput().paletteRevision == paletteRevisionBeforeCellWrite, "GX character cell write preserves palette revision");
	require(harness.plane.readDeviceOutput().glyphRevision == glyphRevisionBeforeCellWrite, "GX character cell write preserves glyph revision");
	require(harness.plane.readDeviceOutput().cellRevision != cellRevisionBeforeWrite, "GX character cell write publishes cell revision");

	const bmsx::GxCharacterPlaneOutput& output = harness.plane.readDeviceOutput();
	require(&output == &resetOutput, "GX character output is retained");
	const bmsx::u32 paletteRevisionBeforeReset = output.paletteRevision;
	const bmsx::u32 glyphRevisionBeforeReset = output.glyphRevision;
	const bmsx::u32 cellRevisionBeforeReset = output.cellRevision;
	harness.plane.reset();
	require(harness.plane.readDeviceOutput().controlWord == 0u, "GX character reset disables plane after writes");
	require(bmsx::readLE32(output.paletteBytes.data()) == 0u, "GX character reset clears written palette SRAM");
	require(bmsx::readLE32(output.glyphBytes.data()) == 0u, "GX character reset clears written glyph SRAM");
	require(bmsx::readLE32(output.cellBytes.data()) == 0u, "GX character reset clears written cell SRAM");
	require(output.paletteRevision != paletteRevisionBeforeReset, "GX character reset republishes palette SRAM");
	require(output.glyphRevision != glyphRevisionBeforeReset, "GX character reset republishes glyph SRAM");
	require(output.cellRevision != cellRevisionBeforeReset, "GX character reset republishes cell SRAM");
}

void testDataReadNormalization() {
	CharacterPlaneHarness harness;

	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, 0xffffffffu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0xa1b2c3d4u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, 0xffffffffu);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA) == 0xa1b2c3d4u, "GX character palette data read uses low address bits");
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS) == 0u, "GX character palette data read advances wrapped address");

	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 0xffffffffu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0x2468ace0u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 0xffffffffu);
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA) == 0x2468ace0u, "GX character cell data read uses modulo address");
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS) == (0xffffffffu % bmsx::GX_CHARACTER_PLANE_CELL_WORDS) + 1u, "GX character cell data read advances modulo address");
}

void testStateRestore() {
	CharacterPlaneHarness harness;

	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CONTROL, 0xf0000001u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, 3u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0x80007c00u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS, 65u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_DATA, 0x00f99f90u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 321u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0xabcd1241u);
	const bmsx::GxCharacterPlaneState state = harness.plane.captureState();
	const bmsx::GxCharacterPlaneOutput& output = harness.plane.readDeviceOutput();
	const auto* paletteBytes = &output.paletteBytes;
	const auto* glyphBytes = &output.glyphBytes;
	const auto* cellBytes = &output.cellBytes;

	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CONTROL, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, 3u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS, 65u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_DATA, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 321u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0u);
	const bmsx::u32 changedRevision = harness.plane.readDeviceOutput().cellRevision;

	harness.plane.restoreState(state);
	const bmsx::GxCharacterPlaneOutput& restored = harness.plane.readDeviceOutput();
	require(&restored.paletteBytes == paletteBytes, "GX character palette output storage remains stable");
	require(&restored.glyphBytes == glyphBytes, "GX character glyph output storage remains stable");
	require(&restored.cellBytes == cellBytes, "GX character cell output storage remains stable");
	require(restored.controlWord == 0xf0000001u, "GX character control restores");
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS) == 4u, "GX character palette address restores");
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS) == 66u, "GX character glyph address restores");
	require(harness.memory.readMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS) == 322u, "GX character cell address restores");
	require(bmsx::readLE32(restored.paletteBytes.data() + 3u * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0x80007c00u, "GX character palette SRAM restores");
	require(bmsx::readLE32(restored.glyphBytes.data() + 65u * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0x00f99f90u, "GX character glyph SRAM restores");
	require(bmsx::readLE32(restored.cellBytes.data() + 321u * bmsx::GX_CHARACTER_PLANE_WORD_BYTES) == 0xabcd1241u, "GX character cell SRAM restores");
	require(restored.cellRevision != changedRevision, "GX character restore republishes cell SRAM");
}

void testBackendResourcesAndSoftwareComposition() {
	CharacterPlaneHarness harness;
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_ADDRESS, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0x801fu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_PALETTE_DATA, 0xfc00u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_ADDRESS, 65u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_GLYPH_DATA, 1u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 0u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0x2141u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_ADDRESS, 160u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_CHARACTER_CELL_DATA, 0x2141u);
	const bmsx::GxCharacterPlaneOutput& output = harness.plane.readDeviceOutput();

	std::array<bmsx::u8, bmsx::GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES> cellPixels{};
	std::array<bmsx::u8, bmsx::GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES> glyphPixels{};
	std::array<bmsx::u8, bmsx::GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES> palettePixels{};
	bmsx::writeGxCharacterPlaneCellTexture(output.cellBytes, cellPixels);
	bmsx::writeGxCharacterPlaneGlyphTexture(output.glyphBytes, glyphPixels);
	bmsx::writeGxCharacterPlanePaletteTexture(output.paletteBytes, palettePixels);
	require(cellPixels[0u] == 65u && cellPixels[1u] == 1u && cellPixels[2u] == 2u && cellPixels[3u] == 255u, "GX character cell texture encodes glyph and palette indexes");
	const size_t secondRowOffset = bmsx::GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH * 4u;
	require(cellPixels[secondRowOffset] == 65u && cellPixels[secondRowOffset + 1u] == 1u && cellPixels[secondRowOffset + 2u] == 2u, "GX character cell texture retains hardware row stride");
	const size_t glyphOffset = (24u * bmsx::GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH + 4u) * 4u;
	require(glyphPixels[glyphOffset] == 255u && glyphPixels[glyphOffset + 4u] == 0u, "GX character glyph texture expands packed mask bits");
	require(palettePixels[4u] == 255u && palettePixels[5u] == 0u && palettePixels[6u] == 0u && palettePixels[7u] == 255u, "GX character palette texture expands opaque red");
	require(palettePixels[8u] == 0u && palettePixels[9u] == 0u && palettePixels[10u] == 255u && palettePixels[11u] == 255u, "GX character palette texture expands opaque blue");

	std::array<bmsx::u32, 5u * 7u> framebuffer{};
	framebuffer.fill(0xff090a0bu);
	bmsx::SoftwareBackend backend(framebuffer.data(), 5, 7, 5 * static_cast<bmsx::i32>(sizeof(bmsx::u32)));
	bmsx::GxCharacterPlaneSoftwarePipeline pipeline;
	const bmsx::GxCharacterPlanePipelineState state{5, 7, &output};
	bmsx::renderGxCharacterPlaneSoftware(backend, pipeline, state);
	require(framebuffer[0u] == 0xffff0000u, "GX character software composition draws foreground mask bits");
	require(framebuffer[1u] == 0xff0000ffu, "GX character software composition draws background pixels");
	require(framebuffer[4u] == 0xff090a0bu, "GX character software composition preserves transparent clipped column");
	require(framebuffer[5u * 6u] == 0xffff0000u, "GX character software composition clips the final cell row");
}

} // namespace

int main() {
	testRawIndexedRegisterfiles();
	testDataReadNormalization();
	testStateRestore();
	testBackendResourcesAndSoftwareComposition();
	return 0;
}
