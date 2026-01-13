/*
 * gameview.h - GameView for BMSX
 *
 * Mirrors TypeScript GameView class.
 * Manages viewport, render submissions, and presentation.
 */

#ifndef BMSX_GAMEVIEW_H
#define BMSX_GAMEVIEW_H

#include "backend.h"
#include "render_types.h"
#include "render_queues.h"
#include "../core/registry.h"
#include "../subscription.h"
#include <memory>
#include <unordered_map>
#include <functional>
#include <string>

namespace bmsx {

// Forward declarations
class BFont;
class RenderPassLibrary;
class RenderGraphRuntime;

/* ============================================================================
 * Atmosphere parameters (fog, etc.)
 *
 * Mirrors TypeScript AtmosphereParams.
 * ============================================================================ */

struct AtmosphereParams {
	f32 fogD50 = 320.0f;
	f32 fogStart = 120.0f;
	std::array<f32, 3> fogColorLow = {0.90f, 0.95f, 1.00f};
	std::array<f32, 3> fogColorHigh = {1.05f, 1.02f, 0.95f};
	f32 fogYMin = 0.0f;
	f32 fogYMax = 200.0f;
	f32 progressFactor = 0.0f;
	bool enableAutoAnimation = false;
};

/* ============================================================================
 * GameView - Main rendering view
 *
 * Mirrors TypeScript GameView class structure.
 * The renderer.submit functions route to the appropriate pipeline
 * (e.g., SpritesPipeline, MeshPipeline, etc.).
 *
 * For libretro, viewportSize IS the framebuffer size.
 * ============================================================================ */

class GameView : public Registerable {
public:
	GameView(i32 viewportWidth, i32 viewportHeight);
	~GameView();

	// ─────────────────────────────────────────────────────────────────────────
	// Registerable interface
	// ─────────────────────────────────────────────────────────────────────────
	const Identifier& registryId() const override {
		static const Identifier viewId = "view";
		return viewId;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Backend management (mirrors TypeScript backend getter/setter)
	// ─────────────────────────────────────────────────────────────────────────
	void setBackend(std::unique_ptr<GPUBackend> backend);
	GPUBackend* backend() { return m_backend.get(); }
	const GPUBackend* backend() const { return m_backend.get(); }
	BackendType backendType() const;

	// ─────────────────────────────────────────────────────────────────────────
	// Viewport and canvas sizes (mirrors TypeScript properties)
	// ─────────────────────────────────────────────────────────────────────────
	Vec2 viewportSize;       // The logical game resolution (e.g. 256x212 for MSX2)
	Vec2 canvasSize;         // The backing buffer size
	Vec2 offscreenCanvasSize;// Offscreen render target size
	Vec2 windowSize;         // Available window size
	Vec2 availableWindowSize;
	f32 viewportScale = 1.0f;
	f32 canvasScale = 1.0f;
	f32 dx = 0.0f;
	f32 dy = 0.0f;
	f32 canvas_dx = 0.0f;
	f32 canvas_dy = 0.0f;

	void setViewportSize(i32 width, i32 height);
	void configureRenderTargets(const Vec2* viewport, const Vec2* canvas, const Vec2* offscreen);

	// ─────────────────────────────────────────────────────────────────────────
	// Frame rendering
	// ─────────────────────────────────────────────────────────────────────────
	void init();
	void initializeDefaultTextures();
	void loadEngineAtlasTexture();
	void beginFrame();
	void drawGame();
	void endFrame();

	// ─────────────────────────────────────────────────────────────────────────
	// Render submission (mirrors TypeScript renderer.submit)
	//
	// These functions route to render_queues helpers:
	// - sprite -> RenderQueues::submitSprite
	// - rect   -> RenderQueues::submitRectangle
	// - poly   -> RenderQueues::submitDrawPolygon
	// - glyphs -> RenderQueues::submitGlyphs
	// - particle -> ParticlesPipeline.submit_particle
	// - mesh   -> MeshPipeline.submitMesh
	// ─────────────────────────────────────────────────────────────────────────
	struct Renderer {
		struct Submit {
			std::function<void(const ImgRenderSubmission&)> sprite;
			std::function<void(const RectRenderSubmission&)> rect;
			std::function<void(const PolyRenderSubmission&)> poly;
			std::function<void(const GlyphRenderSubmission&)> glyphs;
			std::function<void(const ParticleRenderSubmission&)> particle;
			std::function<void(const MeshRenderSubmission&)> mesh;
		} submit;
	};
	Renderer renderer;

	// ─────────────────────────────────────────────────────────────────────────
	// Textures map (mirrors TypeScript textures property)
	// ─────────────────────────────────────────────────────────────────────────
	std::unordered_map<std::string, TextureHandle> textures;

	// ─────────────────────────────────────────────────────────────────────────
	// Atlas management (mirrors TypeScript primaryAtlas/secondaryAtlas)
	// ─────────────────────────────────────────────────────────────────────────
	i32 primaryAtlas() const { return m_primaryAtlasIndex; }
	void setPrimaryAtlas(i32 index);

	i32 secondaryAtlas() const { return m_secondaryAtlasIndex; }
	void setSecondaryAtlas(i32 index);

	i32 resolveAtlasBindingId(i32 atlasId) const;

	// ─────────────────────────────────────────────────────────────────────────
	// Pipeline registry (mirrors TypeScript pipelineRegistry)
	// ─────────────────────────────────────────────────────────────────────────
	RenderPassLibrary* pipelineRegistry() { return m_pipelineRegistry.get(); }
	void setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry);

	// ─────────────────────────────────────────────────────────────────────────
	// Font (mirrors TypeScript default_font)
	// ─────────────────────────────────────────────────────────────────────────
	BFont* default_font = nullptr;

	// ─────────────────────────────────────────────────────────────────────────
	// Post-processing settings (mirrors TypeScript properties exactly)
	// ─────────────────────────────────────────────────────────────────────────
	bool crt_postprocessing_enabled = true;
	bool psx_dither_2d_enabled = true;
	f32 psx_dither2d_intensity = 1.0f;

	// CRT effect toggles and parameters (mirrors TypeScript GameView)
	bool applyNoise = true;
	bool applyColorBleed = true;
	bool applyScanlines = true;
	bool applyBlur = true;
	bool applyGlow = true;
	bool applyFringing = true;
	bool applyAperture = true;
	f32 noiseIntensity = 0.4f;
	std::array<f32, 3> colorBleed = {0.02f, 0.0f, 0.0f};
	f32 blurIntensity = 0.6f;
	std::array<f32, 3> glowColor = {0.12f, 0.10f, 0.09f};

	// ─────────────────────────────────────────────────────────────────────────
	// Sprite ambient settings (mirrors TypeScript)
	// ─────────────────────────────────────────────────────────────────────────
	bool spriteAmbientEnabledDefault = false;
	f32 spriteAmbientFactorDefault = 1.0f;

	// ─────────────────────────────────────────────────────────────────────────
	// Viewport type for IDE (mirrors TypeScript viewportTypeIde)
	// ─────────────────────────────────────────────────────────────────────────
	enum class ViewportType { Viewport, Offscreen };
	ViewportType viewportTypeIde = ViewportType::Viewport;

	// ─────────────────────────────────────────────────────────────────────────
	// Atmosphere (fog) (mirrors TypeScript)
	// ─────────────────────────────────────────────────────────────────────────
	AtmosphereParams atmosphere;

	// ─────────────────────────────────────────────────────────────────────────
	// Texture binding helpers (mirrors TypeScript activeTexUnit etc.)
	// ─────────────────────────────────────────────────────────────────────────
	i32 activeTexUnit() const { return m_activeTexUnit; }
	void setActiveTexUnit(i32 unit);
	void bind2DTex(TextureHandle tex);
	void bindCubemapTex(TextureHandle tex);

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	void bind();
	void unbind();
	void dispose();
	void reset();

	// ─────────────────────────────────────────────────────────────────────────
	// Render graph (mirrors TypeScript renderGraph)
	// ─────────────────────────────────────────────────────────────────────────
	void rebuildGraph();
	RenderGraphRuntime* renderGraph() { return m_renderGraph.get(); }
	void applyCRTPostProcessing(const u32* src,
								i32 srcWidth,
								i32 srcHeight,
								u32* dst,
								i32 dstWidth,
								i32 dstHeight,
								i32 dstPitch);

	// ─────────────────────────────────────────────────────────────────────────
	// Ambient control API (mirrors TypeScript best-practice toggles)
	// ─────────────────────────────────────────────────────────────────────────
	void setSkyboxTintExposure(const std::array<f32, 3>& tint, f32 exposure = 1.0f);
	void setParticlesAmbient(i32 mode, f32 factor = 1.0f);
	void setSpritesAmbient(bool enabled, f32 factor = 1.0f);
	void setSpriteParallaxRig(f32 vy, f32 scale, f32 impact, f32 impact_t,
							  f32 bias_px, f32 parallax_strength,
							  f32 scale_strength, f32 flip_strength,
							  f32 flip_window);

	// ─────────────────────────────────────────────────────────────────────────
	// Convenience methods for drawing primitives
	// These use renderer.submit internally, matching TypeScript behavior.
	// ─────────────────────────────────────────────────────────────────────────
	void fillRectangle(const RectBounds& area, const Color& color, RenderLayer layer = RenderLayer::World);
	void drawRectangle(const RectBounds& area, const Color& color, RenderLayer layer = RenderLayer::World);
	void drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color, RenderLayer layer = RenderLayer::World);

private:
	void initializeRenderer();
	void setAtlasIndex(bool isPrimary, i32 index);

	std::unique_ptr<GPUBackend> m_backend;
	std::unique_ptr<RenderPassLibrary> m_pipelineRegistry;
	std::unique_ptr<RenderGraphRuntime> m_renderGraph;

	i32 m_primaryAtlasIndex = -1;
	i32 m_secondaryAtlasIndex = -1;
	i32 m_activeTexUnit = -1;
	TextureHandle m_activeTexture2D = nullptr;
	TextureHandle m_activeCubemap = nullptr;

	// CRT post-processing scratch buffer
	std::vector<u32> m_crtScratchBuffer;

	// Frame timing
	i32 m_renderFrameIndex = 0;
	f64 m_lastRenderTimeSeconds = 0.0;
};

} // namespace bmsx

#endif // BMSX_GAMEVIEW_H
