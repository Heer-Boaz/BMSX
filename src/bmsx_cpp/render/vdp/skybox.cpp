#include "render/vdp/skybox.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/vdp/surfaces.h"

namespace bmsx {

void commitVdpSkyboxViewState(GameView& view, const VDP& vdp) {
	if (!vdp.committedSkyboxEnabled()) {
		view.skyboxRenderReady = false;
		view.skyboxFaceUvRects = {};
		view.skyboxFaceTextpageBindings = {};
		view.skyboxFaceSizes = {};
		return;
	}
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		const VDP::ResolvedBlitterSample sample = vdp.resolveCommittedSkyboxFaceSample(index);
		const VDP::BlitterSource& source = sample.source;
		const VdpRenderSurfaceInfo surface = resolveVdpRenderSurface(vdp, source.surfaceId);
		const size_t uvBase = index * 4u;
		view.skyboxFaceUvRects[uvBase + 0u] = static_cast<f32>(source.srcX) / static_cast<f32>(surface.width);
		view.skyboxFaceUvRects[uvBase + 1u] = static_cast<f32>(source.srcY) / static_cast<f32>(surface.height);
		view.skyboxFaceUvRects[uvBase + 2u] = static_cast<f32>(source.width) / static_cast<f32>(surface.width);
		view.skyboxFaceUvRects[uvBase + 3u] = static_cast<f32>(source.height) / static_cast<f32>(surface.height);
		view.skyboxFaceTextpageBindings[index] = static_cast<i32>(sample.slot);
		const size_t sizeBase = index * 2u;
		view.skyboxFaceSizes[sizeBase + 0u] = static_cast<i32>(source.width);
		view.skyboxFaceSizes[sizeBase + 1u] = static_cast<i32>(source.height);
	}
	view.skyboxRenderReady = true;
}

} // namespace bmsx
