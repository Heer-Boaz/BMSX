#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/fixed_point.h"
#include "machine/devices/vdp/lpu.h"
#include "render/gameview.h"
#include "render/vdp/transform.h"

namespace bmsx {
namespace {

void commitVdpLightingSnapshot(GameView& view, const std::array<u32, VDP_LPU_REGISTER_WORDS>& words) {
	view.vdpLightRegisterWords = words;
	const size_t ambientBase = VDP_LPU_AMBIENT_REGISTER_BASE;
	if ((words[ambientBase] & VDP_LPU_CONTROL_ENABLE) != 0u) {
		view.vdpAmbientLightColorIntensity[0] = decodeSignedQ16_16(words[ambientBase + 1u]);
		view.vdpAmbientLightColorIntensity[1] = decodeSignedQ16_16(words[ambientBase + 2u]);
		view.vdpAmbientLightColorIntensity[2] = decodeSignedQ16_16(words[ambientBase + 3u]);
		view.vdpAmbientLightColorIntensity[3] = decodeSignedQ16_16(words[ambientBase + 4u]);
	} else {
		view.vdpAmbientLightColorIntensity = {0.0f, 0.0f, 0.0f, 0.0f};
	}

	i32 dirCount = 0;
	for (size_t light = 0u; light < VDP_LPU_DIRECTIONAL_LIGHT_LIMIT; ++light) {
		const size_t base = VDP_LPU_DIRECTIONAL_REGISTER_BASE + light * VDP_LPU_DIRECTIONAL_REGISTER_WORDS;
		if ((words[base] & VDP_LPU_CONTROL_ENABLE) == 0u) {
			continue;
		}
		const size_t out = static_cast<size_t>(dirCount) * 3u;
		view.vdpDirectionalLightDirections[out] = decodeSignedQ16_16(words[base + 1u]);
		view.vdpDirectionalLightDirections[out + 1u] = decodeSignedQ16_16(words[base + 2u]);
		view.vdpDirectionalLightDirections[out + 2u] = decodeSignedQ16_16(words[base + 3u]);
		view.vdpDirectionalLightColors[out] = decodeSignedQ16_16(words[base + 4u]);
		view.vdpDirectionalLightColors[out + 1u] = decodeSignedQ16_16(words[base + 5u]);
		view.vdpDirectionalLightColors[out + 2u] = decodeSignedQ16_16(words[base + 6u]);
		view.vdpDirectionalLightIntensities[static_cast<size_t>(dirCount)] = decodeSignedQ16_16(words[base + 7u]);
		++dirCount;
	}
	view.vdpDirectionalLightCount = dirCount;

	i32 pointCount = 0;
	for (size_t light = 0u; light < VDP_LPU_POINT_LIGHT_LIMIT; ++light) {
		const size_t base = VDP_LPU_POINT_REGISTER_BASE + light * VDP_LPU_POINT_REGISTER_WORDS;
		if ((words[base] & VDP_LPU_CONTROL_ENABLE) == 0u) {
			continue;
		}
		const size_t out = static_cast<size_t>(pointCount) * 3u;
		const size_t paramOut = static_cast<size_t>(pointCount) * 2u;
		view.vdpPointLightPositions[out] = decodeSignedQ16_16(words[base + 1u]);
		view.vdpPointLightPositions[out + 1u] = decodeSignedQ16_16(words[base + 2u]);
		view.vdpPointLightPositions[out + 2u] = decodeSignedQ16_16(words[base + 3u]);
		view.vdpPointLightParams[paramOut] = decodeSignedQ16_16(words[base + 4u]);
		view.vdpPointLightColors[out] = decodeSignedQ16_16(words[base + 5u]);
		view.vdpPointLightColors[out + 1u] = decodeSignedQ16_16(words[base + 6u]);
		view.vdpPointLightColors[out + 2u] = decodeSignedQ16_16(words[base + 7u]);
		view.vdpPointLightParams[paramOut + 1u] = decodeSignedQ16_16(words[base + 8u]);
		++pointCount;
	}
	view.vdpPointLightCount = pointCount;
}

} // namespace

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
	commitVdpLightingSnapshot(view, *output.lightRegisterWords);
}

} // namespace bmsx
