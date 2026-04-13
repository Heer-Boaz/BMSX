#pragma once

#include "runtime_machine_scheduler.h"
#include "../core/types.h"
#include "../render/gameview.h"
#include <chrono>

namespace bmsx {

class Runtime;

struct RuntimePresentation {
	GameView::PresentationMode mode = GameView::PresentationMode::Completed;
	bool commitFrame = false;
	f64 runtimeDrawMs = 0.0;
	f64 runtimeIdeDrawMs = 0.0;
	f64 runtimeTerminalDrawMs = 0.0;
};

class RuntimeFrameLoopState {
public:
	void runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender);
	void clearPresentation();
	void reset();
	void markPresentation(GameView::PresentationMode mode, bool commitFrame);
	bool consumePresentation(Runtime& runtime, RuntimePresentation& outPresentation);

private:
	void recordHostFrame();
	void recordTickCompletion(bool visualCommitted, bool vdpFrameHeld);
	void recordPresentation(GameView::PresentationMode mode, bool commitFrame, bool paused);
	void flushDebugReport(const Runtime* runtime);
	void render(class EngineCore& engine);

	bool m_pendingPresentation = false;
	GameView::PresentationMode m_presentationMode = GameView::PresentationMode::Completed;
	bool m_presentationCommitFrame = false;
	bool m_debugPresentReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugPresentReportAt;
	u64 m_debugPresentHostFrames = 0;
	u64 m_debugPresentTickCompleted = 0;
	u64 m_debugPresentTickCommitted = 0;
	u64 m_debugPresentTickDeferred = 0;
	u64 m_debugPresentTickHeld = 0;
	u64 m_debugPresentPartialPresents = 0;
	u64 m_debugPresentCommitPresents = 0;
	u64 m_debugPresentHoldPresents = 0;
	u64 m_debugPresentPausedPresents = 0;
	RuntimePresentation m_runtimePresentationScratch;
	TickCompletion m_tickCompletionScratch;
};

} // namespace bmsx
