/*
 * sprites_pipeline.cpp - 2D Sprite rendering pipeline implementation
 *
 * Mirrors TypeScript sprites_pipeline.ts
 */

#include "sprites_pipeline.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <stdexcept>

#include "../../rompack/runtime_assets.h"
#include "../../core/engine_core.h"
#include "../../rompack/rompack.h"
#include "../../emulator/runtime.h"
#include "../gameview.h"
#include "../backend/renderpasslib.h"
#include "../../utils/clamp.h"
#if BMSX_ENABLE_GLES2
#include "sprites_pipeline_gles2.h"
#endif

namespace bmsx {
namespace SpritesPipeline {

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 0.0f;
static constexpr f32 ZCOORD_MAX = 10000.0f;

namespace {
static int g_spriteTraceLogCount = 0;
static int g_sort2DTraceLogCount = 0;
static int g_spritePassTraceLogCount = 0;
static constexpr int kSort2DTraceLogLimit = 32;
static constexpr int kSpritePassTraceLogLimit = 32;

bool compareSorted2DDrawEntries(const Sorted2DDrawEntry& a, const Sorted2DDrawEntry& b) {
	if (a.entry.z != b.entry.z) {
		return a.entry.z < b.entry.z;
	}
	return a.sourceIndex < b.sourceIndex;
}

std::vector<Sorted2DDrawEntry>& resolveSorted2DBucket(Sort2DPipelineState& sortState, OamLayer layer) {
	switch (layer) {
	case OamLayer::UI:
		return sortState.ui.entries;
	case OamLayer::IDE:
		return sortState.ide.entries;
	default:
		return sortState.world.entries;
	}
}

const std::vector<Sorted2DDrawEntry>& resolveSorted2DBucket(const Sort2DPipelineState& sortState, OamLayer layer) {
	switch (layer) {
	case OamLayer::UI:
		return sortState.ui.entries;
	case OamLayer::IDE:
		return sortState.ide.entries;
	default:
		return sortState.world.entries;
	}
}

void renderSpriteBatchSoftware(SoftwareBackend* softBackend,
								GameView* context,
								const SpritesPipelineState& state,
								const std::vector<Sorted2DDrawEntry>& sortedEntries,
								bool useDepth) {
	const i32 spriteCount = static_cast<i32>(sortedEntries.size());
	if (spriteCount == 0) return;

	const f32 baseWidth = static_cast<f32>(state.baseWidth);
	const f32 baseHeight = static_cast<f32>(state.baseHeight);
	const f32 offscreenWidth = static_cast<f32>(state.width);
	const f32 offscreenHeight = static_cast<f32>(state.height);
	const bool ideIsViewport =
		(state.viewportTypeIde == "viewport");
	const f32 ideScale = ideIsViewport ? 1.0f : (baseWidth / offscreenWidth);
	const f32 renderScaleX = offscreenWidth / baseWidth;
	const f32 renderScaleY = offscreenHeight / baseHeight;

	const f32 time = static_cast<f32>(EngineCore::instance().totalTime());
	const f32 wobble = (std::sin(time * 2.2f) * 0.5f)
						+ (std::sin(time * 1.1f + 1.7f) * 0.5f);
	DitherParams dither{};
	dither.enabled = false;

	const TextureHandle atlasPrimary = context->textures.at("_atlas_primary");
	const TextureHandle atlasSecondary = context->textures.at("_atlas_secondary");
	const auto& atlasSlots = Runtime::instance().vdp().atlasSlots();
	const i32 primaryAtlasIdInSlot = atlasSlots[0];
	const i32 secondaryAtlasIdInSlot = atlasSlots[1];
	if (g_spriteTraceLogCount < 16) {
		auto engineIt = context->textures.find(ENGINE_ATLAS_TEXTURE_KEY);
		const bool hasEngineTex = engineIt != context->textures.end() && engineIt->second != nullptr;
		std::fprintf(stderr,
			"[Sprites2D][C++][soft] count=%d engineTex=%d primaryTex=%d secondaryTex=%d primaryAtlas=%d secondaryAtlas=%d\n",
			spriteCount,
			hasEngineTex ? 1 : 0,
			atlasPrimary != nullptr ? 1 : 0,
			atlasSecondary != nullptr ? 1 : 0,
			primaryAtlasIdInSlot,
			secondaryAtlasIdInSlot);
		++g_spriteTraceLogCount;
	}
	auto smoothstep01 = [](f32 t) {
	t = clamp(t, 0.0f, 1.0f);
	return t * t * (3.0f - 2.0f * t);
	};
	for (const Sorted2DDrawEntry& draw : sortedEntries) {
		const OamEntry& item = draw.entry;
		const OamLayer layer = item.layer;
		const f32 desiredScale = (layer == OamLayer::IDE) ? ideScale : 1.0f;
		const f32 totalScaleX = renderScaleX * desiredScale;
		const f32 totalScaleY = renderScaleY * desiredScale;
		const SpriteParallaxRig& parallaxRig = RenderQueues::spriteParallaxRig;
		f32 parallaxWeight = clamp(item.parallaxWeight, -1.0f, 1.0f);
		if (layer != OamLayer::World) {
			parallaxWeight = 0.0f;
		}

		TextureHandle tex = nullptr;
		if (item.atlasId == ENGINE_ATLAS_INDEX) {
			tex = context->textures.at(ENGINE_ATLAS_TEXTURE_KEY);
		} else if (item.atlasId == primaryAtlasIdInSlot) {
			tex = atlasPrimary;
		} else if (item.atlasId == secondaryAtlasIdInSlot) {
			tex = atlasSecondary;
		} else {
			throw BMSX_RUNTIME_ERROR("[SpritesPipeline] Atlas " + std::to_string(item.atlasId) + " not mapped to primary/secondary slots.");
		}

		const bool flipH = item.u0 > item.u1;
		const bool flipV = item.v0 > item.v1;
		const f32 u0 = flipH ? item.u1 : item.u0;
		const f32 v0 = flipV ? item.v1 : item.v0;
		const f32 u1 = flipH ? item.u0 : item.u1;
		const f32 v1 = flipV ? item.v0 : item.v1;

		auto* softTex = static_cast<SoftwareTexture*>(tex);

		const f32 srcXf = u0 * static_cast<f32>(softTex->width);
		const f32 srcYf = v0 * static_cast<f32>(softTex->height);
		const f32 srcXf1 = u1 * static_cast<f32>(softTex->width);
		const f32 srcYf1 = v1 * static_cast<f32>(softTex->height);
		i32 srcX = static_cast<i32>(srcXf);
		i32 srcY = static_cast<i32>(srcYf);
		i32 srcW = static_cast<i32>(srcXf1) - srcX;
		i32 srcH = static_cast<i32>(srcYf1) - srcY;

		const f32 zValue = (item.z == 0.0f) ? DEFAULT_ZCOORD : item.z;
		const f32 zNorm = 1.0f - (zValue / ZCOORD_MAX);
		const f32 depth = smoothstep01(zNorm);
		const f32 dir = (parallaxWeight > 0.0f) ? 1.0f : ((parallaxWeight < 0.0f) ? -1.0f : 0.0f);
		const f32 weight = std::abs(parallaxWeight) * depth;
		f32 dy = (parallaxRig.bias_px + wobble * parallaxRig.vy) * weight * parallaxRig.parallax_strength * dir;
		const f32 flipWindowSeconds = std::max(parallaxRig.flip_window, 0.0001f);
		const f32 hold = 0.2f * flipWindowSeconds;
		const f32 flipU = clamp((parallaxRig.impact_t - hold) / std::max(flipWindowSeconds - hold, 0.0001f), 0.0f, 1.0f);
		const f32 flipWindow = 1.0f - smoothstep01(flipU);
		const f32 axisFlip = 1.0f - 2.0f * flipWindow * parallaxRig.flip_strength;
		dy *= axisFlip;
		const f32 baseScale = 1.0f + ((parallaxRig.scale - 1.0f) * weight * parallaxRig.scale_strength);
		const f32 impactSign = (parallaxRig.impact > 0.0f)
			? 1.0f
			: ((parallaxRig.impact < 0.0f) ? -1.0f : 0.0f);
		const f32 impactMask = (dir * impactSign > 0.0f) ? 1.0f : 0.0f;
		const f32 pulse = std::exp(-8.0f * parallaxRig.impact_t)
			* std::abs(parallaxRig.impact) * weight * impactMask;
		const f32 parallaxScaleMul = baseScale + pulse;

		const Color colorize{item.r, item.g, item.b, item.a};
		const f32 baseW = item.w;
		const f32 baseH = item.h;
		const f32 centerX = item.x + (baseW * 0.5f);
		const f32 centerY = item.y + (baseH * 0.5f);
		const f32 finalW = baseW * parallaxScaleMul;
		const f32 finalH = baseH * parallaxScaleMul;
		const f32 finalX = centerX - (finalW * 0.5f);
		const f32 finalY = centerY - (finalH * 0.5f) + dy;
		const f32 scaledX0 = finalX * totalScaleX;
		const f32 scaledY0 = finalY * totalScaleY;
		const f32 scaledX1 = scaledX0 + finalW * totalScaleX;
		const f32 scaledY1 = scaledY0 + finalH * totalScaleY;
		i32 dstX = static_cast<i32>(scaledX0);
		i32 dstY = static_cast<i32>(scaledY0);
		i32 dstW = static_cast<i32>(scaledX1) - dstX;
		i32 dstH = static_cast<i32>(scaledY1) - dstY;

		softBackend->blitTexture(tex, srcX, srcY, srcW, srcH, dstX, dstY, dstW,
			dstH, zNorm, colorize, flipH, flipV,
			dither, useDepth);
	}
}
}  // namespace

Sort2DPipelineState buildSorted2DPipelineState() {
	const i32 drawCount = Runtime::instance().vdp().begin2dRead();
	Sort2DPipelineState sortState;
	size_t writeIndex = 0;
	Runtime::instance().vdp().forEach2dEntry([&](const OamEntry& entry, size_t sourceIndex) {
		auto& bucket = resolveSorted2DBucket(sortState, entry.layer);
		bucket.emplace_back();
		Sorted2DDrawEntry& draw = bucket.back();
		draw.entry = entry;
		draw.sourceIndex = static_cast<i32>(sourceIndex);
		writeIndex += 1;
	});
	if (writeIndex != static_cast<size_t>(drawCount)) {
		throw BMSX_RUNTIME_ERROR("[Sort2D] begin2dRead count mismatch.");
	}
	if (sortState.world.entries.size() > 1) {
		std::sort(sortState.world.entries.begin(), sortState.world.entries.end(), compareSorted2DDrawEntries);
	}
	if (sortState.ui.entries.size() > 1) {
		std::sort(sortState.ui.entries.begin(), sortState.ui.entries.end(), compareSorted2DDrawEntries);
	}
	if (sortState.ide.entries.size() > 1) {
		std::sort(sortState.ide.entries.begin(), sortState.ide.entries.end(), compareSorted2DDrawEntries);
	}
	if (g_sort2DTraceLogCount < kSort2DTraceLogLimit) {
		std::fprintf(stderr,
			"[Sort2DTrace][C++] world=%zu ui=%zu ide=%zu total=%d\n",
			sortState.world.entries.size(),
			sortState.ui.entries.size(),
			sortState.ide.entries.size(),
			drawCount);
		++g_sort2DTraceLogCount;
	}
	return sortState;
}

/**
 * Render the sprite batch.
 * Mirrors TypeScript renderSpriteBatch().
 */
void renderSpriteBatch(GPUBackend* backend, GameView* context, const SpritesPipelineState& spriteState, const Sort2DPipelineState& sortState, OamLayer layer, bool useDepth) {
	const auto& sortedEntries = resolveSorted2DBucket(sortState, layer);
	if (g_spritePassTraceLogCount < kSpritePassTraceLogLimit) {
		std::fprintf(stderr,
			"[SpritesPassTrace][C++] layer=%d count=%zu depth=%d\n",
			static_cast<int>(layer),
			sortedEntries.size(),
			useDepth ? 1 : 0);
		++g_spritePassTraceLogCount;
	}
	switch (backend->type()) {
	case BackendType::Software:
		renderSpriteBatchSoftware(static_cast<SoftwareBackend*>(backend),
								context,
								spriteState,
								sortedEntries,
								useDepth);
		return;
	case BackendType::OpenGLES2: {
#if !BMSX_ENABLE_GLES2
		throw BMSX_RUNTIME_ERROR("[SpritesPipeline] OpenGLES2 backend disabled at compile time.");
#else
		renderSpriteBatchGLES2(static_cast<OpenGLES2Backend*>(backend), context,
								spriteState,
								sortedEntries,
								useDepth);
		return;
#endif
	}
	default:
		return;
	}
}

}  // namespace SpritesPipeline
}  // namespace bmsx
