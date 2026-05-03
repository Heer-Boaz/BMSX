#include "render/vdp/skybox.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"

namespace bmsx {

void commitVdpSkyboxViewState(GameView& view, const VDP::VdpHostOutput& output) {
	if (!output.skyboxEnabled) {
		view.skyboxRenderReady = false;
		view.skyboxFaceUvRects = {};
		view.skyboxFaceTextpageBindings = {};
		view.skyboxFaceSizes = {};
		return;
	}
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		const VDP::ResolvedBlitterSample& sample = (*output.skyboxSamples)[index];
		const VDP::BlitterSource& source = sample.source;
		const size_t uvBase = index * 4u;
		view.skyboxFaceUvRects[uvBase + 0u] = static_cast<f32>(source.srcX) / static_cast<f32>(sample.surfaceWidth);
		view.skyboxFaceUvRects[uvBase + 1u] = static_cast<f32>(source.srcY) / static_cast<f32>(sample.surfaceHeight);
		view.skyboxFaceUvRects[uvBase + 2u] = static_cast<f32>(source.width) / static_cast<f32>(sample.surfaceWidth);
		view.skyboxFaceUvRects[uvBase + 3u] = static_cast<f32>(source.height) / static_cast<f32>(sample.surfaceHeight);
		view.skyboxFaceTextpageBindings[index] = static_cast<i32>(sample.slot);
		const size_t sizeBase = index * 2u;
		view.skyboxFaceSizes[sizeBase + 0u] = static_cast<i32>(source.width);
		view.skyboxFaceSizes[sizeBase + 1u] = static_cast<i32>(source.height);
	}
	view.skyboxRenderReady = true;
}

} // namespace bmsx
