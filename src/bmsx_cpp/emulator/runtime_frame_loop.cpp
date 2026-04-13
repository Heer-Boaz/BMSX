#include "runtime_frame_loop.h"
#include "../core/engine_core.h"
#include "runtime.h"
#include "../render/shared/render_queues.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;

inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

bool isPresentRateDebugEnabled() {
	static int cached = -1;
	if (cached < 0) {
		const char* env = std::getenv("BMSX_DEBUG_PRESENTRATE");
		cached = (env != nullptr && env[0] != '\0' && !(env[0] == '0' && env[1] == '\0')) ? 1 : 0;
	}
	return cached != 0;
}
}

void RuntimeFrameLoopState::recordHostFrame() {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	if (!m_debugPresentReportInitialized) {
		m_debugPresentReportInitialized = true;
		m_debugPresentReportAt = std::chrono::steady_clock::now();
	}
	m_debugPresentHostFrames += 1;
}

void RuntimeFrameLoopState::recordTickCompletion(bool visualCommitted, bool vdpFrameHeld) {
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

void RuntimeFrameLoopState::recordPresentation(GameView::PresentationMode mode, bool commitFrame, bool paused) {
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

void RuntimeFrameLoopState::flushDebugReport(const Runtime* runtime) {
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
		runtime ? runtime->timing.ufps : DEFAULT_UFPS,
		static_cast<unsigned long long>(m_debugPresentTickCompleted),
		static_cast<unsigned long long>(m_debugPresentTickCommitted),
		static_cast<unsigned long long>(m_debugPresentTickDeferred),
		static_cast<unsigned long long>(m_debugPresentTickHeld),
		static_cast<unsigned long long>(m_debugPresentPartialPresents),
		static_cast<unsigned long long>(m_debugPresentCommitPresents),
		static_cast<unsigned long long>(m_debugPresentHoldPresents),
		static_cast<unsigned long long>(m_debugPresentPausedPresents),
		runtime && runtime->isDrawPending() ? 1 : 0,
		runtime && runtime->hasActiveTick() ? 1 : 0
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

void RuntimeFrameLoopState::clearPresentation() {
	m_pendingPresentation = false;
	m_presentationMode = GameView::PresentationMode::Completed;
	m_presentationCommitFrame = false;
}

void RuntimeFrameLoopState::reset() {
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

void RuntimeFrameLoopState::markPresentation(GameView::PresentationMode mode, bool commitFrame) {
	m_pendingPresentation = true;
	m_presentationMode = mode;
	m_presentationCommitFrame = commitFrame;
}

bool RuntimeFrameLoopState::consumePresentation(Runtime& runtime, RuntimePresentation& outPresentation) {
	if (!m_pendingPresentation) {
		return false;
	}
	outPresentation.mode = m_presentationMode;
	outPresentation.commitFrame = m_presentationCommitFrame;
	auto runtimeDrawStart = std::chrono::steady_clock::now();
	runtime.tickDraw();
	auto runtimeDrawEnd = std::chrono::steady_clock::now();
	outPresentation.runtimeDrawMs = to_ms(runtimeDrawEnd - runtimeDrawStart);

	auto ideDrawStart = std::chrono::steady_clock::now();
	runtime.tickIDEDraw();
	auto ideDrawEnd = std::chrono::steady_clock::now();
	outPresentation.runtimeIdeDrawMs = to_ms(ideDrawEnd - ideDrawStart);

	auto terminalDrawStart = std::chrono::steady_clock::now();
	runtime.tickTerminalModeDraw();
	auto terminalDrawEnd = std::chrono::steady_clock::now();
	outPresentation.runtimeTerminalDrawMs = to_ms(terminalDrawEnd - terminalDrawStart);
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

void RuntimeFrameLoopState::render(EngineCore& engine) {
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}

	const bool pausedPresent = engine.m_state == EngineState::Paused;
	Runtime* runtime = Runtime::hasInstance() ? &Runtime::instance() : nullptr;
	const bool runtimePresentPending = !pausedPresent && runtime != nullptr && consumePresentation(*runtime, m_runtimePresentationScratch);
	const bool shouldPresent = pausedPresent || runtime == nullptr || runtimePresentPending;
	if (!shouldPresent) {
		return;
	}

	const auto renderStart = std::chrono::steady_clock::now();
	if (engine.m_view) {
		const GameView::PresentationMode presentMode = pausedPresent || runtime == nullptr
			? GameView::PresentationMode::Completed
			: m_runtimePresentationScratch.mode;
		const bool commitFrame = pausedPresent || runtime == nullptr
			? false
			: m_runtimePresentationScratch.commitFrame;
		recordPresentation(presentMode, commitFrame, pausedPresent);
		if (pausedPresent) {
			RenderQueues::prepareHeldRenderQueues();
		} else if (runtime == nullptr && presentMode == GameView::PresentationMode::Completed && commitFrame) {
			RenderQueues::prepareCompletedRenderQueues();
		} else if (runtime == nullptr && presentMode == GameView::PresentationMode::Completed) {
			RenderQueues::prepareHeldRenderQueues();
		} else if (runtime == nullptr) {
			RenderQueues::preparePartialRenderQueues();
		}
		const auto beginStart = std::chrono::steady_clock::now();
		engine.m_view->beginFrame();
		const auto beginEnd = std::chrono::steady_clock::now();
		engine.m_last_render_timing.beginFrameMs = to_ms(beginEnd - beginStart);

		if (!engine.m_rom_loaded) {
			const auto testStart = std::chrono::steady_clock::now();
			engine.renderTestPattern();
			const auto testEnd = std::chrono::steady_clock::now();
			engine.m_last_render_timing.testPatternMs = to_ms(testEnd - testStart);
		} else {
			engine.m_last_render_timing.testPatternMs = 0.0;
		}

		engine.m_last_render_timing.runtimeDrawMs = 0.0;
		engine.m_last_render_timing.runtimeIdeDrawMs = 0.0;
		engine.m_last_render_timing.runtimeTerminalDrawMs = 0.0;
		if (runtimePresentPending) {
			engine.m_last_render_timing.runtimeDrawMs = m_runtimePresentationScratch.runtimeDrawMs;
			engine.m_last_render_timing.runtimeIdeDrawMs = m_runtimePresentationScratch.runtimeIdeDrawMs;
			engine.m_last_render_timing.runtimeTerminalDrawMs = m_runtimePresentationScratch.runtimeTerminalDrawMs;
		}

		const auto drawGameStart = std::chrono::steady_clock::now();
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

void RuntimeFrameLoopState::runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender) {
	EngineCore& engine = EngineCore::instance();
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}

	const auto tickStart = std::chrono::steady_clock::now();
	recordHostFrame();
	engine.m_last_tick_timing.inputMs = 0.0;
	engine.m_last_tick_timing.runtimeIdeInputMs = 0.0;
	engine.m_last_tick_timing.runtimeTerminalInputMs = 0.0;
	engine.m_last_tick_timing.runtimeUpdateMs = 0.0;
	engine.m_last_tick_timing.runtimeIdeMs = 0.0;
	engine.m_last_tick_timing.runtimeTerminalMs = 0.0;
	engine.m_last_tick_timing.microtaskMs = 0.0;

	const double hostDeltaMs = std::min(deltaTime * 1000.0, MAX_FRAME_DELTA_MS);
	const double hostDeltaSeconds = hostDeltaMs / 1000.0;
	engine.m_delta_time = hostDeltaSeconds;
	engine.m_total_time += hostDeltaSeconds;
	engine.m_frame_count += 1;
	if (hostDeltaSeconds > 0.0) {
		engine.m_fps = 1.0 / hostDeltaSeconds;
	}

	clearPresentation();
	if (!platformPaused) {
		auto ideInputStart = std::chrono::steady_clock::now();
		runtime.tickIdeInput();
		auto ideInputEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.runtimeIdeInputMs = to_ms(ideInputEnd - ideInputStart);

		auto terminalInputStart = std::chrono::steady_clock::now();
		runtime.tickTerminalInput();
		auto terminalInputEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.runtimeTerminalInputMs = to_ms(terminalInputEnd - terminalInputStart);

		const i64 previousTickSequence = runtime.m_lastTickSequence;
		auto updateStart = std::chrono::steady_clock::now();
		runtime.machineScheduler.run(runtime, hostDeltaMs);
		if (runtime.m_lastTickSequence != previousTickSequence) {
			markPresentation(GameView::PresentationMode::Completed, runtime.m_lastTickVisualFrameCommitted);
		} else if (runtime.isDrawPending()) {
			markPresentation(GameView::PresentationMode::Partial, false);
		}
		while (runtime.machineScheduler.consumeTickCompletion(runtime, m_tickCompletionScratch)) {
			recordTickCompletion(m_tickCompletionScratch.visualCommitted, m_tickCompletionScratch.vdpFrameHeld);
		}
		auto updateEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.runtimeUpdateMs = to_ms(updateEnd - updateStart);

		auto ideStart = std::chrono::steady_clock::now();
		runtime.tickIDE();
		auto ideEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.runtimeIdeMs = to_ms(ideEnd - ideStart);

		auto terminalStart = std::chrono::steady_clock::now();
		runtime.tickTerminalMode();
		auto terminalEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.runtimeTerminalMs = to_ms(terminalEnd - terminalStart);
	}

	if (engine.m_platform && engine.m_platform->microtaskQueue()) {
		const auto microtaskStart = std::chrono::steady_clock::now();
		engine.m_platform->microtaskQueue()->flush();
		const auto microtaskEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);
	}

	engine.m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
	if (!skipRender) {
		render(engine);
	}
}

} // namespace bmsx
