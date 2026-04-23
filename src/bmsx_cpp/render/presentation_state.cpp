#include "render/presentation_state.h"
#include "core/engine.h"
#include "core/time.h"
#include "machine/runtime/runtime.h"
#include "render/shared/queues.h"
#include "render/test_pattern.h"
#include "render/vdp/view_snapshot.h"
#include <cstdio>
#include <cstdlib>

namespace bmsx {
namespace {

bool isPresentRateDebugEnabled() {
	static int cached = -1;
	if (cached < 0) {
		const char* env = std::getenv("BMSX_DEBUG_PRESENTRATE");
		cached = (env != nullptr && env[0] != '\0' && !(env[0] == '0' && env[1] == '\0')) ? 1 : 0;
	}
	return cached != 0;
}

} // namespace

void RenderPresentationState::recordHostFrame() {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	if (!m_debugPresentReportInitialized) {
		m_debugPresentReportInitialized = true;
		m_debugPresentReportAt = std::chrono::steady_clock::now();
	}
	m_debugPresentHostFrames += 1;
}

void RenderPresentationState::recordTickCompletion(bool visualCommitted, bool vdpFrameHeld) {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	m_debugPresentTickCompleted += 1;
	if (visualCommitted) {
		m_debugPresentTickCommitted += 1;
	} else {
		m_debugPresentTickDeferred += 1;
	}
	if (vdpFrameHeld) {
		m_debugPresentTickHeld += 1;
	}
}

void RenderPresentationState::recordPresentation(GameView::PresentationMode mode, bool commitFrame, bool paused) {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	if (paused) {
		m_debugPresentPausedPresents += 1;
		return;
	}
	if (mode == GameView::PresentationMode::Partial) {
		m_debugPresentPartialPresents += 1;
		return;
	}
	if (commitFrame) {
		m_debugPresentCommitPresents += 1;
		return;
	}
	m_debugPresentHoldPresents += 1;
}

void RenderPresentationState::flushDebugReport(const Runtime& runtime) {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	const auto now = std::chrono::steady_clock::now();
	if (!m_debugPresentReportInitialized) {
		m_debugPresentReportInitialized = true;
		m_debugPresentReportAt = now;
		return;
	}
	const double elapsedMs = to_ms(now - m_debugPresentReportAt);
	if (elapsedMs < 1000.0) {
		return;
	}
	const double scale = 1000.0 / elapsedMs;
	const double hostFps = static_cast<double>(m_debugPresentHostFrames) * scale;
	std::fprintf(
		stderr,
		"[BMSX] host_frames=%llu host_fps=%.2f ufps=%.2f tick_completed=%llu tick_committed=%llu tick_deferred=%llu tick_held=%llu present_partial=%llu present_commit=%llu present_hold=%llu present_paused=%llu draw_pending=%d active_tick=%d\n",
		static_cast<unsigned long long>(m_debugPresentHostFrames),
		hostFps,
		runtime.timing.ufps,
		static_cast<unsigned long long>(m_debugPresentTickCompleted),
		static_cast<unsigned long long>(m_debugPresentTickCommitted),
		static_cast<unsigned long long>(m_debugPresentTickDeferred),
		static_cast<unsigned long long>(m_debugPresentTickHeld),
		static_cast<unsigned long long>(m_debugPresentPartialPresents),
		static_cast<unsigned long long>(m_debugPresentCommitPresents),
		static_cast<unsigned long long>(m_debugPresentHoldPresents),
		static_cast<unsigned long long>(m_debugPresentPausedPresents),
		runtime.isDrawPending() ? 1 : 0,
		runtime.frameLoop.hasActiveTick(runtime) ? 1 : 0
	);
	m_debugPresentReportAt = now;
	m_debugPresentHostFrames = 0;
	m_debugPresentTickCompleted = 0;
	m_debugPresentTickCommitted = 0;
	m_debugPresentTickDeferred = 0;
	m_debugPresentTickHeld = 0;
	m_debugPresentPartialPresents = 0;
	m_debugPresentCommitPresents = 0;
	m_debugPresentHoldPresents = 0;
	m_debugPresentPausedPresents = 0;
}

void RenderPresentationState::clearPresentation() {
	m_pendingPresentation = false;
	m_presentationMode = GameView::PresentationMode::Completed;
	m_presentationCommitFrame = false;
}

void RenderPresentationState::reset() {
	clearPresentation();
	m_debugPresentReportInitialized = false;
	m_debugPresentHostFrames = 0;
	m_debugPresentTickCompleted = 0;
	m_debugPresentTickCommitted = 0;
	m_debugPresentTickDeferred = 0;
	m_debugPresentTickHeld = 0;
	m_debugPresentPartialPresents = 0;
	m_debugPresentCommitPresents = 0;
	m_debugPresentHoldPresents = 0;
	m_debugPresentPausedPresents = 0;
}

void RenderPresentationState::markPresentation(GameView::PresentationMode mode, bool commitFrame) {
	m_pendingPresentation = true;
	m_presentationMode = mode;
	m_presentationCommitFrame = commitFrame;
}

bool RenderPresentationState::consumePresentation(RenderPresentation& outPresentation) {
	if (!m_pendingPresentation) {
		return false;
	}
	outPresentation.mode = m_presentationMode;
	outPresentation.commitFrame = m_presentationCommitFrame;

	if (outPresentation.mode == GameView::PresentationMode::Completed && outPresentation.commitFrame) {
		RenderQueues::prepareCompletedRenderQueues();
	} else if (outPresentation.mode == GameView::PresentationMode::Completed) {
		RenderQueues::prepareHeldRenderQueues();
	} else {
		RenderQueues::preparePartialRenderQueues();
	}
	clearPresentation();
	return true;
}

void RenderPresentationState::syncAfterRuntimeUpdate(Runtime& runtime, i64 previousTickSequence) {
	if (runtime.frameScheduler.lastTickSequence != previousTickSequence) {
		markPresentation(GameView::PresentationMode::Completed, runtime.frameScheduler.lastTickVisualFrameCommitted);
	} else if (runtime.isDrawPending()) {
		markPresentation(GameView::PresentationMode::Partial, false);
	}
	while (runtime.frameScheduler.consumeTickCompletion(m_tickCompletionScratch)) {
		recordTickCompletion(m_tickCompletionScratch.visualCommitted, m_tickCompletionScratch.vdpFrameHeld);
	}
}

void RenderPresentationState::render(EngineCore& engine, Runtime& runtime) {
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}

	const bool pausedPresent = engine.m_state == EngineState::Paused;
	const bool runtimePresentPending = !pausedPresent && consumePresentation(m_presentationScratch);
	const bool shouldPresent = pausedPresent || runtimePresentPending;
	if (!shouldPresent) {
		return;
	}

	const auto renderStart = std::chrono::steady_clock::now();
	if (engine.m_view) {
		const GameView::PresentationMode presentMode = pausedPresent
			? GameView::PresentationMode::Completed
			: m_presentationScratch.mode;
		const bool commitFrame = pausedPresent
			? false
			: m_presentationScratch.commitFrame;
		recordPresentation(presentMode, commitFrame, pausedPresent);
		if (pausedPresent) {
			RenderQueues::prepareHeldRenderQueues();
		}
		const auto beginStart = std::chrono::steady_clock::now();
		engine.m_view->beginFrame();
		const auto beginEnd = std::chrono::steady_clock::now();
		engine.m_last_render_timing.beginFrameMs = to_ms(beginEnd - beginStart);

		if (!engine.m_rom_loaded) {
			const auto testStart = std::chrono::steady_clock::now();
			renderTestPattern(*engine.m_view, engine.m_total_time);
			const auto testEnd = std::chrono::steady_clock::now();
			engine.m_last_render_timing.testPatternMs = to_ms(testEnd - testStart);
		} else {
			engine.m_last_render_timing.testPatternMs = 0.0;
		}

		engine.m_last_render_timing.runtimeDrawMs = 0.0;
		engine.m_last_render_timing.workbenchModeDrawMs = 0.0;
		engine.m_last_render_timing.runtimeTerminalDrawMs = 0.0;
		if (runtimePresentPending) {
			engine.m_last_render_timing.runtimeDrawMs = m_presentationScratch.runtimeDrawMs;
			engine.m_last_render_timing.workbenchModeDrawMs = m_presentationScratch.workbenchModeDrawMs;
			engine.m_last_render_timing.runtimeTerminalDrawMs = m_presentationScratch.runtimeTerminalDrawMs;
		}

		const auto drawGameStart = std::chrono::steady_clock::now();
		commitVdpViewSnapshot(*engine.m_view, runtime.machine().vdp());
		engine.m_view->configurePresentation(presentMode, commitFrame);
		engine.m_view->drawGame();
		const auto drawGameEnd = std::chrono::steady_clock::now();
		engine.m_last_render_timing.drawGameMs = to_ms(drawGameEnd - drawGameStart);

		const auto endStart = std::chrono::steady_clock::now();
		engine.m_view->endFrame();
		const auto endEnd = std::chrono::steady_clock::now();
		engine.m_last_render_timing.endFrameMs = to_ms(endEnd - endStart);
	}

	engine.m_last_render_timing.totalMs = to_ms(std::chrono::steady_clock::now() - renderStart);
	flushDebugReport(runtime);
}

} // namespace bmsx
