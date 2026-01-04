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
  const f32 offscreenWidth = context->offscreenCanvasSize.x;
  const bool ideIsViewport =
	  (context->viewportTypeIde == GameView::ViewportType::Viewport);
  const f32 ideScale = ideIsViewport ? 1.0f : (baseWidth / offscreenWidth);

  const f32 time = static_cast<f32>(EngineCore::instance().totalTime());
  const f32 phase = time * 60.0f;
  const f32 frac = phase - std::floor(phase);
  DitherParams dither;
  dither.enabled = context->psx_dither_2d_enabled;
  dither.intensity = context->psx_dither2d_intensity;
  dither.jitter = static_cast<i32>(frac * 4.0f);

  const bool useDepth = false;

  auto& engine = EngineCore::instance();
  const auto& assets = engine.assets();

  // Iterate over all sprites in the sorted front queue
  RenderQueues::forEachSprite([&](const SpriteQueueItem& item, size_t) {
	const auto& options = item.options;
	const ImgMeta* imgmeta = item.imgmeta;

	const auto* imgAsset = assets.getImg(options.imgid);
	const auto& meta = *imgmeta;
	const Vec2& scale = options.scale.value();
	const FlipOptions& flip = options.flip.value();
	const Color& colorize = options.colorize.value();
	const RenderLayer layer = options.layer.value_or(RenderLayer::World);
	const f32 desiredScale = (layer == RenderLayer::IDE) ? ideScale : 1.0f;

	TextureHandle tex = nullptr;
	if (meta.atlassed) {
	  const std::string atlasName = generateAtlasName(meta.atlasid);
	  const auto* atlasAsset = assets.getImg(atlasName);
	  tex = reinterpret_cast<TextureHandle>(atlasAsset->textureHandle);
	} else {
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

	// Destination position and size
	const f32 scaledX0 = options.pos.x * desiredScale;
	const f32 scaledY0 = options.pos.y * desiredScale;
	const f32 scaledX1 =
		scaledX0 + static_cast<f32>(meta.width) * scale.x * desiredScale;
	const f32 scaledY1 =
		scaledY0 + static_cast<f32>(meta.height) * scale.y * desiredScale;
	i32 dstX = static_cast<i32>(scaledX0);
	i32 dstY = static_cast<i32>(scaledY0);
	i32 dstW = static_cast<i32>(scaledX1) - dstX;
	i32 dstH = static_cast<i32>(scaledY1) - dstY;

	const f32 zValue = (options.pos.z == 0.0f) ? DEFAULT_ZCOORD : options.pos.z;
	const f32 zNorm = 1.0f - (zValue / ZCOORD_MAX);
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
	  throw std::runtime_error("[SpritesPipeline] OpenGLES2 backend disabled at compile time.");
#else
	  auto& engine = EngineCore::instance();
	  auto* view = engine.view();
	  const auto& assets = engine.assets();

	  SpritesPipelineState spriteState;
	  spriteState.width = static_cast<i32>(view->offscreenCanvasSize.x);
	  spriteState.height = static_cast<i32>(view->offscreenCanvasSize.y);
	  spriteState.baseWidth = static_cast<i32>(view->viewportSize.x);
	  spriteState.baseHeight = static_cast<i32>(view->viewportSize.y);

	  const auto& primaryAtlas = assets.img.at(generateAtlasName(0));
	  spriteState.atlasPrimaryTex =
		  reinterpret_cast<TextureHandle>(primaryAtlas.textureHandle);
	  const auto secondaryName = generateAtlasName(1);
	  auto atlasSecondary = assets.img.find(secondaryName);
	  if (atlasSecondary != assets.img.end()) {
		spriteState.atlasSecondaryTex = reinterpret_cast<TextureHandle>(
			atlasSecondary->second.textureHandle);
	  }
	  const auto engineName = generateAtlasName(254);
	  auto atlasEngine = assets.img.find(engineName);
	  if (atlasEngine != assets.img.end()) {
		spriteState.atlasEngineTex = reinterpret_cast<TextureHandle>(
			atlasEngine->second.textureHandle);
	  }

	  spriteState.ambientEnabledDefault = view->spriteAmbientEnabledDefault;
	  spriteState.ambientFactorDefault = view->spriteAmbientFactorDefault;
	  spriteState.psxDither2dEnabled = view->psx_dither_2d_enabled;
	  spriteState.psxDither2dIntensity = view->psx_dither2d_intensity;
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
