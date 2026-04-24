#include "render/vdp/skybox.h"

#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/memory.h"
#include "render/gameview.h"
#include "render/vdp/surfaces.h"
#include "rompack/format.h"
#include <array>

namespace bmsx {

void commitVdpSkyboxViewState(GameView& view, const VDP& vdp, Memory& memory) {
	if (!vdp.committedHasSkybox()) {
		view.skyboxFaceIds = {};
		view.skyboxRenderReady = false;
		view.skyboxFaceUvRects = {};
		view.skyboxFaceAtlasBindings = {};
		view.skyboxFaceSizes = {};
		return;
	}
	const SkyboxImageIds& ids = vdp.committedSkyboxFaceIds();
	view.skyboxFaceIds = ids;
	const std::array<const std::string*, SKYBOX_FACE_COUNT> faces = {{&ids.posx, &ids.negx, &ids.posy, &ids.negy, &ids.posz, &ids.negz}};
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		const std::string& assetId = *faces[index];
		const VDP::BlitterSource source = vdp.resolveBlitterSource(memory.resolveAssetHandle(assetId));
		const VdpRenderSurfaceInfo surface = resolveVdpRenderSurface(vdp, source.surfaceId);
		const i32 atlasBinding = resolveVdpSurfaceAtlasBinding(source.surfaceId);
		if (atlasBinding == ENGINE_ATLAS_INDEX) {
			throw vdpFault("skybox image '" + assetId + "' must live in primary/secondary atlas space, not the engine atlas.");
		}
		const size_t uvBase = index * 4u;
		view.skyboxFaceUvRects[uvBase + 0u] = static_cast<f32>(source.srcX) / static_cast<f32>(surface.width);
		view.skyboxFaceUvRects[uvBase + 1u] = static_cast<f32>(source.srcY) / static_cast<f32>(surface.height);
		view.skyboxFaceUvRects[uvBase + 2u] = static_cast<f32>(source.width) / static_cast<f32>(surface.width);
		view.skyboxFaceUvRects[uvBase + 3u] = static_cast<f32>(source.height) / static_cast<f32>(surface.height);
		view.skyboxFaceAtlasBindings[index] = atlasBinding;
		const size_t sizeBase = index * 2u;
		view.skyboxFaceSizes[sizeBase + 0u] = static_cast<i32>(source.width);
		view.skyboxFaceSizes[sizeBase + 1u] = static_cast<i32>(source.height);
	}
	view.skyboxRenderReady = true;
}

} // namespace bmsx
