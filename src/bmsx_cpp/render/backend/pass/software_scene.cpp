#include "render/backend/pass/software_scene.h"

#include "render/backend/pass/library.h"

#include "core/console.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"
#include "render/gameview.h"
#include "render/shared/queues.h"
#include "render/shared/software_pixels.h"
#include "render/vdp/source_pixels.h"
#include <array>

namespace bmsx {
namespace {

struct SoftwareParticleViewState {
	i32 width = 0;
	i32 height = 0;
	std::array<f32, 16> viewProj{};
	std::array<f32, 3> camRight{};
};

struct SoftwareSkyboxFaceUv {
	f32 u = 0.0f;
	f32 v = 0.0f;
};


SoftwareParticleViewState resolveParticleViewState(const GameView& view) {
	SoftwareParticleViewState state;
	state.width = static_cast<i32>(view.offscreenCanvasSize.x);
	state.height = static_cast<i32>(view.offscreenCanvasSize.y);
	const VdpTransformSnapshot& transform = view.vdpTransform;
	state.viewProj = transform.viewProj;
	state.camRight = { transform.view[0], transform.view[4], transform.view[8] };
	return state;
}

u32 surfaceIdForParticleSlot(u32 slot) {
	switch (slot) {
		case VDP_SLOT_PRIMARY: return VDP_RD_SURFACE_PRIMARY;
		case VDP_SLOT_SECONDARY: return VDP_RD_SURFACE_SECONDARY;
		case VDP_SLOT_SYSTEM: return VDP_RD_SURFACE_SYSTEM;
	}
	throw BMSX_RUNTIME_ERROR("[SoftwareScene] Particle slot is outside the VDP texture slot set.");
}

size_t resolveSkyboxFace(f32 dirX, f32 dirY, f32 dirZ, SoftwareSkyboxFaceUv& uv) {
	const f32 absX = dirX < 0.0f ? -dirX : dirX;
	const f32 absY = dirY < 0.0f ? -dirY : dirY;
	const f32 absZ = dirZ < 0.0f ? -dirZ : dirZ;
	if (absX >= absY && absX >= absZ) {
		if (dirX >= 0.0f) {
			uv.u = (-dirZ / absX) * 0.5f + 0.5f;
			uv.v = (-dirY / absX) * 0.5f + 0.5f;
			return 0u;
		}
		uv.u = (dirZ / absX) * 0.5f + 0.5f;
		uv.v = (-dirY / absX) * 0.5f + 0.5f;
		return 1u;
	}
	if (absY >= absZ) {
		if (dirY >= 0.0f) {
			uv.u = (dirX / absY) * 0.5f + 0.5f;
			uv.v = (dirZ / absY) * 0.5f + 0.5f;
			return 2u;
		}
		uv.u = (dirX / absY) * 0.5f + 0.5f;
		uv.v = (-dirZ / absY) * 0.5f + 0.5f;
		return 3u;
	}
	if (dirZ >= 0.0f) {
		uv.u = (dirX / absZ) * 0.5f + 0.5f;
		uv.v = (-dirY / absZ) * 0.5f + 0.5f;
		return 4u;
	}
	uv.u = (-dirX / absZ) * 0.5f + 0.5f;
	uv.v = (-dirY / absZ) * 0.5f + 0.5f;
	return 5u;
}

void writeSkyboxToFramebuffer(SoftwareBackend& backend, Runtime& runtime, const std::array<f32, 16>& skyboxView) {
	std::array<VDP::ResolvedBlitterSample, SKYBOX_FACE_COUNT> samples{};
	std::array<VdpSurfacePixels, SKYBOX_FACE_COUNT> textures{};
	VDP& vdp = runtime.machine.vdp;
	const VDP::VdpHostOutput output = vdp.readHostOutput();
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		samples[index] = (*output.skyboxSamples)[index];
		textures[index] = resolveVdpSurfacePixels(output, samples[index].source.surfaceId);
	}
	u32* framebuffer = backend.framebuffer();
	const i32 width = backend.width();
	const i32 height = backend.height();
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	SoftwareSkyboxFaceUv faceUv;
	for (i32 y = 0; y < height; ++y) {
		const f32 rayY = 1.0f - (static_cast<f32>((y * 2) + 1) / static_cast<f32>(height));
		u32* targetRow = framebuffer + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < width; ++x) {
			const f32 rayX = (static_cast<f32>((x * 2) + 1) / static_cast<f32>(width)) - 1.0f;
			const f32 dirX = skyboxView[0] * rayX + skyboxView[4] * rayY + skyboxView[8];
			const f32 dirY = skyboxView[1] * rayX + skyboxView[5] * rayY + skyboxView[9];
			const f32 dirZ = skyboxView[2] * rayX + skyboxView[6] * rayY + skyboxView[10];
			const size_t faceIndex = resolveSkyboxFace(dirX, dirY, dirZ, faceUv);
			const VDP::ResolvedBlitterSample& sample = samples[faceIndex];
			const VDP::BlitterSource& source = sample.source;
			const VdpSurfacePixels& texture = textures[faceIndex];
			u32 faceX = static_cast<u32>(faceUv.u * static_cast<f32>(source.width));
			u32 faceY = static_cast<u32>(faceUv.v * static_cast<f32>(source.height));
			if (faceX >= source.width) {
				faceX = source.width - 1u;
			}
			if (faceY >= source.height) {
				faceY = source.height - 1u;
			}
			const u32 srcX = source.srcX + faceX;
			const u32 srcY = source.srcY + faceY;
			const u8* sourceRow = texture.pixels + static_cast<size_t>(srcY) * texture.stride;
			const u8* pixel = sourceRow + static_cast<size_t>(srcX) * 4u;
			targetRow[x] = packSoftwareArgb(pixel[0], pixel[1], pixel[2], pixel[3]);
		}
	}
}

void drawSoftwareBillboardSample(SoftwareBackend& backend,
	const VDP::VdpHostOutput& output,
	const SoftwareParticleViewState& state,
	u32 slot,
	u32 u,
	u32 v,
	u32 w,
	u32 h,
	const Vec3& position,
	f32 size,
	u32 color) {
	const u32 surfaceId = surfaceIdForParticleSlot(slot);
	const VdpSurfacePixels texture = resolveVdpSurfacePixels(output, surfaceId);
	const i32 sourceX = static_cast<i32>(u);
	const i32 sourceY = static_cast<i32>(v);
	const i32 sourceW = static_cast<i32>(w);
	const i32 sourceH = static_cast<i32>(h);

	const auto& viewProj = state.viewProj;
	const f32 clipX = viewProj[0] * position.x + viewProj[4] * position.y + viewProj[8] * position.z + viewProj[12];
	const f32 clipY = viewProj[1] * position.x + viewProj[5] * position.y + viewProj[9] * position.z + viewProj[13];
	const f32 clipW = viewProj[3] * position.x + viewProj[7] * position.y + viewProj[11] * position.z + viewProj[15];
	if (clipW <= 0.0f) {
		return;
	}
	const f32 ndcX = clipX / clipW;
	const f32 ndcY = clipY / clipW;
	const i32 centerX = static_cast<i32>((ndcX * 0.5f + 0.5f) * static_cast<f32>(state.width));
	const i32 centerY = static_cast<i32>((0.5f - ndcY * 0.5f) * static_cast<f32>(state.height));
	const f32 halfWorld = size * 0.5f;
	const f32 edgePositionX = position.x + state.camRight[0] * halfWorld;
	const f32 edgePositionY = position.y + state.camRight[1] * halfWorld;
	const f32 edgePositionZ = position.z + state.camRight[2] * halfWorld;
	const f32 edgeClipX = viewProj[0] * edgePositionX + viewProj[4] * edgePositionY + viewProj[8] * edgePositionZ + viewProj[12];
	const f32 edgeClipY = viewProj[1] * edgePositionX + viewProj[5] * edgePositionY + viewProj[9] * edgePositionZ + viewProj[13];
	const f32 edgeClipW = viewProj[3] * edgePositionX + viewProj[7] * edgePositionY + viewProj[11] * edgePositionZ + viewProj[15];
	if (edgeClipW <= 0.0f) {
		return;
	}
	const f32 edgeNdcX = edgeClipX / edgeClipW;
	const f32 edgeNdcY = edgeClipY / edgeClipW;
	const i32 edgeScreenX = static_cast<i32>((edgeNdcX * 0.5f + 0.5f) * static_cast<f32>(state.width));
	const i32 edgeScreenY = static_cast<i32>((0.5f - edgeNdcY * 0.5f) * static_cast<f32>(state.height));
	i32 halfX = edgeScreenX - centerX;
	i32 halfY = edgeScreenY - centerY;
	if (halfX < 0) {
		halfX = -halfX;
	}
	if (halfY < 0) {
		halfY = -halfY;
	}
	i32 half = halfX > halfY ? halfX : halfY;
	if (half < 1) {
		half = 1;
	}
	const i32 startX = centerX - half < 0 ? 0 : centerX - half;
	const i32 startY = centerY - half < 0 ? 0 : centerY - half;
	const i32 endX = centerX + half > state.width ? state.width : centerX + half;
	const i32 endY = centerY + half > state.height ? state.height : centerY + half;
	if (startX >= endX || startY >= endY) {
		return;
	}

	const SoftwareColorBytes tint{
		static_cast<u8>((color >> 16u) & 0xffu),
		static_cast<u8>((color >> 8u) & 0xffu),
		static_cast<u8>(color & 0xffu),
		static_cast<u8>((color >> 24u) & 0xffu),
	};
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	u32* framebuffer = backend.framebuffer();
	const i32 dstW = endX - startX;
	const i32 dstH = endY - startY;
	for (i32 y = startY; y < endY; ++y) {
		const i32 srcY = sourceY + ((y - startY) * sourceH) / dstH;
		const u8* sourceRow = texture.pixels + static_cast<size_t>(srcY) * texture.stride;
		u32* targetRow = framebuffer + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = startX; x < endX; ++x) {
			const i32 srcX = sourceX + ((x - startX) * sourceW) / dstW;
			const u8* sourcePixel = sourceRow + static_cast<size_t>(srcX) * 4u;
			blendTintedSoftwarePixel(targetRow[x], sourcePixel, tint);
		}
	}
}

} // namespace

void registerSoftwareScenePasses(RenderPassLibrary& registry) {
	{
		RenderPassDef desc;
		desc.id = "skybox";
		desc.name = "Skybox";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
		desc.shouldExecute = []() {
			return ConsoleCore::instance().view()->skyboxRenderReady;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any&) {
			auto& console = ConsoleCore::instance();
			renderSoftwareSkybox(static_cast<SoftwareBackend&>(*backend), *console.view(), console.runtime());
		};
		registry.registerPass(desc);
	}

	{
		RenderPassDef desc;
		desc.id = "particles";
		desc.name = "Particles";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
		desc.shouldExecute = []() {
			const GameView* view = ConsoleCore::instance().view();
			return RenderQueues::beginParticleQueue() > 0 || view->vdpBillboardCount > 0u;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any&) {
			auto& console = ConsoleCore::instance();
			renderSoftwareParticles(static_cast<SoftwareBackend&>(*backend), *console.view(), console.runtime());
		};
		registry.registerPass(desc);
	}
}

void renderSoftwareSkybox(SoftwareBackend& backend, const GameView& view, Runtime& runtime) {
	if (!view.skyboxRenderReady) {
		return;
	}
	writeSkyboxToFramebuffer(backend, runtime, view.vdpTransform.skyboxView);
}

void renderSoftwareParticles(SoftwareBackend& backend, const GameView& view, Runtime& runtime) {
	const SoftwareParticleViewState state = resolveParticleViewState(view);
	if (RenderQueues::beginParticleQueue() == 0 && view.vdpBillboardCount == 0u) {
		return;
	}
	VDP::VdpHostOutput output = runtime.machine.vdp.readHostOutput();
	const i32 particleCount = RenderQueues::beginParticleQueue();
	for (i32 particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
		const ParticleRenderSubmission& submission = RenderQueues::particleQueueEntry(static_cast<size_t>(particleIndex));
		drawSoftwareBillboardSample(backend,
			output,
			state,
			submission.slot,
			submission.u,
			submission.v,
			submission.w,
			submission.h,
			submission.position,
			submission.size,
			submission.color);
	}
	for (size_t index = 0; index < view.vdpBillboardCount; ++index) {
		const GameView::VdpBillboardRenderEntry& submission = view.vdpBillboards[index];
		drawSoftwareBillboardSample(backend,
			output,
			state,
			submission.slot,
			submission.u,
			submission.v,
			submission.w,
			submission.h,
			submission.position,
			submission.size,
			submission.color);
	}
}

} // namespace bmsx
