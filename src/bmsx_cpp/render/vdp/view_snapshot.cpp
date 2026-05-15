#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/device_output.h"
#include "render/gameview.h"
#include "render/vdp/transform.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VdpDeviceOutput& output) {
	view.dither_type = static_cast<GameView::DitherType>(output.ditherType);
	resolveVdpTransformSnapshot(view.vdpTransform, *output.xfMatrixWords, output.xfViewMatrixIndex, output.xfProjectionMatrixIndex);
	view.vdpXfMatrixWords = *output.xfMatrixWords;
	if (!output.skyboxEnabled) {
		view.skyboxRenderReady = false;
	} else {
		for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
			const VdpResolvedBlitterSample& sample = (*output.skyboxSamples)[index];
			const VdpBlitterSource& source = sample.source;
			const size_t uvBase = index * 4u;
			view.skyboxFaceUvRects[uvBase + 0u] = static_cast<f32>(source.srcX) / static_cast<f32>(sample.surfaceWidth);
			view.skyboxFaceUvRects[uvBase + 1u] = static_cast<f32>(source.srcY) / static_cast<f32>(sample.surfaceHeight);
			view.skyboxFaceUvRects[uvBase + 2u] = static_cast<f32>(source.width) / static_cast<f32>(sample.surfaceWidth);
			view.skyboxFaceUvRects[uvBase + 3u] = static_cast<f32>(source.height) / static_cast<f32>(sample.surfaceHeight);
			view.skyboxFaceTextpageBindings[index] = static_cast<i32>(sample.slot);
			view.skyboxFaceSurfaceIds[index] = source.surfaceId;
			const size_t sizeBase = index * 2u;
			view.skyboxFaceSizes[sizeBase + 0u] = static_cast<i32>(source.width);
			view.skyboxFaceSizes[sizeBase + 1u] = static_cast<i32>(source.height);
		}
		view.skyboxRenderReady = true;
	}
	const auto& billboards = *output.billboards;
	view.vdpBillboardCount = billboards.size();
	for (size_t index = 0; index < billboards.size(); ++index) {
		const VdpBbuBillboardEntry& entry = billboards[index];
		GameView::VdpBillboardRenderEntry& target = view.vdpBillboards[index];
		target.position = {entry.positionX, entry.positionY, entry.positionZ};
		target.size = entry.size;
		target.color = entry.color;
		target.slot = entry.slot;
		target.surfaceId = entry.source.surfaceId;
		target.u = entry.source.srcX;
		target.v = entry.source.srcY;
		target.w = entry.source.width;
		target.h = entry.source.height;
		target.uv0 = {
			static_cast<f32>(entry.source.srcX) / static_cast<f32>(entry.surfaceWidth),
			static_cast<f32>(entry.source.srcY) / static_cast<f32>(entry.surfaceHeight),
		};
		target.uv1 = {
			static_cast<f32>(entry.source.srcX + entry.source.width) / static_cast<f32>(entry.surfaceWidth),
			static_cast<f32>(entry.source.srcY + entry.source.height) / static_cast<f32>(entry.surfaceHeight),
		};
	}
	const auto& meshes = *output.meshes;
	view.vdpMeshCount = meshes.size();
	for (size_t index = 0; index < meshes.size(); ++index) {
		const VdpMduMeshEntry& entry = meshes[index];
		GameView::VdpMeshRenderEntry& target = view.vdpMeshes[index];
		target.modelTokenLo = entry.modelTokenLo;
		target.modelTokenHi = entry.modelTokenHi;
		target.meshIndex = entry.meshIndex;
		target.materialIndex = entry.materialIndex;
		target.modelMatrixIndex = entry.modelMatrixIndex;
		target.control = entry.control;
		target.color = entry.color;
		target.morphBase = entry.morphBase;
		target.morphCount = entry.morphCount;
		target.jointBase = entry.jointBase;
		target.jointCount = entry.jointCount;
	}
	view.vdpMorphWeightWords = *output.morphWeightWords;
	view.vdpJointMatrixWords = *output.jointMatrixWords;
}

} // namespace bmsx
