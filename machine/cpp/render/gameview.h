/*
 * gameview.h - GameView for BMSX
 *
 * Manages viewport, render submissions, and presentation.
 */

#ifndef BMSX_GAMEVIEW_H
#define BMSX_GAMEVIEW_H

#include "backend/backend.h"
#include "shared/submissions.h"
#include "common/registry.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/post/device_quantize/mode.h"
#include "common/subscription.h"
#include <array>
#include <memory>
#include <unordered_map>
#include <string>

namespace bmsx {

// Forward declarations
class GameViewHost;
struct GxGpuCommandBuffer;
class GxGpu;
class RenderPassLibrary;
class RenderGraphRuntime;

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
	Vec2 viewportSize;       // Native machine scanout size.
	Vec2 canvasSize;         // The backing buffer size
	Vec2 offscreenCanvasSize;// Offscreen render target size
	f32 viewportScale = 1.0f;
	f32 canvasScale = 1.0f;

	void setRenderTargetSize(i32 width, i32 height);

	// ─────────────────────────────────────────────────────────────────────────
	// Frame rendering
	// ─────────────────────────────────────────────────────────────────────────
		void initializeDefaultTextures();
		void drawgame();
		void captureGxGpuVramSnapshot(GxGpu& gxGpu);
		void configurePresentation(PresentationMode mode, bool commitFrame);
	u8 presentationHistoryDestinationIndex() const { return presentationHistorySourceIndex == 0 ? 1 : 0; }

	// ─────────────────────────────────────────────────────────────────────────
	// Textures map
	// ─────────────────────────────────────────────────────────────────────────
	std::unordered_map<std::string, TextureHandle> textures;

	// ─────────────────────────────────────────────────────────────────────────
	// Video snapshot fields consumed by the renderer
	// ─────────────────────────────────────────────────────────────────────────
	const GxGpuCommandBuffer* gxGpuCommandBuffer = nullptr;
	GxGpuReadbackPort* gxGpuReadbackPort = nullptr;
	u32 gxGpuStatusWord = 0u;
	u32 gxGpuDisplayModeWord = 0u;
	u32 gxGpuDisplayStartWord = 0u;
	u32 gxGpuHorizontalDisplayRangeWord = 0u;
	u32 gxGpuVerticalDisplayRangeWord = 0u;
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>* gxGpuVramSnapshotBytes = nullptr;
	u64 gxGpuVramSnapshotSerial = 0u;

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
	DeviceQuantizeMode deviceQuantizeMode = DeviceQuantizeMode::None;

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
	// Presentation history
	// ─────────────────────────────────────────────────────────────────────────
	PresentationMode presentationMode = PresentationMode::Completed;
	bool commitPresentationFrame = false;
	u8 presentationHistorySourceIndex = 0;

	// ─────────────────────────────────────────────────────────────────────────
	// Viewport type for IDE
	// ─────────────────────────────────────────────────────────────────────────
	enum class ViewportType { Viewport, Offscreen };
	ViewportType viewportTypeIde = ViewportType::Viewport;

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	void dispose();

	// ─────────────────────────────────────────────────────────────────────────
	// Render graph
	// ─────────────────────────────────────────────────────────────────────────
	void rebuildGraph();
	RenderGraphRuntime* renderGraph() { return m_renderGraph.get(); }

private:
	void finalizePresentation();
	void resetPresentationHistory();

	GameViewHost* m_host;
	std::unique_ptr<GPUBackend> m_backend;
	std::unique_ptr<RenderPassLibrary> m_pipelineRegistry;
	std::unique_ptr<RenderGraphRuntime> m_renderGraph;

	// Frame timing
	i32 m_renderFrameIndex = 0;
	f64 m_lastRenderTimeSeconds = 0.0;
};

} // namespace bmsx

#endif // BMSX_GAMEVIEW_H
