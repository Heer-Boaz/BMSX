#pragma once

#include "render/gx/character_plane_resources.h"

#include <array>

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
struct GxCharacterPlanePipelineState;

struct GxCharacterPlaneSoftwarePipeline {
	std::array<u8, GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES> palettePixels{};
	std::array<u32, GX_CHARACTER_PLANE_PALETTE_WORDS> paletteColors{};
	u32 paletteRevision = 0u;
};

void renderGxCharacterPlaneSoftware(
	SoftwareBackend& backend,
	GxCharacterPlaneSoftwarePipeline& pipeline,
	const GxCharacterPlanePipelineState& state);
void registerGxCharacterPlanePassSoftware(RenderPassLibrary& registry, GxCharacterPlaneSoftwarePipeline& pipeline);

} // namespace bmsx
