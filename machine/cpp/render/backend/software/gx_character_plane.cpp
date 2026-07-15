#include "render/backend/software/gx_character_plane.h"

#include "common/endian.h"
#include "machine/devices/gx/character_plane.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"

namespace bmsx {

void renderGxCharacterPlaneSoftware(
	SoftwareBackend& backend,
	GxCharacterPlaneSoftwarePipeline& pipeline,
	const GxCharacterPlanePipelineState& state) {
	const GxCharacterPlaneOutput& output = *state.output;
	if (pipeline.paletteRevision != output.paletteRevision) {
		writeGxCharacterPlanePaletteTexture(output.paletteBytes, pipeline.palettePixels);
		for (size_t index = 0u; index < GX_CHARACTER_PLANE_PALETTE_WORDS; index += 1u) {
			const size_t offset = index * 4u;
			pipeline.paletteColors[index] = pipeline.palettePixels[offset + 3u] == 0u
				? 0u
				: 0xff000000u
					| (static_cast<u32>(pipeline.palettePixels[offset]) << 16u)
					| (static_cast<u32>(pipeline.palettePixels[offset + 1u]) << 8u)
					| static_cast<u32>(pipeline.palettePixels[offset + 2u]);
		}
		pipeline.paletteRevision = output.paletteRevision;
	}

	i32 columnCount = (state.width + static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_WIDTH) - 1) / static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_WIDTH);
	if (columnCount > static_cast<i32>(GX_CHARACTER_PLANE_COLUMNS)) {
		columnCount = static_cast<i32>(GX_CHARACTER_PLANE_COLUMNS);
	}
	i32 rowCount = (state.height + static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_HEIGHT) - 1) / static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_HEIGHT);
	if (rowCount > static_cast<i32>(GX_CHARACTER_PLANE_ROWS)) {
		rowCount = static_cast<i32>(GX_CHARACTER_PLANE_ROWS);
	}
	u32* const framebuffer = backend.framebuffer();
	const size_t pixelsPerRow = static_cast<size_t>(backend.pitch()) / sizeof(u32);

	for (i32 row = 0; row < rowCount; row += 1) {
		const i32 targetY = row * static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_HEIGHT);
		i32 cellHeight = state.height - targetY;
		if (cellHeight > static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_HEIGHT)) {
			cellHeight = static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_HEIGHT);
		}
		for (i32 column = 0; column < columnCount; column += 1) {
			const size_t cellIndex = static_cast<size_t>(row) * GX_CHARACTER_PLANE_COLUMNS + static_cast<size_t>(column);
			const u32 cellWord = readLE32(output.cellBytes.data() + cellIndex * GX_CHARACTER_PLANE_WORD_BYTES);
			const u32 glyphWord = readLE32(output.glyphBytes.data() + (cellWord & GX_CHARACTER_PLANE_CELL_GLYPH_MASK) * GX_CHARACTER_PLANE_WORD_BYTES);
			const u32 foreground = pipeline.paletteColors[(cellWord >> GX_CHARACTER_PLANE_CELL_FOREGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK];
			const u32 background = pipeline.paletteColors[(cellWord >> GX_CHARACTER_PLANE_CELL_BACKGROUND_SHIFT) & GX_CHARACTER_PLANE_CELL_PALETTE_MASK];
			if (foreground == 0u && background == 0u) {
				continue;
			}
			const i32 targetX = column * static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_WIDTH);
			i32 cellWidth = state.width - targetX;
			if (cellWidth > static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_WIDTH)) {
				cellWidth = static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_WIDTH);
			}
			for (i32 y = 0; y < cellHeight; y += 1) {
				u32* target = framebuffer
					+ static_cast<size_t>(targetY + y) * pixelsPerRow
					+ static_cast<size_t>(targetX);
				for (i32 x = 0; x < cellWidth; x += 1) {
					const u32 color = (glyphWord & (1u << (static_cast<u32>(y) * GX_CHARACTER_PLANE_GLYPH_WIDTH + static_cast<u32>(x)))) == 0u
						? background
						: foreground;
					if (color != 0u) {
						target[x] = color;
					}
				}
			}
		}
	}
}

void registerGxCharacterPlanePassSoftware(RenderPassLibrary& registry, GxCharacterPlaneSoftwarePipeline& pipeline) {
	RenderPassDef desc;
	desc.id = "gx_character_plane";
	desc.name = "GXCharacterPlane";
	setGxCharacterPlaneGraph(desc);
	desc.shouldExecute = shouldExecuteGxCharacterPlanePass;
	desc.context = &pipeline;
	desc.exec = executePipelineRenderPass<
		SoftwareBackend,
		GxCharacterPlaneSoftwarePipeline,
		GxCharacterPlanePipelineState,
		&RenderPassStateStorage::gxCharacterPlane,
		renderGxCharacterPlaneSoftware>;
	registry.registerPass(desc);
}

} // namespace bmsx
