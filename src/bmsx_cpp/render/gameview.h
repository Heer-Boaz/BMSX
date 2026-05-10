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
#include "common/registry.h"
#include "render/vdp/transform.h"
#include "common/subscription.h"
#include <array>
#include <memory>
#include <unordered_map>
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
	void initializeDefaultTextures();
	void drawgame();
	void configurePresentation(PresentationMode mode, bool commitFrame);
	u8 presentationHistoryDestinationIndex() const { return presentationHistorySourceIndex == 0 ? 1 : 0; }

	// ─────────────────────────────────────────────────────────────────────────
	// Textures map
	// ─────────────────────────────────────────────────────────────────────────
	std::unordered_map<std::string, TextureHandle> textures;

	// ─────────────────────────────────────────────────────────────────────────
	// Video snapshot fields (owned by VDP, consumed by renderer)
	// ─────────────────────────────────────────────────────────────────────────
	bool skyboxRenderReady = false;
	std::array<f32, SKYBOX_FACE_COUNT * 4> skyboxFaceUvRects{};
	std::array<i32, SKYBOX_FACE_COUNT> skyboxFaceTextpageBindings{};
	std::array<i32, SKYBOX_FACE_COUNT * 2> skyboxFaceSizes{};
	VdpTransformSnapshot vdpTransform{};
	struct VdpBillboardRenderEntry {
		Vec3 position{0.0f, 0.0f, 0.0f};
		f32 size = 0.0f;
		u32 color = 0u;
		u32 slot = 0u;
		u32 u = 0u;
		u32 v = 0u;
		u32 w = 0u;
		u32 h = 0u;
		std::array<f32, 2> uv0{0.0f, 0.0f};
		std::array<f32, 2> uv1{0.0f, 0.0f};
	};
	std::array<VdpBillboardRenderEntry, VDP_BBU_BILLBOARD_LIMIT> vdpBillboards{};
	size_t vdpBillboardCount = 0u;

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
	bool showResourceUsageGizmo = false;
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
	void dispose();

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
	void setSpritesAmbient(bool enabled, f32 factor = 1.0f);

private:
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
