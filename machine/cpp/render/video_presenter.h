/*
 * video_presenter.h - Host video presentation for BMSX
 *
 * Manages viewport, render submissions, and presentation.
 */

#ifndef BMSX_VIDEO_PRESENTER_H
#define BMSX_VIDEO_PRESENTER_H

#include "backend/backend.h"
#include "shared/submissions.h"
#include "render/post/device_quantize/mode.h"
#include <array>
#include <memory>
#include <unordered_map>
#include <string>

namespace bmsx {

// Forward declarations
class VideoOutput;
class RenderPassLibrary;
class RenderGraphRuntime;
struct GxGpuDeviceOutput;

/* ============================================================================
 * VideoPresenter - Frontend video presentation
 *
 * For libretro, viewportSize IS the framebuffer size.
 * ============================================================================ */

class VideoPresenter {
public:
	enum class PresentationMode : i32 {
		Partial = 0,
		Completed = 1,
	};
	VideoPresenter(VideoOutput& output, std::unique_ptr<GPUBackend> backend, i32 viewportWidth, i32 viewportHeight);
	~VideoPresenter();

	// ─────────────────────────────────────────────────────────────────────────
	// Backend management
	// ─────────────────────────────────────────────────────────────────────────
	GPUBackend& backend() { return *m_backend; }
	const GPUBackend& backend() const { return *m_backend; }

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
	void clearTextures();
	void initializeDefaultTextures();
	void present(const GxGpuDeviceOutput& output, f64 timeSeconds, f64 deltaSeconds);
	void configurePresentation(PresentationMode mode, bool commitFrame);
	u8 presentationHistoryDestinationIndex() const { return presentationHistorySourceIndex == 0 ? 1 : 0; }

	// ─────────────────────────────────────────────────────────────────────────
	// Textures map
	// ─────────────────────────────────────────────────────────────────────────
	std::unordered_map<std::string, TextureHandle> textures;

	// ─────────────────────────────────────────────────────────────────────────
	// Pipeline registry
	// ─────────────────────────────────────────────────────────────────────────
	void installRenderPipeline(std::unique_ptr<RenderPassLibrary> registry);
	void releaseRenderPipeline();

	// ─────────────────────────────────────────────────────────────────────────
	// Font
	// ─────────────────────────────────────────────────────────────────────────
	BFont* default_font = nullptr;

	// ─────────────────────────────────────────────────────────────────────────
	// Post-processing settings
	// ─────────────────────────────────────────────────────────────────────────
	bool crt_postprocessing_enabled = true;
	DeviceQuantizeMode deviceQuantizeMode() const { return m_deviceQuantizeMode; }
	u64 deviceQuantizeConfigurationRevision() const { return m_deviceQuantizeConfigurationRevision; }
	void setDeviceQuantizeMode(DeviceQuantizeMode mode);

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
	// Render graph
	// ─────────────────────────────────────────────────────────────────────────
	void rebuildGraph();

private:
	void finalizePresentation();
	void resetPresentationHistory();

	VideoOutput& m_output;
	std::unique_ptr<GPUBackend> m_backend;
	std::unique_ptr<RenderPassLibrary> m_pipelineRegistry;
	std::unique_ptr<RenderGraphRuntime> m_renderGraph;
	DeviceQuantizeMode m_deviceQuantizeMode = DeviceQuantizeMode::None;
	u64 m_deviceQuantizeConfigurationRevision = 0u;

	// Frame timing
	u32 m_renderFrameIndex = 0u;
};

} // namespace bmsx

#endif // BMSX_VIDEO_PRESENTER_H
