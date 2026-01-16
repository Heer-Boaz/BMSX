/*
 * sprites_pipeline.cpp - 2D Sprite rendering pipeline implementation
 *
 * Mirrors TypeScript sprites_pipeline.ts
 */

#include "sprites_pipeline.h"

#include <cmath>
#include <stdexcept>

#include "../core/assets.h"
#include "../core/engine.h"
#include "../core/rompack.h"
#include "gameview.h"
#include "../utils/clamp.h"
#if BMSX_ENABLE_GLES2
#include "sprites_pipeline_gles2.h"
#endif

namespace bmsx {
namespace SpritesPipeline {

// Default Z coordinate (mirrors TypeScript DEFAULT_ZCOORD)
static constexpr f32 DEFAULT_ZCOORD = 0.0f;
static constexpr f32 ZCOORD_MAX = 10000.0f;

namespace {
void renderSpriteBatchSoftware(SoftwareBackend* softBackend,
								GameView* context) {
	// Swap and sort the sprite queue (returns count)
	i32 spriteCount = RenderQueues::beginSpriteQueue();
	if (spriteCount == 0) return;

	const f32 baseWidth = context->viewportSize.x;
	const f32 baseHeight = context->viewportSize.y;
	const f32 offscreenWidth = context->offscreenCanvasSize.x;
	const f32 offscreenHeight = context->offscreenCanvasSize.y;
	const bool ideIsViewport =
		(context->viewportTypeIde == GameView::ViewportType::Viewport);
	const f32 ideScale = ideIsViewport ? 1.0f : (baseWidth / offscreenWidth);
	const f32 renderScaleX = offscreenWidth / baseWidth;
	const f32 renderScaleY = offscreenHeight / baseHeight;

	const f32 time = static_cast<f32>(EngineCore::instance().totalTime());
	const f32 wobble = (std::sin(time * 2.2f) * 0.5f)
						+ (std::sin(time * 1.1f + 1.7f) * 0.5f);
	DitherParams dither{};
	dither.enabled = false;

	const bool useDepth = false;

	auto& engine = EngineCore::instance();
	const auto& assets = engine.assets();
	const TextureHandle atlasPrimary = context->textures.at("_atlas_primary");
	const TextureHandle atlasSecondary = context->textures.at("_atlas_secondary");

	auto smoothstep01 = [](f32 t) {
	t = clamp(t, 0.0f, 1.0f);
	return t * t * (3.0f - 2.0f * t);
	};
	// Iterate over all sprites in the sorted front queue
	RenderQueues::forEachSprite([&](const SpriteQueueItem& item, size_t) {
	const auto& options = item.options;
	const ImgMeta* imgmeta = item.imgmeta;
	const auto& meta = *imgmeta;
	const Vec2& scale = options.scale.value();
	const FlipOptions& flip = options.flip.value();
	const Color& colorize = options.colorize.value();
	const RenderLayer layer = options.layer.value_or(RenderLayer::World);
	const f32 desiredScale = (layer == RenderLayer::IDE) ? ideScale : 1.0f;
	const f32 totalScaleX = renderScaleX * desiredScale;
	const f32 totalScaleY = renderScaleY * desiredScale;
	const SpriteParallaxRig& parallaxRig = RenderQueues::spriteParallaxRig;
	f32 parallaxWeight = clamp(options.parallax_weight.value_or(0.0f), -1.0f, 1.0f);
	if (layer != RenderLayer::World) {
		parallaxWeight = 0.0f;
	}

	TextureHandle tex = nullptr;
	if (meta.atlassed) {
		if (meta.atlasid == ENGINE_ATLAS_INDEX) {
		tex = context->textures.at(ENGINE_ATLAS_TEXTURE_KEY);
		} else if (meta.atlasid == context->primaryAtlasIdInSlot) {
		tex = atlasPrimary;
		} else if (meta.atlasid == context->secondaryAtlasIdInSlot) {
		tex = atlasSecondary;
		} else {
		throw BMSX_RUNTIME_ERROR("[SpritesPipeline] Atlas not loaded into a slot.");
		}
	} else {
		const auto* imgAsset = assets.getImg(options.imgid);
		tex = reinterpret_cast<TextureHandle>(imgAsset->textureHandle);
	}

	// Get UV coordinates based on flip options
	f32 u0, v0, u1, v1;
	meta.getUVRect(u0, v0, u1, v1, flip.flip_h, flip.flip_v);

	auto* softTex = static_cast<SoftwareTexture*>(tex);

	// Calculate source rectangle from UVs
	const f32 srcXf = u0 * static_cast<f32>(softTex->width);
	const f32 srcYf = v0 * static_cast<f32>(softTex->height);
	const f32 srcXf1 = u1 * static_cast<f32>(softTex->width);
	const f32 srcYf1 = v1 * static_cast<f32>(softTex->height);
	i32 srcX = static_cast<i32>(srcXf);
	i32 srcY = static_cast<i32>(srcYf);
	i32 srcW = static_cast<i32>(srcXf1) - srcX;
	i32 srcH = static_cast<i32>(srcYf1) - srcY;

	const f32 zValue = (options.pos.z == 0.0f) ? DEFAULT_ZCOORD : options.pos.z;
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

	// Destination position and size
	const f32 baseW = static_cast<f32>(meta.width) * scale.x;
	const f32 baseH = static_cast<f32>(meta.height) * scale.y;
	const f32 centerX = options.pos.x + (baseW * 0.5f);
	const f32 centerY = options.pos.y + (baseH * 0.5f);
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
								dstH, zNorm, colorize, flip.flip_h, flip.flip_v,
								dither, useDepth);
	});
}
}  // namespace

/**
 * Render the sprite batch.
 * Mirrors TypeScript renderSpriteBatch().
 */
void renderSpriteBatch(GPUBackend* backend, GameView* context) {
	switch (backend->type()) {
	case BackendType::Software:
		renderSpriteBatchSoftware(static_cast<SoftwareBackend*>(backend),
								context);
		return;
	case BackendType::OpenGLES2: {
#if !BMSX_ENABLE_GLES2
		throw BMSX_RUNTIME_ERROR("[SpritesPipeline] OpenGLES2 backend disabled at compile time.");
#else
		auto& engine = EngineCore::instance();
		auto* view = engine.view();

		SpritesPipelineState spriteState;
		spriteState.width = static_cast<i32>(view->offscreenCanvasSize.x);
		spriteState.height = static_cast<i32>(view->offscreenCanvasSize.y);
		spriteState.baseWidth = static_cast<i32>(view->viewportSize.x);
		spriteState.baseHeight = static_cast<i32>(view->viewportSize.y);

		auto primaryIt = view->textures.find("_atlas_primary");
		if (primaryIt == view->textures.end() || !primaryIt->second) {
		throw BMSX_RUNTIME_ERROR("[SpritesPipeline] Texture '_atlas_primary' missing from view textures.");
		}
		spriteState.atlasPrimaryTex = primaryIt->second;
		auto secondaryIt = view->textures.find("_atlas_secondary");
		if (secondaryIt != view->textures.end()) {
		spriteState.atlasSecondaryTex = secondaryIt->second;
		}
		auto engineIt = view->textures.find(ENGINE_ATLAS_TEXTURE_KEY);
		if (engineIt != view->textures.end()) {
		spriteState.atlasEngineTex = engineIt->second;
		}

		spriteState.ambientEnabledDefault = view->spriteAmbientEnabledDefault;
		spriteState.ambientFactorDefault = view->spriteAmbientFactorDefault;
		spriteState.viewportTypeIde =
			(view->viewportTypeIde == GameView::ViewportType::Viewport)
				? "viewport"
				: "offscreen";

		renderSpriteBatchGLES2(static_cast<OpenGLES2Backend*>(backend), view,
								spriteState);
		return;
#endif
	}
	default:
		return;
	}
}

}  // namespace SpritesPipeline
}  // namespace bmsx
