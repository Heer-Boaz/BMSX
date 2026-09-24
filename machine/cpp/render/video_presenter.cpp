/*
 * video_presenter.cpp - Host video presentation for BMSX
 *
 * Routes host/editor render submissions to render queues.
 */

#include "video_presenter.h"
#include "backend/pass/library.h"
#include "graph/graph.h"
#include <stdexcept>
#include <utility>

namespace bmsx {

/* ============================================================================
 * VideoPresenter implementation
 * ============================================================================ */

VideoPresenter::VideoPresenter(VideoOutput& output, std::unique_ptr<GPUBackend> backend, i32 viewportWidth, i32 viewportHeight)
	: viewportSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, canvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, offscreenCanvasSize{static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight)}
	, m_output(output)
	, m_backend(std::move(backend))
{
}

VideoPresenter::~VideoPresenter() {
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
	clearTextures();
}

void VideoPresenter::setScanoutSize(i32 width, i32 height) {
	if (!fixedRenderTargetSize) setRenderTargetSize(width, height);
	if (offscreenCanvasSize.x == static_cast<f32>(width) && offscreenCanvasSize.y == static_cast<f32>(height)) return;
	offscreenCanvasSize = {static_cast<f32>(width), static_cast<f32>(height)};
	rebuildGraph();
}

void VideoPresenter::setFixedRenderTargetSize(i32 width, i32 height) {
	fixedRenderTargetSize = true;
	setRenderTargetSize(width, height);
}

void VideoPresenter::useScanoutRenderTargetSize() {
	fixedRenderTargetSize = false;
	setRenderTargetSize(static_cast<i32>(offscreenCanvasSize.x), static_cast<i32>(offscreenCanvasSize.y));
}

void VideoPresenter::setRenderTargetSize(i32 width, i32 height) {
	if (viewportSize.x == static_cast<f32>(width) && viewportSize.y == static_cast<f32>(height)) {
		return;
	}
	viewportSize = {static_cast<f32>(width), static_cast<f32>(height)};
	canvasSize = viewportSize;
	m_backend->resizePresentationTarget(width, height);
	m_output.setDisplaySize(width, height);
}
void VideoPresenter::clearTextures() {
	for (const auto& entry : textures) {
		m_backend->destroyTexture(entry.second);
	}
	textures.clear();
}

void VideoPresenter::initializeDefaultTextures() {
	clearTextures();
	textures["_default_albedo"] = m_backend->createSolidTexture2D(1, 1, 0xffffffffu, RGBA8_SRGB_TEXTURE_PARAMS);
	textures["_default_normal"] = m_backend->createSolidTexture2D(1, 1, 0xff7f7fffu, RGBA8_LINEAR_TEXTURE_PARAMS);
	textures["_default_mr"] = m_backend->createSolidTexture2D(1, 1, 0xffffffffu, RGBA8_LINEAR_TEXTURE_PARAMS);
}

void VideoPresenter::configurePresentation(PresentationMode mode, bool commitFrame) {
	presentationMode = mode;
	commitPresentationFrame = commitFrame;
}

void VideoPresenter::setDeviceQuantizeMode(DeviceQuantizeMode mode) {
	if (m_deviceQuantizeMode == mode) {
		return;
	}
	m_deviceQuantizeMode = mode;
	m_deviceQuantizeConfigurationRevision += 1u;
}

void VideoPresenter::resetPresentationHistory() {
	m_committedSequence.reset();
	presentationMode = PresentationMode::Completed;
	commitPresentationFrame = false;
	presentationHistorySourceIndex = 0;
}

void VideoPresenter::finalizePresentation() {
	if (!commitPresentationFrame) {
		return;
	}
	presentationHistorySourceIndex = presentationHistoryDestinationIndex();
	m_committedSequence = m_renderFrameIndex;
}

RgbaImage VideoPresenter::captureGameFrame() {
	if (!m_committedSequence) throw std::runtime_error("No completed game frame is available.");
	return m_renderGraph->captureHistoryTexture(presentationHistorySourceIndex);
}

/**
 * Main render loop - executes the render graph.
 *
 * The render graph executes the GX GPU, post, and host passes
 * in the correct order.
 */
void VideoPresenter::present(const GxGpuDeviceOutput& output, f64 timeSeconds, f64 deltaSeconds) {
	m_backend->beginFrame();

	FrameData frame;
	frame.frameIndex = m_renderFrameIndex;
	frame.time = timeSeconds;
	frame.delta = deltaSeconds;
	m_renderGraph->execute(&frame, output);
	m_renderFrameIndex += 1u;
	finalizePresentation();
	m_backend->endFrame();
}

void VideoPresenter::installRenderPipeline(std::unique_ptr<RenderPassLibrary> registry) {
	m_renderGraph.reset();
	m_pipelineRegistry = std::move(registry);
	resetPresentationHistory();
	m_deviceQuantizeConfigurationRevision += 1u;
	m_renderGraph = m_pipelineRegistry->buildRenderGraph();
}

void VideoPresenter::releaseRenderPipeline() {
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Render graph
// ─────────────────────────────────────────────────────────────────────────────

void VideoPresenter::rebuildGraph() {
	m_renderGraph.reset();
	resetPresentationHistory();
	m_deviceQuantizeConfigurationRevision += 1u;
	m_renderGraph = m_pipelineRegistry->buildRenderGraph();
}

} // namespace bmsx
