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
	view.vdpBillboardCount = billboards.length;
	for (size_t index = 0; index < billboards.length; ++index) {
		GameView::VdpBillboardRenderEntry& target = view.vdpBillboards[index];
		target.position = {billboards.positionX[index], billboards.positionY[index], billboards.positionZ[index]};
		target.size = billboards.size[index];
		target.color = billboards.color[index];
		target.slot = billboards.slot[index];
		target.surfaceId = billboards.sourceSurfaceId[index];
		target.u = billboards.sourceSrcX[index];
		target.v = billboards.sourceSrcY[index];
		target.w = billboards.sourceWidth[index];
		target.h = billboards.sourceHeight[index];
		target.uv0 = {
			static_cast<f32>(billboards.sourceSrcX[index]) / static_cast<f32>(billboards.surfaceWidth[index]),
			static_cast<f32>(billboards.sourceSrcY[index]) / static_cast<f32>(billboards.surfaceHeight[index]),
		};
		target.uv1 = {
			static_cast<f32>(billboards.sourceSrcX[index] + billboards.sourceWidth[index]) / static_cast<f32>(billboards.surfaceWidth[index]),
			static_cast<f32>(billboards.sourceSrcY[index] + billboards.sourceHeight[index]) / static_cast<f32>(billboards.surfaceHeight[index]),
		};
	}
	const auto& meshes = *output.meshes;
	view.vdpMeshCount = meshes.length;
	for (size_t index = 0; index < meshes.length; ++index) {
		GameView::VdpMeshRenderEntry& target = view.vdpMeshes[index];
		target.modelTokenLo = meshes.modelTokenLo[index];
		target.modelTokenHi = meshes.modelTokenHi[index];
		target.meshIndex = meshes.meshIndex[index];
		target.materialIndex = meshes.materialIndex[index];
		target.modelMatrixIndex = meshes.modelMatrixIndex[index];
		target.control = meshes.control[index];
		target.color = meshes.color[index];
		target.morphBase = meshes.morphBase[index];
		target.morphCount = meshes.morphCount[index];
		target.jointBase = meshes.jointBase[index];
		target.jointCount = meshes.jointCount[index];
	}
	view.vdpMorphWeightWords = *output.morphWeightWords;
	view.vdpJointMatrixWords = *output.jointMatrixWords;
}

} // namespace bmsx
