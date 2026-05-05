/*
 * gameview.cpp - GameView implementation
 *
 * Routes host/editor render submissions to render queues. BMSX machine VDP work
 * enters through VDP MMIO/FIFO/DMA, not renderer submissions.
 */

#include "gameview.h"
#if BMSX_ENABLE_GLES2
#include "backend/gles2_backend.h"
#endif
#include "backend/pass/library.h"
#include "graph/graph.h"
#include "lighting/system.h"
#include "core/console.h"
#include "machine/runtime/runtime.h"
#include "rompack/format.h"
#include "texture_manager.h"
#include "common/clamp.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <utility>

namespace bmsx {

namespace {

void submitRectPrimitive(RectRenderSubmission::Kind kind,
							const RectBounds& area,
							const Color& color,
							RenderLayer layer) {
	RectRenderSubmission submission;
	submission.kind = kind;
	submission.area = area;
	submission.color = color;
	submission.layer = layer;
	RenderQueues::submitRectangle(std::move(submission));
}

} // namespace

/* ============================================================================
 * GameView implementation
 * ============================================================================ */

GameView::GameView(GameViewHost* host, i32 viewportWidth, i32 viewportHeight)
	: viewportSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, canvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, offscreenCanvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, m_host(host)
{
}

GameView::~GameView() {
	dispose();
}

void GameView::bindRuntime(Runtime& runtime) {
	m_runtime = &runtime;
}

Runtime& GameView::runtime() {
	if (!m_runtime) {
		throw BMSX_RUNTIME_ERROR("[GameView] Runtime dependency is not bound.");
	}
	return *m_runtime;
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

void GameView::configureRenderTargets(const Vec2* viewport, const Vec2* canvas, const Vec2* offscreen, const f32* viewportScaleOverride, const f32* canvasScaleOverride) {
	bool viewportChanged = false;
	bool canvasChanged = false;
	bool offscreenChanged = false;
	bool viewportScaleChanged = false;
	bool canvasScaleChanged = false;

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

	const ViewportDimensions dims = m_host->getSize(viewportSize, canvasSize);

	f32 targetViewportScale = viewportScaleOverride ? *viewportScaleOverride : dims.viewportScale;
	f32 targetCanvasScale = canvasScaleOverride ? *canvasScaleOverride : dims.canvasScale;

	if (viewportScale != targetViewportScale) {
		viewportScaleChanged = true;
		viewportScale = targetViewportScale;
	}
	if (canvasScale != targetCanvasScale) {
		canvasScaleChanged = true;
		canvasScale = targetCanvasScale;
	}

	if (!(viewportChanged || canvasChanged || offscreenChanged || viewportScaleChanged || canvasScaleChanged)) {
		return;
	}

	resetPresentationHistory();
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
	textures[VDP_PRIMARY_SLOT_TEXTURE_KEY] = fallback;
	textures[VDP_SECONDARY_SLOT_TEXTURE_KEY] = fallback;
	skyboxRenderReady = false;
	textures[SYSTEM_SLOT_TEXTURE_KEY] = fallback;

	textures["_default_albedo"] = m_backend->createSolidTexture2D(1, 1, {1.0f, 1.0f, 1.0f, 1.0f});
	textures["_default_normal"] = m_backend->createSolidTexture2D(1, 1, {0.5f, 0.5f, 1.0f, 1.0f});
	textures["_default_mr"] = m_backend->createSolidTexture2D(1, 1, {1.0f, 1.0f, 1.0f, 1.0f});
}

void GameView::beginFrame() {
	if (!m_backend) return;
	m_activeTexUnit = -1;
	m_backend->beginFrame();
}

void GameView::configurePresentation(PresentationMode mode, bool commitFrame) {
	presentationMode = mode;
	commitPresentationFrame = commitFrame;
}

void GameView::resetPresentationHistory() {
	presentationMode = PresentationMode::Completed;
	commitPresentationFrame = false;
	presentationHistorySourceIndex = 0;
}

void GameView::finalizePresentation() {
	if (!commitPresentationFrame) {
		return;
	}
	presentationHistorySourceIndex = presentationHistoryDestinationIndex();
}

/**
 * Main render loop - executes the render graph.
 *
 * The render graph calls individual pipelines (sprites, meshes, particles, CRT, etc.)
 * in the correct order.
 */
void GameView::drawGame() {
	if (!m_backend) return;

	// Increment frame timing
	m_renderFrameIndex++;

	FrameData frame;
	frame.frameIndex = static_cast<u32>(m_renderFrameIndex);
	frame.time = ConsoleCore::instance().totalTime();
	frame.delta = ConsoleCore::instance().deltaTime();
	m_renderGraph->execute(&frame);
	finalizePresentation();
}

void GameView::endFrame() {
	if (!m_backend) return;
	m_backend->endFrame();
}

void GameView::setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry) {
	m_pipelineRegistry = std::move(registry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Texture binding helpers
// ─────────────────────────────────────────────────────────────────────────────

void GameView::setActiveTexUnit(i32 unit) {
	if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
	(void)unit;
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	m_activeTexUnit = unit;
	static_cast<OpenGLES2Backend*>(m_backend.get())->setActiveTextureUnit(unit);
#endif
}

void GameView::bind2DTex(TextureHandle tex) {
	if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
	(void)tex;
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	static_cast<OpenGLES2Backend*>(m_backend.get())->bindTexture2D(tex);
#endif
}

void GameView::bindCubemapTex(TextureHandle tex) {
	if (backendType() != BackendType::OpenGLES2) return;
#if !BMSX_ENABLE_GLES2
	(void)tex;
	throw BMSX_RUNTIME_ERROR("[GameView] OpenGLES2 backend disabled at compile time.");
#else
	(void)tex;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient control API
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

// ─────────────────────────────────────────────────────────────────────────────
// Convenience methods for host/editor drawing primitives.
// ─────────────────────────────────────────────────────────────────────────────

void GameView::fillRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
	submitRectPrimitive(RectRenderSubmission::Kind::Fill, area, color, layer);
}

void GameView::drawRectangle(const RectBounds& area, const Color& color, RenderLayer layer) {
	submitRectPrimitive(RectRenderSubmission::Kind::Rect, area, color, layer);
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
	RenderQueues::submitDrawPolygon(std::move(submission));
}

// ─────────────────────────────────────────────────────────────────────────────
// Render graph
// ─────────────────────────────────────────────────────────────────────────────

void GameView::rebuildGraph() {
	if (!m_pipelineRegistry) {
		// No pipeline registry yet - this is OK during early init
		return;
	}
	if (!m_lightingSystem) {
		m_lightingSystem = std::make_unique<LightingSystem>();
	}
	resetPresentationHistory();
	m_renderGraph = m_pipelineRegistry->buildRenderGraph(this, *m_lightingSystem);
}

namespace {

constexpr f32 kPi = 3.14159265359f;
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
	return clamp(v, 0.0f, 1.0f);
}

inline f32 smoothstep(f32 edge0, f32 edge1, f32 x) {
	const f32 t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3.0f - 2.0f * t);
}

// --- Exact sRGB transfer functions (IEC 61966-2-1) ---
inline f32 srgbToLinearExact(f32 c) {
	c = std::max(0.0f, c);
	if (c <= 0.04045f) return c / 12.92f;
	return std::pow((c + 0.055f) / 1.055f, 2.4f);
}

inline f32 linearToSrgbExact(f32 c) {
	c = std::max(0.0f, c);
	if (c <= 0.0031308f) return 12.92f * c;
	return 1.055f * std::pow(c, 1.0f / 2.4f) - 0.055f;
}

inline f32 fract(f32 v) {
	return v - std::floor(v);
}

const std::array<f32, 256>& byteToLinearTable() {
	static std::array<f32, 256> table = []() {
		std::array<f32, 256> t{};
		for (i32 i = 0; i < 256; ++i) {
			t[static_cast<size_t>(i)] = static_cast<f32>(i) / 255.0f;
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
	const i32 xi = static_cast<i32>(std::floor(x + 0.5f));
	const i32 yi = static_cast<i32>(std::floor(y + 0.5f));
	const i32 clampedX = clamp(xi, 0, width - 1);
	const i32 clampedY = clamp(yi, 0, height - 1);
	return unpackLinear(src[clampedY * width + clampedX], table);
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

inline f32 bayer4x4_0_1(i32 x, i32 y) {
	static const f32 B4[16] = {
		0.0f,  8.0f,  2.0f, 10.0f,
		12.0f, 4.0f, 14.0f, 6.0f,
		3.0f, 11.0f, 1.0f,  9.0f,
		15.0f, 7.0f, 13.0f, 5.0f,
	};
	const i32 ix = x & 3;
	const i32 iy = y & 3;
	return (B4[ix + (iy << 2)] + 0.5f) * (1.0f / 16.0f);
}

inline f32 quantizeOrderedConditional(f32 c, f32 levels, f32 thr0_1) {
	const f32 x = clamp01(c) * levels;
	const f32 q = std::floor(x);
	const f32 f = fract(x);
	const f32 up = (f >= thr0_1) ? 1.0f : 0.0f;
	return (q + up) / levels;
}

inline f32 quantizeRgb777Output(f32 c, f32 thr0_1) {
	const f32 levels = 127.0f;
	const f32 v = clamp01(c) * levels;
	const f32 q = std::floor(v);
	const f32 f = fract(v);
	const f32 up = (f >= thr0_1) ? 1.0f : 0.0f;
	return (q + up) / levels;
}

inline i32 psxDitherOffset4x4(i32 x, i32 y) {
	static const i32 D4[16] = {
		-4,  0, -3,  1,
			2, -2,  3, -1,
		-3,  1, -4,  0,
			3, -1,  2, -2
	};
	const i32 ix = x & 3;
	const i32 iy = y & 3;
	return D4[ix + (iy << 2)];
}

inline f32 quantizeRgb555PSX(f32 c, i32 ditherOffset) {
	const f32 v8 = clamp01(c) * 255.0f + static_cast<f32>(ditherOffset);
	const f32 v8clamped = clamp(v8, 0.0f, 255.0f);
	const f32 v5 = std::floor(v8clamped / 8.0f);
	return v5 / 31.0f;
}

} // namespace

// ─────────────────────────────────────────────────────────────────────────────
// CRT Post-processing (software implementation)
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

	const auto& table = byteToLinearTable();
	const f32 invOutW = 1.0f / static_cast<f32>(dstWidth);
	const f32 invOutH = 1.0f / static_cast<f32>(dstHeight);
	const f32 srcWf = static_cast<f32>(srcWidth);
	const f32 srcHf = static_cast<f32>(srcHeight);
	const f32 srcMaxX = srcWf - 1.0f;
	const f32 srcMaxY = srcHf - 1.0f;
	const f32 time = static_cast<f32>(ConsoleCore::instance().totalTime());
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
	const i32 ditherType = static_cast<i32>(dither_type);
	const bool useDither = ditherType != 0;

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

			if (useDither) {
				const i32 sx = static_cast<i32>(std::floor(srcX + 0.5f));
				const i32 sy = static_cast<i32>(std::floor(srcY + 0.5f));
				const f32 sigR = linearToSrgbExact(color.r);
				const f32 sigG = linearToSrgbExact(color.g);
				const f32 sigB = linearToSrgbExact(color.b);
				f32 qR = sigR;
				f32 qG = sigG;
				f32 qB = sigB;
				if (ditherType == 1) {
					const i32 off = psxDitherOffset4x4(sx, sy);
					qR = quantizeRgb555PSX(sigR, off);
					qG = quantizeRgb555PSX(sigG, off);
					qB = quantizeRgb555PSX(sigB, off);
				} else if (ditherType == 2) {
					const f32 thrR = bayer4x4_0_1(sx, sy);
					const f32 thrG = bayer4x4_0_1(sx + 1, sy + 2);
					const f32 thrB = bayer4x4_0_1(sx + 2, sy + 1);
					qR = quantizeRgb777Output(sigR, thrR);
					qG = quantizeRgb777Output(sigG, thrG);
					qB = quantizeRgb777Output(sigB, thrB);
				} else if (ditherType == 3) {
					const f32 thr = bayer4x4_0_1(sx, sy);
					qR = quantizeOrderedConditional(sigR, 7.0f, thr);
					qG = quantizeOrderedConditional(sigG, 15.0f, thr);
					qB = quantizeOrderedConditional(sigB, 7.0f, thr);
				}
				color.r = srgbToLinearExact(qR);
				color.g = srgbToLinearExact(qG);
				color.b = srgbToLinearExact(qB);
			}

			if (useColorBleed) {
				color.r += colorBleed[0];
				color.g += colorBleed[1];
				color.b += colorBleed[2];
			}

			BlurContrast bc;
			if (useBlur || useFringing || useAperture || useScanlines) {
				bc = applyBlurAndContrast(scratch, srcWidth, srcHeight, srcX, srcY, table);
			} else {
				bc.blurred = color;
				bc.contrast = 0.0f;
			}

			const f32 edge = smoothstep(0.01f, 0.05f, bc.contrast);

			if (useBlur) {
				const f32 blurEdge = 1.0f - (0.75f * edge);
				const f32 blurK = blurEdge * blurMix;
				color.r += (bc.blurred.r - color.r) * blurK;
				color.g += (bc.blurred.g - color.g) * blurK;
				color.b += (bc.blurred.b - color.b) * blurK;
			}

			if (useFringing) {
				const f32 mixK = kFringingMix * edge;
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
				color.r += (fringed.r - color.r) * mixK;
				color.g += (fringed.g - color.g) * mixK;
				color.b += (fringed.b - color.b) * mixK;
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
				const f32 scanR = color.r * scale;
				const f32 scanG = color.g * scale;
				const f32 scanB = color.b * scale;
				color.r = scanR * (1.0f - edge) + color.r * edge;
				color.g = scanG * (1.0f - edge) + color.g * edge;
				color.b = scanB * (1.0f - edge) + color.b * edge;
			}

			if (useAperture) {
				const f32 x = std::floor(uvX * srcWf);
				const f32 p = std::fmod(x, 3.0f);
				const f32 r = (std::abs(p - 0.0f) <= 1.0f) ? 1.0f : 0.0f;
				const f32 g = (std::abs(p - 1.0f) <= 1.0f) ? 1.0f : 0.0f;
				const f32 b = (std::abs(p - 2.0f) <= 1.0f) ? 1.0f : 0.0f;
				const f32 maskR = 1.0f + kApertureStrength * ((r * 2.0f) - 1.0f);
				const f32 maskG = 1.0f + kApertureStrength * ((g * 2.0f) - 1.0f);
				const f32 maskB = 1.0f + kApertureStrength * ((b * 2.0f) - 1.0f);
				const f32 lum = luminance(color);
				f32 k = smoothstep(0.0f, 0.25f, lum);
				k = std::sqrt(k);
				const f32 apertureR = color.r * (1.0f + k * (maskR - 1.0f));
				const f32 apertureG = color.g * (1.0f + k * (maskG - 1.0f));
				const f32 apertureB = color.b * (1.0f + k * (maskB - 1.0f));
				color.r = apertureR * (1.0f - edge) + color.r * edge;
				color.g = apertureG * (1.0f - edge) + color.g * edge;
				color.b = apertureB * (1.0f - edge) + color.b * edge;
			}

			if (useGlow) {
				const f32 lum = luminance(color);
				const f32 k = smoothstep(kBlackCutoff, kBlackSoft, lum);
				const f32 glow = clamp(lum, 0.0f, kGlowBrightnessClamp) * k;
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

			if (enableCrt) {
				const f32 lumFinal = luminance(color);
				const f32 keep = smoothstep(kBlackCutoff, kBlackSoft, lumFinal);
				color.r *= keep;
				color.g *= keep;
				color.b *= keep;
			}

			f32 outR = clamp01(linearToSrgbExact(color.r));
			f32 outG = clamp01(linearToSrgbExact(color.g));
			f32 outB = clamp01(linearToSrgbExact(color.b));
			const u8 r = static_cast<u8>(outR * 255.0f);
			const u8 g = static_cast<u8>(outG * 255.0f);
			const u8 b = static_cast<u8>(outB * 255.0f);
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

void GameView::dispose() {
	Registry::instance().deregister(this);
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
	m_backend.reset();
}

void GameView::reset() {
	// Nothing to reset - queues are managed by RenderQueues module
}

} // namespace bmsx
