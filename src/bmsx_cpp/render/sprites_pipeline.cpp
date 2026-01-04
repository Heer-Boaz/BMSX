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

/**
 * Submit an image/sprite for rendering.
 * Mirrors TypeScript SpritesPipeline.drawImg().
 */
void drawImg(const ImgRenderSubmission& options) {
  if (options.imgid == "none") return;

  auto& engine = EngineCore::instance();
  const auto* imgAsset = engine.assets().getImg(options.imgid);
  if (!imgAsset) {
	throw std::runtime_error("[Sprite Pipeline] drawImg called with unknown image id '" + options.imgid + "'.");
  }

  const ImgMeta* imgmeta = &imgAsset->meta;
  if (!imgmeta) {
	throw std::runtime_error("[Sprite Pipeline] Image metadata missing for imgid '" + options.imgid + "'.");
  }
  RenderQueues::submitSprite(options, imgmeta);
}

/**
 * Correct area start/end to ensure positive dimensions.
 * Mirrors TypeScript correctAreaStartEnd().
 */
static void correctAreaStartEnd(f32& x, f32& y, f32& ex, f32& ey) {
  if (ex < x) std::swap(x, ex);
  if (ey < y) std::swap(y, ey);
}

/**
 * Draw a filled rectangle using the whitepixel sprite.
 * Mirrors TypeScript SpritesPipeline.fillRectangle().
 */
void fillRectangle(const RectRenderSubmission& options) {
  f32 x = options.area.left;
  f32 y = options.area.top;
  f32 ex = options.area.right;
  f32 ey = options.area.bottom;
  f32 z = options.area.z;

  correctAreaStartEnd(x, y, ex, ey);

  ImgRenderSubmission sprite;
  sprite.imgid = "whitepixel";
  sprite.pos = {x, y, z};
  sprite.scale = {static_cast<f32>(static_cast<i32>(ex - x)),
				  static_cast<f32>(static_cast<i32>(ey - y))};
  sprite.colorize = options.color;
  sprite.layer = options.layer;

  drawImg(sprite);
}

/**
 * Draw a rectangle outline using the whitepixel sprite.
 * Mirrors TypeScript SpritesPipeline.drawRectangle().
 */
void drawRectangle(const RectRenderSubmission& options) {
  f32 x = options.area.left;
  f32 y = options.area.top;
  f32 ex = options.area.right;
  f32 ey = options.area.bottom;
  f32 z = options.area.z;

  correctAreaStartEnd(x, y, ex, ey);

  const std::string imgid = "whitepixel";
  const Color& c = options.color;
  const auto layer = options.layer;

  // Top edge
  ImgRenderSubmission top;
  top.imgid = imgid;
  top.pos = {x, y, z};
  top.scale = {static_cast<f32>(static_cast<i32>(ex - x)), 1.0f};
  top.colorize = c;
  top.layer = layer;
  drawImg(top);

  // Bottom edge
  ImgRenderSubmission bottom;
  bottom.imgid = imgid;
  bottom.pos = {x, ey, z};
  bottom.scale = {static_cast<f32>(static_cast<i32>(ex - x)), 1.0f};
  bottom.colorize = c;
  bottom.layer = layer;
  drawImg(bottom);

  // Left edge
  ImgRenderSubmission left;
  left.imgid = imgid;
  left.pos = {x, y, z};
  left.scale = {1.0f, static_cast<f32>(static_cast<i32>(ey - y))};
  left.colorize = c;
  left.layer = layer;
  drawImg(left);

  // Right edge
  ImgRenderSubmission right;
  right.imgid = imgid;
  right.pos = {ex, y, z};
  right.scale = {1.0f, static_cast<f32>(static_cast<i32>(ey - y))};
  right.colorize = c;
  right.layer = layer;
  drawImg(right);
}

/**
 * Draw a polygon outline using the whitepixel sprite (Bresenham line).
 * Mirrors TypeScript SpritesPipeline.drawPolygon().
 */
void drawPolygon(const std::vector<f32>& coords, f32 z, const Color& color,
				 f32 thickness, std::optional<RenderLayer> layer) {
  if (coords.size() < 4) return;

  const std::string imgid = "whitepixel";

  // Draw lines between consecutive points
  for (size_t i = 0; i < coords.size(); i += 2) {
	size_t next = (i + 2) % coords.size();
	// Snap to integer grid so Bresenham stepping terminates with fractional inputs.
	f32 x0 = std::round(coords[i]);
	f32 y0 = std::round(coords[i + 1]);
	f32 x1 = std::round(coords[next]);
	f32 y1 = std::round(coords[next + 1]);

	// Bresenham line algorithm (mirrors TypeScript)
	f32 dx = std::abs(x1 - x0);
	f32 dy = std::abs(y1 - y0);
	f32 sx = x0 < x1 ? 1.0f : -1.0f;
	f32 sy = y0 < y1 ? 1.0f : -1.0f;
	f32 err = dx - dy;

	while (true) {
	  // Draw pixel at (x0, y0)
	  ImgRenderSubmission pixel;
	  pixel.imgid = imgid;
	  pixel.pos = {x0, y0, z};
	  pixel.scale = {thickness, thickness};
	  pixel.colorize = color;
	  pixel.layer = layer;
	  drawImg(pixel);

	  if (x0 == x1 && y0 == y1) break;

	  f32 e2 = 2.0f * err;
	  if (e2 > -dy) {
		err -= dy;
		x0 += sx;
	  }
	  if (x0 == x1 && y0 == y1) {
		// Draw final pixel
		ImgRenderSubmission finalPixel;
		finalPixel.imgid = imgid;
		finalPixel.pos = {x0, y0, z};
		finalPixel.scale = {thickness, thickness};
		finalPixel.colorize = color;
		finalPixel.layer = layer;
		drawImg(finalPixel);
		break;
	  }
	  if (e2 < dx) {
		err += dx;
		y0 += sy;
	  }
	}
  }
}

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

SpriteQueueDebug getSpriteQueueDebug() {
  return {RenderQueues::spriteQueueFrontSize(),
		  RenderQueues::spriteQueueBackSize()};
}

}  // namespace SpritesPipeline
}  // namespace bmsx
