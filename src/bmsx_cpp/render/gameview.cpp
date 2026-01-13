/*
 * gameview.cpp - GameView implementation
 *
 * Mirrors TypeScript GameView class.
 * Uses RenderQueues for sprite/mesh/particle submission.
 */

#include "gameview.h"
#if BMSX_ENABLE_GLES2
#include "gles2_backend.h"
#endif
#include "renderpasslib.h"
#include "rendergraph.h"
#include "../core/engine.h"
#include "../core/rompack.h"
#include "texturemanager.h"
#include "../utils/clamp.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * GameView implementation
 * ============================================================================ */

GameView::GameView(i32 viewportWidth, i32 viewportHeight)
	: viewportSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, canvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, offscreenCanvasSize{static_cast<f32>(viewportWidth) * 2.0f, static_cast<f32>(viewportHeight) * 2.0f}
	, windowSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, availableWindowSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
{
	initializeRenderer();
}

GameView::~GameView() {
	dispose();
}

/**
 * Initialize the renderer submit functions.
 *
 * Mirrors TypeScript GameView.renderer.submit structure.
 * Each submit function routes to render_queues helpers.
 */
void GameView::initializeRenderer() {
	// sprite -> RenderQueues::submitSprite
	renderer.submit.sprite = [](const ImgRenderSubmission& s) {
		RenderQueues::submitSprite(s);
	};

	// rect -> RenderQueues::submitRectangle
	renderer.submit.rect = [](const RectRenderSubmission& s) {
		RenderQueues::submitRectangle(s);
	};

	// poly -> RenderQueues::submitDrawPolygon
	renderer.submit.poly = [](const PolyRenderSubmission& s) {
		RenderQueues::submitDrawPolygon(s);
	};

	// glyphs -> RenderQueues::submitGlyphs
	renderer.submit.glyphs = [](const GlyphRenderSubmission& s) {
		RenderQueues::submitGlyphs(s);
	};

	// particle -> ParticlesPipeline (TODO)
	renderer.submit.particle = [](const ParticleRenderSubmission& s) {
		RenderQueues::submit_particle(s);
	};

	// mesh -> MeshPipeline (TODO)
	renderer.submit.mesh = [](const MeshRenderSubmission& s) {
		RenderQueues::submitMesh(s);
	};
}

void GameView::setBackend(std::unique_ptr<GPUBackend> backend) {
	if (m_renderGraph) { // There is a possibility that there is no render graph yet, e.g. during early init when setBackend is called and we immediately have to fallback to software rendering backend!
		m_renderGraph.reset();
	}
	m_backend = std::move(backend);
}

BackendType GameView::backendType() const {
	return m_backend ? m_backend->type() : BackendType::Headless;
}

void GameView::setViewportSize(i32 width, i32 height) {
	viewportSize.x = static_cast<f32>(width);
	viewportSize.y = static_cast<f32>(height);
}

void GameView::configureRenderTargets(const Vec2* viewport, const Vec2* canvas, const Vec2* offscreen) {
	bool viewportChanged = false;
	bool canvasChanged = false;
	bool offscreenChanged = false;

	if (viewport) {
		viewportChanged = (viewportSize.x != viewport->x || viewportSize.y != viewport->y);
		viewportSize = *viewport;
	}
	if (canvas) {
		canvasChanged = (canvasSize.x != canvas->x || canvasSize.y != canvas->y);
		canvasSize = *canvas;
	}
	if (offscreen) {
		offscreenChanged = (offscreenCanvasSize.x != offscreen->x || offscreenCanvasSize.y != offscreen->y);
		offscreenCanvasSize = *offscreen;
	}

	if (!(viewportChanged || canvasChanged || offscreenChanged)) {
		return;
	}

	rebuildGraph();
}

void GameView::init() {
	// Backend resources are configured externally via setBackend()
	rebuildGraph();
}

void GameView::initializeDefaultTextures() {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("[GameView] initializeDefaultTextures called before backend was configured.");
	}

	const Color fallbackColor{1.0f, 1.0f, 1.0f, 1.0f};
	TextureHandle fallback = m_backend->createSolidTexture2D(1, 1, fallbackColor);
	textures["_atlas_primary"] = fallback;
	textures["_atlas_secondary"] = fallback;
	textures["_atlas_fallback"] = fallback;
	m_primaryAtlasIndex = -1;
	m_secondaryAtlasIndex = -1;
	textures[ENGINE_ATLAS_TEXTURE_KEY] = fallback;

	textures["_default_albedo"] = m_backend->createSolidTexture2D(1, 1, {1.0f, 1.0f, 1.0f, 1.0f});
	textures["_default_normal"] = m_backend->createSolidTexture2D(1, 1, {0.5f, 0.5f, 1.0f, 1.0f});
	textures["_default_mr"] = m_backend->createSolidTexture2D(1, 1, {1.0f, 1.0f, 1.0f, 1.0f});
}

void GameView::loadEngineAtlasTexture() {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("[GameView] loadEngineAtlasTexture called before backend was configured.");
	}
	auto* texmanager = EngineCore::instance().texmanager();
	if (!texmanager) {
		throw BMSX_RUNTIME_ERROR("[GameView] TextureManager not configured.");
	}
	TextureHandle handle = texmanager->getTextureByUri(ENGINE_ATLAS_TEXTURE_KEY);
	if (!handle) {
		throw BMSX_RUNTIME_ERROR("[GameView] Engine atlas not uploaded.");
	}
	textures[ENGINE_ATLAS_TEXTURE_KEY] = handle;
}

void GameView::beginFrame() {
	if (!m_backend) return;
	m_backend->beginFrame();
}

/**
 * Main render loop - executes the render graph.
 *
 * Mirrors TypeScript GameView.drawgame().
 * The render graph calls individual pipelines (sprites, meshes, particles, CRT, etc.)
 * in the correct order.
 */
void GameView::drawGame() {
	if (!m_backend) return;

	// Increment frame timing
	m_renderFrameIndex++;

	FrameData frame;
	frame.frameIndex = static_cast<u32>(m_renderFrameIndex);
	frame.time = EngineCore::instance().totalTime();
	frame.delta = EngineCore::instance().deltaTime();
	m_renderGraph->execute(&frame);
}

void GameView::endFrame() {
	if (!m_backend) return;
	m_backend->endFrame();
}

// ─────────────────────────────────────────────────────────────────────────────
// Atlas management (mirrors TypeScript setAtlasIndex)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setAtlasIndex(bool isPrimary, i32 index) {
	i32& currentIndex = isPrimary ? m_primaryAtlasIndex : m_secondaryAtlasIndex;
	if (currentIndex == index) return;
	currentIndex = index;
}

void GameView::setPrimaryAtlas(i32 index) {
	setAtlasIndex(true, index);
}

void GameView::setSecondaryAtlas(i32 index) {
	setAtlasIndex(false, index);
}

i32 GameView::resolveAtlasBindingId(i32 atlasId) const {
	if (atlasId == ENGINE_ATLAS_INDEX) {
		return ENGINE_ATLAS_INDEX;
	}
	if (m_primaryAtlasIndex == atlasId) {
		return 0;
	}
	if (m_secondaryAtlasIndex == atlasId) {
		return 1;
	}
	throw BMSX_RUNTIME_ERROR("[GameView] Atlas not loaded into a slot.");
}

void GameView::setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry) {
	m_pipelineRegistry = std::move(registry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture binding helpers (mirrors TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setActiveTexUnit(i32 unit) {
	if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	m_activeTexUnit = unit;
	static_cast<OpenGLES2Backend*>(m_backend.get())->setActiveTextureUnit(unit);
#endif
}

void GameView::bind2DTex(TextureHandle tex) {
	if (backendType() != BackendType::OpenGLES2) return;
	if (m_activeTexture2D == tex) return;
#if !BMSX_ENABLE_GLES2
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	static_cast<OpenGLES2Backend*>(m_backend.get())->bindTexture2D(tex);
	m_activeTexture2D = tex;
#endif
}

void GameView::bindCubemapTex(TextureHandle tex) {
	if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	if (m_activeCubemap == tex) return;
	m_activeCubemap = tex;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient control API (mirrors TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure) {
	RenderQueues::setSkyboxTintExposure(tint, exposure);
}

void GameView::setParticlesAmbient(i32 mode, f32 factor) {
	RenderQueues::setAmbientDefaults(mode, factor);
}

void GameView::setSpritesAmbient(bool enabled, f32 factor) {
	spriteAmbientEnabledDefault = enabled;
	spriteAmbientFactorDefault = clamp(factor, 0.0f, 1.0f);
}

void GameView::setSpriteParallaxRig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window) {
	RenderQueues::setSpriteParallaxRig(vy, scale, impact, impact_t, bias_px,
									   parallax_strength, scale_strength,
									   flip_strength, flip_window);
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience methods for drawing primitives
//
// These use renderer.submit internally, matching TypeScript behavior.
// ─────────────────────────────────────────────────────────────────────────────

void GameView::fillRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = area;
	submission.color = color;
	submission.layer = layer;
	renderer.submit.rect(submission);
}

void GameView::drawRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Rect;
	submission.area = area;
	submission.color = color;
	submission.layer = layer;
	renderer.submit.rect(submission);
}

void GameView::drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color, RenderLayer layer) {
	PolyRenderSubmission submission;
	submission.points.push_back(static_cast<f32>(x0));
	submission.points.push_back(static_cast<f32>(y0));
	submission.points.push_back(static_cast<f32>(x1));
	submission.points.push_back(static_cast<f32>(y1));
	submission.z = 0.0f;
	submission.color = color;
	submission.thickness = 1.0f;
	submission.layer = layer;
	renderer.submit.poly(submission);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render graph (mirrors TypeScript rebuildGraph)
// ─────────────────────────────────────────────────────────────────────────────

void GameView::rebuildGraph() {
	if (!m_pipelineRegistry) {
		// No pipeline registry yet - this is OK during early init
		return;
	}
	m_renderGraph = m_pipelineRegistry->buildRenderGraph(this, nullptr);
}

namespace {

constexpr f32 kPi = 3.14159265359f;
constexpr f32 kGamma = 2.2f;
constexpr f32 kInvGamma = 1.0f / kGamma;

constexpr f32 kLumaR = 0.299f;
constexpr f32 kLumaG = 0.587f;
constexpr f32 kLumaB = 0.114f;

constexpr f32 kScanlineDepth = 0.07f;
constexpr f32 kApertureStrength = 0.08f;
constexpr f32 kGlowBrightnessClamp = 0.6f;
constexpr f32 kFringingBasePx = 0.8f;
constexpr f32 kFringingQuadCoef = 2.5f;
constexpr f32 kFringingContrastCoef = 0.4f;
constexpr f32 kFringingMix = 0.11f;
constexpr f32 kFringingOffset = 0.5f;
constexpr f32 kBlurFootprintPx = 0.5f;

constexpr f32 kBlackCutoff = 0.015f;
constexpr f32 kBlackSoft = 0.060f;

constexpr f32 kKernelNorm = 1.0f / 256.0f;
constexpr f32 kKernel5x5[25] = {
	1.0f,  4.0f,  6.0f,  4.0f, 1.0f,
	4.0f, 16.0f, 24.0f, 16.0f, 4.0f,
	6.0f, 24.0f, 36.0f, 24.0f, 6.0f,
	4.0f, 16.0f, 24.0f, 16.0f, 4.0f,
	1.0f,  4.0f,  6.0f,  4.0f, 1.0f,
};

inline f32 clamp01(f32 v) {
	return std::min(1.0f, std::max(0.0f, v));
}

inline f32 smoothstep(f32 edge0, f32 edge1, f32 x) {
	const f32 t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3.0f - 2.0f * t);
}

inline f32 linearToSrgb(f32 c) {
	return std::pow(std::max(0.0f, c), kInvGamma);
}

inline f32 fract(f32 v) {
	return v - std::floor(v);
}

const std::array<f32, 256>& srgbToLinearTable() {
	static std::array<f32, 256> table = []() {
		std::array<f32, 256> t{};
		for (i32 i = 0; i < 256; ++i) {
			f32 c = static_cast<f32>(i) / 255.0f;
			t[static_cast<size_t>(i)] = std::pow(c, kGamma);
		}
		return t;
	}();
	return table;
}

inline Color unpackLinear(u32 pixel, const std::array<f32, 256>& table) {
	const u8 r = (pixel >> 16) & 0xFF;
	const u8 g = (pixel >> 8) & 0xFF;
	const u8 b = pixel & 0xFF;
	return {table[r], table[g], table[b], 1.0f};
}

inline Color sampleLinear(const u32* src, i32 width, i32 height, f32 x, f32 y,
						  const std::array<f32, 256>& table) {
	const f32 maxX = static_cast<f32>(width - 1);
	const f32 maxY = static_cast<f32>(height - 1);
	x = std::min(maxX, std::max(0.0f, x));
	y = std::min(maxY, std::max(0.0f, y));

	const i32 x0 = static_cast<i32>(std::floor(x));
	const i32 y0 = static_cast<i32>(std::floor(y));
	const i32 x1 = std::min(x0 + 1, width - 1);
	const i32 y1 = std::min(y0 + 1, height - 1);
	const f32 tx = x - static_cast<f32>(x0);
	const f32 ty = y - static_cast<f32>(y0);

	const Color c00 = unpackLinear(src[y0 * width + x0], table);
	const Color c10 = unpackLinear(src[y0 * width + x1], table);
	const Color c01 = unpackLinear(src[y1 * width + x0], table);
	const Color c11 = unpackLinear(src[y1 * width + x1], table);

	const f32 r0 = c00.r + (c10.r - c00.r) * tx;
	const f32 g0 = c00.g + (c10.g - c00.g) * tx;
	const f32 b0 = c00.b + (c10.b - c00.b) * tx;

	const f32 r1 = c01.r + (c11.r - c01.r) * tx;
	const f32 g1 = c01.g + (c11.g - c01.g) * tx;
	const f32 b1 = c01.b + (c11.b - c01.b) * tx;

	return {
		r0 + (r1 - r0) * ty,
		g0 + (g1 - g0) * ty,
		b0 + (b1 - b0) * ty,
		1.0f
	};
}

inline f32 luminance(const Color& c) {
	return c.r * kLumaR + c.g * kLumaG + c.b * kLumaB;
}

struct BlurContrast {
	Color blurred;
	f32 contrast = 0.0f;
};

inline BlurContrast applyBlurAndContrast(const u32* src, i32 width, i32 height,
										 f32 x, f32 y,
										 const std::array<f32, 256>& table) {
	f32 accumR = 0.0f;
	f32 accumG = 0.0f;
	f32 accumB = 0.0f;
	f32 centerLum = 0.0f;
	f32 neighLum = 0.0f;
	f32 neighCount = 0.0f;
	i32 idx = 0;

	for (i32 oy = -2; oy <= 2; ++oy) {
		for (i32 ox = -2; ox <= 2; ++ox, ++idx) {
			const f32 sampleX = x + static_cast<f32>(ox) * kBlurFootprintPx;
			const f32 sampleY = y + static_cast<f32>(oy) * kBlurFootprintPx;
			const Color s = sampleLinear(src, width, height, sampleX, sampleY, table);
			const f32 w = kKernel5x5[idx] * kKernelNorm;
			accumR += s.r * w;
			accumG += s.g * w;
			accumB += s.b * w;

			if (std::abs(ox) <= 1 && std::abs(oy) <= 1) {
				const f32 lum = luminance(s);
				if (ox == 0 && oy == 0) {
					centerLum = lum;
				} else {
					neighLum += lum;
					neighCount += 1.0f;
				}
			}
		}
	}

	const f32 neighAvg = (neighCount > 0.0f) ? (neighLum / neighCount) : centerLum;
	BlurContrast out;
	out.blurred = {accumR, accumG, accumB, 1.0f};
	out.contrast = std::abs(centerLum - neighAvg);
	return out;
}

inline f32 hashNoise(f32 u, f32 v, f32 t) {
	f32 px = fract(u * 0.1f * 12.9898f);
	f32 py = fract(v * 0.1f * 78.233f);
	f32 pz = fract(t * 0.1f * 43758.5453f);
	const f32 dotp = px * (py + 19.19f) + py * (pz + 19.19f) + pz * (px + 19.19f);
	px += dotp;
	py += dotp;
	pz += dotp;
	return fract((px + py) * pz);
}

} // namespace

// ─────────────────────────────────────────────────────────────────────────────
// CRT Post-processing (software implementation)
//
// This mirrors the WebGL CRT shader for feature parity.
// ─────────────────────────────────────────────────────────────────────────────

void GameView::applyCRTPostProcessing(const u32* src,
									  i32 srcWidth,
									  i32 srcHeight,
									  u32* dst,
									  i32 dstWidth,
									  i32 dstHeight,
									  i32 dstPitch) {
	const i32 dstPixelsPerRow = dstPitch / sizeof(u32);
	const size_t srcSize = static_cast<size_t>(srcWidth) * static_cast<size_t>(srcHeight);

	if (m_crtScratchBuffer.size() < srcSize) {
		m_crtScratchBuffer.resize(srcSize);
	}
	std::memcpy(m_crtScratchBuffer.data(), src, srcSize * sizeof(u32));

	const auto& table = srgbToLinearTable();
	const f32 invOutW = 1.0f / static_cast<f32>(dstWidth);
	const f32 invOutH = 1.0f / static_cast<f32>(dstHeight);
	const f32 srcWf = static_cast<f32>(srcWidth);
	const f32 srcHf = static_cast<f32>(srcHeight);
	const f32 srcMaxX = srcWf - 1.0f;
	const f32 srcMaxY = srcHf - 1.0f;
	const f32 time = static_cast<f32>(EngineCore::instance().totalTime());
	static u32 noiseState = 0x12345678u;
	noiseState = noiseState * 1664525u + 1013904223u;
	const f32 random = static_cast<f32>((noiseState >> 8) & 0xFFFFFF) / 16777215.0f;

	const bool enableCrt = crt_postprocessing_enabled;
	const bool useNoise = enableCrt && applyNoise;
	const bool useColorBleed = enableCrt && applyColorBleed;
	const bool useScanlines = enableCrt && applyScanlines;
	const bool useBlur = enableCrt && applyBlur;
	const bool useGlow = enableCrt && applyGlow;
	const bool useFringing = enableCrt && applyFringing;
	const bool useAperture = enableCrt && applyAperture;
	const f32 blurMix = clamp01(blurIntensity);

	const u32* scratch = m_crtScratchBuffer.data();

	for (i32 y = 0; y < dstHeight; ++y) {
		const f32 uvY = (static_cast<f32>(y) + 0.5f) * invOutH;
		const f32 srcY = uvY * srcMaxY;
		for (i32 x = 0; x < dstWidth; ++x) {
			const f32 uvX = (static_cast<f32>(x) + 0.5f) * invOutW;
			const f32 srcX = uvX * srcMaxX;
			const i32 dstIdx = y * dstPixelsPerRow + x;

			const Color baseTex = sampleLinear(scratch, srcWidth, srcHeight, srcX, srcY, table);
			Color color = baseTex;

			if (useColorBleed) {
				color.r += colorBleed[0];
				color.g += colorBleed[1];
				color.b += colorBleed[2];
			}

			BlurContrast bc;
			if (useBlur || useFringing) {
				bc = applyBlurAndContrast(scratch, srcWidth, srcHeight, srcX, srcY, table);
			} else {
				bc.blurred = color;
				bc.contrast = 0.0f;
			}

			if (useBlur) {
				color.r += (bc.blurred.r - color.r) * blurMix;
				color.g += (bc.blurred.g - color.g) * blurMix;
				color.b += (bc.blurred.b - color.b) * blurMix;
			}

			if (useFringing) {
				const f32 dUVx = uvX - kFringingOffset;
				const f32 dUVy = uvY - kFringingOffset;
				const f32 d = std::sqrt(dUVx * dUVx + dUVy * dUVy) * 1.41421356f;
				const f32 invD = (d > 0.0f) ? (1.0f / std::max(d, 1e-6f)) : 0.0f;
				const f32 dirX = (d > 0.0f) ? (dUVx * invD) : 1.0f;
				const f32 dirY = (d > 0.0f) ? (dUVy * invD) : 0.0f;
				const f32 shiftPx = kFringingBasePx +
									kFringingQuadCoef * (d * d) +
									kFringingContrastCoef * bc.contrast;
				const f32 shiftX = dirX * shiftPx;
				const f32 shiftY = dirY * shiftPx;

				const Color rSample = sampleLinear(scratch, srcWidth, srcHeight,
												   srcX + shiftX, srcY + shiftY, table);
				const Color bSample = sampleLinear(scratch, srcWidth, srcHeight,
												   srcX - shiftX, srcY - shiftY, table);
				const Color fringed{rSample.r, baseTex.g, bSample.b, 1.0f};
				color.r += (fringed.r - color.r) * kFringingMix;
				color.g += (fringed.g - color.g) * kFringingMix;
				color.b += (fringed.b - color.b) * kFringingMix;
			}

			if (useScanlines) {
				const f32 lum = luminance(color);
				const f32 A = kScanlineDepth + (0.12f - kScanlineDepth) * clamp01(lum);
				const f32 row = std::floor(uvY * srcHf);
				const f32 phase = std::cos(kPi * row);
				f32 mask = 1.0f - A * (0.5f - 0.5f * phase);
				mask /= (1.0f - 0.5f * A);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 scale = 1.0f + k * (mask - 1.0f);
				color.r *= scale;
				color.g *= scale;
				color.b *= scale;
			}

			if (useAperture) {
				const f32 xSrc = uvX * srcWf;
				const f32 triad = 0.5f + 0.5f * std::cos(6.2831853f * xSrc);
				const f32 lum = luminance(color);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 maskR = 1.0f + kApertureStrength * triad;
				const f32 maskG = 1.0f;
				const f32 maskB = 1.0f - kApertureStrength * triad;
				color.r *= 1.0f + k * (maskR - 1.0f);
				color.g *= 1.0f + k * (maskG - 1.0f);
				color.b *= 1.0f + k * (maskB - 1.0f);
			}

			if (useGlow) {
				const f32 lum = luminance(color);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 glow = std::min(kGlowBrightnessClamp, std::max(0.0f, lum)) * k;
				color.r += glowColor[0] * glow;
				color.g += glowColor[1] * glow;
				color.b += glowColor[2] * glow;
			}

			if (useNoise) {
				const f32 ySrc = uvY * srcHf;
				const f32 lineNoise =
					hashNoise(0.0f, std::floor(ySrc) + time * 30.0f, 0.0f) - 0.5f;
				const f32 pixNoise =
					hashNoise(uvX * srcWf + random,
							  uvY * srcHf + random,
							  time) - 0.5f;
				const f32 lum = luminance(color);
				const f32 n = pixNoise * 0.65f + lineNoise * 0.35f;
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 amp = noiseIntensity * (1.0f - 0.8f * lum);
				color.r += color.r * (n * amp * k);
				color.g += color.g * (n * amp * k);
				color.b += color.b * (n * amp * k);
			}

			const f32 lumFinal = luminance(color);
			const f32 keep = smoothstep(kBlackCutoff, kBlackSoft, lumFinal);
			color.r *= keep;
			color.g *= keep;
			color.b *= keep;

			const u8 r = static_cast<u8>(clamp01(linearToSrgb(color.r)) * 255.0f);
			const u8 g = static_cast<u8>(clamp01(linearToSrgb(color.g)) * 255.0f);
			const u8 b = static_cast<u8>(clamp01(linearToSrgb(color.b)) * 255.0f);
			dst[dstIdx] = (0xFF << 24) | (r << 16) | (g << 8) | b;
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

void GameView::bind() {
	Registry::instance().registerObject(this);
}

void GameView::unbind() {
	Registry::instance().deregister(this);
}

void GameView::dispose() {
	unbind();
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
	m_backend.reset();
}

void GameView::reset() {
	// Nothing to reset - queues are managed by RenderQueues module
}

} // namespace bmsx
