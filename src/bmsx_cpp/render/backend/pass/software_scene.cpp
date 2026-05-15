#include "render/backend/pass/software_scene.h"

#include "render/backend/pass/library.h"
#include "machine/runtime/runtime.h"

#include "core/console.h"
#include "render/gameview.h"
#include "render/3d/mesh/rom_source.h"
#include "render/3d/mesh/vertex_stream.h"
#include "render/shared/software_pixels.h"
#include "render/vdp/slot_textures.h"
#include <array>
#include <cstddef>

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

struct SoftwareSkyboxSourceRect {
	u32 x = 0u;
	u32 y = 0u;
	u32 width = 0u;
	u32 height = 0u;
};

MeshVertexStreamBuilder g_softwareMeshVertexStream{};

SoftwareParticleViewState resolveParticleViewState(const GameView& view) {
	SoftwareParticleViewState state;
	state.width = static_cast<i32>(view.offscreenCanvasSize.x);
	state.height = static_cast<i32>(view.offscreenCanvasSize.y);
	const VdpTransformSnapshot& transform = view.vdpTransform;
	state.viewProj = transform.viewProj;
	state.camRight = { transform.view[0], transform.view[4], transform.view[8] };
	return state;
}


void drawSoftwareMeshPoint(SoftwareBackend& backend, i32 screenX, i32 screenY, u8 colorR, u8 colorG, u8 colorB, u8 colorA) {
	const i32 width = backend.width();
	const i32 height = backend.height();
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	const i32 startX = screenX - 1 < 0 ? 0 : screenX - 1;
	const i32 startY = screenY - 1 < 0 ? 0 : screenY - 1;
	const i32 endX = screenX + 2 > width ? width : screenX + 2;
	const i32 endY = screenY + 2 > height ? height : screenY + 2;
	u32* framebuffer = backend.framebuffer();
	for (i32 y = startY; y < endY; ++y) {
		u32* row = framebuffer + static_cast<size_t>(y) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = startX; x < endX; ++x) {
			blendSoftwareArgb(row[x], colorR, colorG, colorB, colorA);
		}
	}
}

u8 softwareMeshShadeChannel(u8 channel, f32 shade) {
	const i32 value = static_cast<i32>(static_cast<f32>(channel) * shade);
	if (value < 0) {
		return 0u;
	}
	if (value > 255) {
		return 255u;
	}
	return static_cast<u8>(value);
}

void drawSoftwareMeshEntry(SoftwareBackend& backend, const GameView& view, const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry) {
	const MeshRomDrawSource source = resolveMeshRomDrawSource(rom, entry);
	const MeshGLES2DrawStream stream = g_softwareMeshVertexStream.build(view, source.model, source.mesh, entry);
	const Render3D::Mat4& model = *stream.modelMatrix;
	const std::array<f32, 16>& viewProj = view.vdpTransform.viewProj;
	const u8 baseR = static_cast<u8>((entry.color >> 16u) & 0xffu);
	const u8 baseG = static_cast<u8>((entry.color >> 8u) & 0xffu);
	const u8 baseB = static_cast<u8>(entry.color & 0xffu);
	f32 lightEnergy = view.vdpAmbientLightColorIntensity[3];
	for (i32 index = 0; index < view.vdpDirectionalLightCount; ++index) {
		lightEnergy += view.vdpDirectionalLightIntensities[static_cast<size_t>(index)];
	}
	for (i32 index = 0; index < view.vdpPointLightCount; ++index) {
		lightEnergy += view.vdpPointLightParams[static_cast<size_t>(index) * 2u + 1u];
	}
	if (lightEnergy < 0.25f) {
		lightEnergy = 0.25f;
	}
	if (lightEnergy > 1.85f) {
		lightEnergy = 1.85f;
	}
	for (size_t index = 0u; index < stream.vertexCount; ++index) {
		const MeshGLES2Vertex& vertex = stream.vertices[index];
		const f32 wx = model[0] * vertex.x + model[4] * vertex.y + model[8] * vertex.z + model[12];
		const f32 wy = model[1] * vertex.x + model[5] * vertex.y + model[9] * vertex.z + model[13];
		const f32 wz = model[2] * vertex.x + model[6] * vertex.y + model[10] * vertex.z + model[14];
		const f32 clipX = viewProj[0] * wx + viewProj[4] * wy + viewProj[8] * wz + viewProj[12];
		const f32 clipY = viewProj[1] * wx + viewProj[5] * wy + viewProj[9] * wz + viewProj[13];
		const f32 clipW = viewProj[3] * wx + viewProj[7] * wy + viewProj[11] * wz + viewProj[15];
		if (clipW <= 0.0f) {
			continue;
		}
		const f32 ndcX = clipX / clipW;
		const f32 ndcY = clipY / clipW;
		if (ndcX < -1.1f || ndcX > 1.1f || ndcY < -1.1f || ndcY > 1.1f) {
			continue;
		}
		f32 directional = view.vdpAmbientLightColorIntensity[3];
		if (view.vdpDirectionalLightCount > 0) {
			const f32 dot = -(vertex.nx * view.vdpDirectionalLightDirections[0]
				+ vertex.ny * view.vdpDirectionalLightDirections[1]
				+ vertex.nz * view.vdpDirectionalLightDirections[2]);
			if (dot > 0.0f) {
				directional += dot * view.vdpDirectionalLightIntensities[0];
			}
		}
		f32 shade = directional * 0.7f + lightEnergy * 0.25f;
		if (shade < 0.18f) {
			shade = 0.18f;
		}
		if (shade > 1.4f) {
			shade = 1.4f;
		}
		const i32 screenX = static_cast<i32>((ndcX * 0.5f + 0.5f) * static_cast<f32>(backend.width()));
		const i32 screenY = static_cast<i32>((0.5f - ndcY * 0.5f) * static_cast<f32>(backend.height()));
		drawSoftwareMeshPoint(backend,
			screenX,
			screenY,
			softwareMeshShadeChannel(baseR, shade),
			softwareMeshShadeChannel(baseG, shade),
			softwareMeshShadeChannel(baseB, shade),
			224u);
	}
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

void writeSkyboxToFramebuffer(SoftwareBackend& backend, const GameView& view, const std::array<f32, 16>& skyboxView) {
	std::array<SoftwareSkyboxSourceRect, SKYBOX_FACE_COUNT> sources{};
	std::array<VdpSlotTexturePixels, SKYBOX_FACE_COUNT> textures{};
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		const VdpSlotTexturePixels texture = view.vdpSlotTextures().readSurfaceTexturePixels(view.skyboxFaceSurfaceIds[index]);
		const size_t uvBase = index * 4u;
		const size_t sizeBase = index * 2u;
		textures[index] = texture;
		sources[index] = SoftwareSkyboxSourceRect{
			static_cast<u32>(view.skyboxFaceUvRects[uvBase + 0u] * static_cast<f32>(texture.width)),
			static_cast<u32>(view.skyboxFaceUvRects[uvBase + 1u] * static_cast<f32>(texture.height)),
			static_cast<u32>(view.skyboxFaceSizes[sizeBase + 0u]),
			static_cast<u32>(view.skyboxFaceSizes[sizeBase + 1u]),
		};
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
			const SoftwareSkyboxSourceRect& source = sources[faceIndex];
			const VdpSlotTexturePixels& texture = textures[faceIndex];
			u32 faceX = static_cast<u32>(faceUv.u * static_cast<f32>(source.width));
			u32 faceY = static_cast<u32>(faceUv.v * static_cast<f32>(source.height));
			if (faceX >= source.width) {
				faceX = source.width - 1u;
			}
			if (faceY >= source.height) {
				faceY = source.height - 1u;
			}
			const u32 srcX = source.x + faceX;
			const u32 srcY = source.y + faceY;
			const u8* sourceRow = texture.pixels + static_cast<size_t>(srcY) * texture.stride;
			const u8* pixel = sourceRow + static_cast<size_t>(srcX) * 4u;
			targetRow[x] = packSoftwareArgb(pixel[0], pixel[1], pixel[2], pixel[3]);
		}
	}
}

void drawSoftwareBillboardSample(SoftwareBackend& backend,
	const SoftwareParticleViewState& state,
	const VdpSlotTextures& slotTextures,
	u32 surfaceId,
	u32 u,
	u32 v,
	u32 w,
	u32 h,
	const Vec3& position,
	f32 size,
	u32 color) {
	const VdpSlotTexturePixels texture = slotTextures.readSurfaceTexturePixels(surfaceId);
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
	const auto softwareSceneOutputSlot = RenderPassDef::RenderGraphSlot::FrameColor;
	{
		RenderPassDef desc;
		desc.id = "skybox";
		desc.name = "Skybox";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { softwareSceneOutputSlot };
		desc.shouldExecute = []() {
			return ConsoleCore::instance().view()->skyboxRenderReady;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any&) {
			auto& console = ConsoleCore::instance();
			renderSoftwareSkybox(static_cast<SoftwareBackend&>(*backend), *console.view());
		};
		registry.registerPass(desc);
	}

	{
		RenderPassDef desc;
		desc.id = "mesh";
		desc.name = "Mesh";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { softwareSceneOutputSlot };
		desc.shouldExecute = []() {
			const GameView* view = ConsoleCore::instance().view();
			return view->vdpMeshCount > 0u;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any&) {
			auto& console = ConsoleCore::instance();
			renderSoftwareMeshes(static_cast<SoftwareBackend&>(*backend), *console.view());
		};
		registry.registerPass(desc);
	}

	{
		RenderPassDef desc;
		desc.id = "particles";
		desc.name = "Particles";
		desc.graph = RenderPassDef::RenderPassGraphDef{};
		desc.graph->writes = { softwareSceneOutputSlot };
		desc.shouldExecute = []() {
			const GameView* view = ConsoleCore::instance().view();
			return view->vdpBillboardCount > 0u;
		};
		desc.exec = [](GPUBackend* backend, void*, std::any&) {
			auto& console = ConsoleCore::instance();
			renderSoftwareParticles(static_cast<SoftwareBackend&>(*backend), *console.view());
		};
		registry.registerPass(desc);
	}
}

void renderSoftwareSkybox(SoftwareBackend& backend, const GameView& view) {
	if (!view.skyboxRenderReady) {
		return;
	}
	writeSkyboxToFramebuffer(backend, view, view.vdpTransform.skyboxView);
}


void renderSoftwareMeshes(SoftwareBackend& backend, const GameView& view) {
	if (view.vdpMeshCount == 0u) {
		return;
	}
	const RuntimeRomPackage& rom = ConsoleCore::instance().runtime().activeRom();
	for (size_t index = 0u; index < view.vdpMeshCount; ++index) {
		drawSoftwareMeshEntry(backend, view, rom, view.vdpMeshes[index]);
	}
}

void renderSoftwareParticles(SoftwareBackend& backend, const GameView& view) {
	const SoftwareParticleViewState state = resolveParticleViewState(view);
	if (view.vdpBillboardCount == 0u) {
		return;
	}
	for (size_t index = 0; index < view.vdpBillboardCount; ++index) {
		const GameView::VdpBillboardRenderEntry& submission = view.vdpBillboards[index];
		drawSoftwareBillboardSample(backend,
			state,
			view.vdpSlotTextures(),
			submission.surfaceId,
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
