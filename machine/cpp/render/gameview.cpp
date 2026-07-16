/*
 * gameview.cpp - GameView implementation
 *
 * Routes host/editor render submissions to render queues.
 */

#include "gameview.h"
#include "backend/pass/library.h"
#include "graph/graph.h"
#include "core/machine_manager.h"
#include <stdexcept>
#include <utility>

namespace bmsx {

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

void GameView::setBackend(std::unique_ptr<GPUBackend> backend) {
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
	clearTextures();
	m_backend = std::move(backend);
}

BackendType GameView::backendType() const {
	return m_backend ? m_backend->type() : BackendType::Headless;
}

void GameView::setRenderTargetSize(i32 width, i32 height) {
	if (viewportSize.x == static_cast<f32>(width) && viewportSize.y == static_cast<f32>(height)) {
		return;
	}
	viewportSize = {static_cast<f32>(width), static_cast<f32>(height)};
	canvasSize = viewportSize;
	offscreenCanvasSize = viewportSize;
	m_host->setRenderTargetSize(*m_backend, width, height);
	resetPresentationHistory();
	rebuildGraph();
}
void GameView::clearTextures() {
	for (const auto& entry : textures) {
		m_backend->destroyTexture(entry.second);
	}
	textures.clear();
}

void GameView::initializeDefaultTextures() {
	if (!m_backend) {
		throw BMSX_RUNTIME_ERROR("[GameView] initializeDefaultTextures called before backend was configured.");
	}

	clearTextures();
	textures["_default_albedo"] = m_backend->createSolidTexture2D(1, 1, 0xffffffffu, RGBA8_SRGB_TEXTURE_PARAMS);
	textures["_default_normal"] = m_backend->createSolidTexture2D(1, 1, 0xff7f7fffu, RGBA8_LINEAR_TEXTURE_PARAMS);
	textures["_default_mr"] = m_backend->createSolidTexture2D(1, 1, 0xffffffffu, RGBA8_LINEAR_TEXTURE_PARAMS);
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
 * The render graph executes the GX GPU, post, and host passes
 * in the correct order.
 */
void GameView::drawgame() {
	if (!m_backend) return;

	m_backend->beginFrame();

	// Increment frame timing
	m_renderFrameIndex++;

	FrameData frame;
	frame.frameIndex = static_cast<u32>(m_renderFrameIndex);
	frame.time = MachineManager::instance().totalTime();
	frame.delta = MachineManager::instance().deltaTime();
	m_renderGraph->execute(&frame);
	finalizePresentation();
	m_backend->endFrame();
}

void GameView::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	m_backend->captureGxGpuVramSnapshot(gxGpu);
}

void GameView::setPipelineRegistry(std::unique_ptr<RenderPassLibrary> registry) {
	m_renderGraph.reset();
	m_pipelineRegistry = std::move(registry);
}

// ─────────────────────────────────────────────────────────────────────────────
// Render graph
// ─────────────────────────────────────────────────────────────────────────────

void GameView::rebuildGraph() {
	if (!m_pipelineRegistry) {
		// No pipeline registry yet - this is OK during early init
		return;
	}
	resetPresentationHistory();
	m_renderGraph = m_pipelineRegistry->buildRenderGraph();
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

void GameView::dispose() {
	Registry::instance().deregister(this);
	m_renderGraph.reset();
	m_pipelineRegistry.reset();
	clearTextures();
	m_backend.reset();
}

} // namespace bmsx
