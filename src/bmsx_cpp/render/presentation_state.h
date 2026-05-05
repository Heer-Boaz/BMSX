#pragma once

#include "machine/scheduler/frame.h"
#include "common/primitives.h"
#include "render/gameview.h"
#include <chrono>

namespace bmsx {

class ConsoleCore;
class Runtime;

struct RenderPresentation {
	GameView::PresentationMode mode = GameView::PresentationMode::Completed;
	bool commitFrame = false;
	f64 runtimeDrawMs = 0.0;
	f64 workbenchModeDrawMs = 0.0;
	f64 runtimeTerminalDrawMs = 0.0;
};

class RenderPresentationState {
public:
	void recordHostFrame();
	void clearPresentation();
	void reset();
	void requestHeldPresentation();
	void syncAfterRuntimeUpdate(Runtime& runtime, i64 previousTickSequence);
	bool render(ConsoleCore& console, Runtime& runtime, bool heldPresent = false);

private:
	void recordTickCompletion(bool visualCommitted, bool vdpFrameHeld);
	void recordPresentation(GameView::PresentationMode mode, bool commitFrame, bool paused);
	void flushDebugReport(const Runtime& runtime);
	void markPresentation(GameView::PresentationMode mode, bool commitFrame);
	bool consumePresentation(RenderPresentation& outPresentation);

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
	RenderPresentation m_presentationScratch;
	TickCompletion m_tickCompletionScratch;
};

} // namespace bmsx
