/*
 * gameview.h - GameView for BMSX
 *
 * Manages viewport, render submissions, and presentation.
 */

#ifndef BMSX_GAMEVIEW_H
#define BMSX_GAMEVIEW_H

#include "backend/backend.h"
#include "shared/submissions.h"
#include "shared/queues.h"
#include "core/registry.h"
#include "../subscription.h"
#include <memory>
#include <unordered_map>
#include <functional>
#include <string>

namespace bmsx {

// Forward declarations
class GameViewHost;
class RenderPassLibrary;
class RenderGraphRuntime;
class LightingSystem;

/* ============================================================================
 * Atmosphere parameters (fog, etc.)
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
 * The renderer.submit functions route to the appropriate pipeline
 * (e.g., framebuffer 2D, MeshPipeline, etc.).
 *
 * For libretro, viewportSize IS the framebuffer size.
 * ============================================================================ */

class GameView : public Registerable {
public:
	enum class PresentationMode : i32 {
		Partial = 0,
		Completed = 1,
	};
	enum class DitherType : i32 {
		None = 0,
		PSX = 1,
		RGB777Output = 2,
		MSX10 = 3
	};
	GameView(GameViewHost* host, i32 viewportWidth, i32 viewportHeight);
	~GameView();

	GameViewHost* host() { return m_host; }
	const GameViewHost* host() const { return m_host; }

	// ─────────────────────────────────────────────────────────────────────────
	// Registerable interface
	// ─────────────────────────────────────────────────────────────────────────
	const Identifier& registryId() const override {
		static const Identifier viewId = "view";
		return viewId;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Backend management
	// ─────────────────────────────────────────────────────────────────────────
	void setBackend(std::unique_ptr<GPUBackend> backend);
	GPUBackend* backend() { return m_backend.get(); }
	const GPUBackend* backend() const { return m_backend.get(); }
	BackendType backendType() const;

	// ─────────────────────────────────────────────────────────────────────────
	// Viewport and canvas sizes
	// ─────────────────────────────────────────────────────────────────────────
	Vec2 viewportSize;       // The logical game resolution (e.g. 256x212 for MSX2)
	Vec2 canvasSize;         // The backing buffer size
	Vec2 offscreenCanvasSize;// Offscreen render target size
	f32 viewportScale = 1.0f;
	f32 canvasScale = 1.0f;

	void setViewportSize(i32 width, i32 height);
	void configureRenderTargets(const Vec2* viewportDimensions = nullptr, const Vec2* canvasDimensions = nullptr, const Vec2* offscreenDimensions = nullptr, const f32* viewportScaleOverride = nullptr, const f32* canvasScaleOverride = nullptr);

	// ─────────────────────────────────────────────────────────────────────────
	// Frame rendering
	// ─────────────────────────────────────────────────────────────────────────
	void init();
	void initializeDefaultTextures();
	void beginFrame();
	void drawGame();
	void endFrame();
	void configurePresentation(PresentationMode mode, bool commitFrame);
	u8 presentationHistoryDestinationIndex() const { return presentationHistorySourceIndex == 0 ? 1 : 0; }

	// ─────────────────────────────────────────────────────────────────────────
	// Render submission
	//
	// These functions route to queues helpers:
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
	// Textures map
	// ─────────────────────────────────────────────────────────────────────────
	std::unordered_map<std::string, TextureHandle> textures;

	// ─────────────────────────────────────────────────────────────────────────
	// Video snapshot fields (owned by VDP, consumed by renderer)
	// ─────────────────────────────────────────────────────────────────────────
	SkyboxImageIds skyboxFaceIds;
	bool skyboxRenderReady = false;
	std::array<f32, SKYBOX_FACE_COUNT * 4> skyboxFaceUvRects{};
	std::array<i32, SKYBOX_FACE_COUNT> skyboxFaceTextpageBindings{};
	std::array<i32, SKYBOX_FACE_COUNT * 2> skyboxFaceSizes{};

	// ─────────────────────────────────────────────────────────────────────────
	// Pipeline registry
	// ─────────────────────────────────────────────────────────────────────────
	RenderPassLibrary* pipelineRegistry() { return m_pipelineRegistry.get(); }
	void setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry);

	// ─────────────────────────────────────────────────────────────────────────
	// Font
	// ─────────────────────────────────────────────────────────────────────────
	BFont* default_font = nullptr;

	// ─────────────────────────────────────────────────────────────────────────
	// Post-processing settings
	// ─────────────────────────────────────────────────────────────────────────
	bool crt_postprocessing_enabled = true;
	DitherType dither_type = DitherType::None;

	// CRT effect toggles and parameters
	bool applyNoise = true;
	bool applyColorBleed = true;
	bool applyScanlines = true;
	bool applyBlur = true;
	bool applyGlow = true;
	bool applyFringing = true;
	bool applyAperture = false;
	f32 noiseIntensity = 0.3f;
	std::array<f32, 3> colorBleed = {0.02f, 0.0f, 0.0f};
	f32 blurIntensity = 0.6f;
	std::array<f32, 3> glowColor = {0.12f, 0.10f, 0.09f};

	// ─────────────────────────────────────────────────────────────────────────
	// Sprite ambient settings
	// ─────────────────────────────────────────────────────────────────────────
	bool spriteAmbientEnabledDefault = false;
	f32 spriteAmbientFactorDefault = 1.0f;
	PresentationMode presentationMode = PresentationMode::Completed;
	bool commitPresentationFrame = false;
	u8 presentationHistorySourceIndex = 0;

	// ─────────────────────────────────────────────────────────────────────────
	// Viewport type for IDE
	// ─────────────────────────────────────────────────────────────────────────
	enum class ViewportType { Viewport, Offscreen };
	ViewportType viewportTypeIde = ViewportType::Viewport;

	// ─────────────────────────────────────────────────────────────────────────
	// Atmosphere (fog)
	// ─────────────────────────────────────────────────────────────────────────
	AtmosphereParams atmosphere;

	// ─────────────────────────────────────────────────────────────────────────
	// Texture binding helpers
	// ─────────────────────────────────────────────────────────────────────────
	i32 activeTexUnit() const { return m_activeTexUnit; }
	void setActiveTexUnit(i32 unit);
	void bind2DTex(TextureHandle tex);
	void bindCubemapTex(TextureHandle tex);

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	void bind();
	void dispose();
	void reset();

	// ─────────────────────────────────────────────────────────────────────────
	// Render graph
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
	// Ambient control API
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
	// These use renderer.submit internally.
	// ─────────────────────────────────────────────────────────────────────────
	void fillRectangle(const RectBounds& area, const Color& color, RenderLayer layer = RenderLayer::World);
	void drawRectangle(const RectBounds& area, const Color& color, RenderLayer layer = RenderLayer::World);
	void drawLine(i32 x0, i32 y0, i32 x1, i32 y1, const Color& color, RenderLayer layer = RenderLayer::World);

private:
	void initializeRenderer();
	void finalizePresentation();
	void resetPresentationHistory();

	GameViewHost* m_host;
	std::unique_ptr<GPUBackend> m_backend;
	std::unique_ptr<RenderPassLibrary> m_pipelineRegistry;
	std::unique_ptr<RenderGraphRuntime> m_renderGraph;
	std::unique_ptr<LightingSystem> m_lightingSystem;

	i32 m_activeTexUnit = -1;

	// CRT post-processing scratch buffer
	std::vector<u32> m_crtScratchBuffer;

	// Frame timing
	i32 m_renderFrameIndex = 0;
	f64 m_lastRenderTimeSeconds = 0.0;
};

} // namespace bmsx

#endif // BMSX_GAMEVIEW_H
