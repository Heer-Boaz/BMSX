#pragma once

#include "machine/scheduler/frame.h"
#include "common/primitives.h"
#include "render/video_presenter.h"
#include <chrono>

namespace bmsx {

class MachineManager;
class Runtime;

struct RenderPresentation {
	VideoPresenter::PresentationMode mode = VideoPresenter::PresentationMode::Completed;
	bool commitFrame = false;
	f64 runtimeDrawMs = 0.0;
	f64 workbenchModeDrawMs = 0.0;
};

class RenderPresentationState {
public:
	void recordHostFrame();
	void clearPresentation();
	void reset();
	void requestHeldPresentation();
	void syncAfterRuntimeUpdate(Runtime& runtime, i64 previousTickSequence);
	bool render(MachineManager& manager, Runtime& runtime, bool heldPresent = false);

private:
	void recordTickCompletion(bool visualCommitted);
	void recordPresentation(VideoPresenter::PresentationMode mode, bool commitFrame, bool paused);
	void flushDebugReport(const Runtime& runtime);
	void markPresentation(VideoPresenter::PresentationMode mode, bool commitFrame);
	bool consumePresentation(RenderPresentation& outPresentation);

	bool m_pendingPresentation = false;
	VideoPresenter::PresentationMode m_presentationMode = VideoPresenter::PresentationMode::Completed;
	bool m_presentationCommitFrame = false;
	u32 m_pcrtcScanoutRevision = 0u;
	bool m_debugPresentReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugPresentReportAt;
	u64 m_debugPresentHostFrames = 0;
	u64 m_debugPresentTickCompleted = 0;
	u64 m_debugPresentTickCommitted = 0;
	u64 m_debugPresentTickDeferred = 0;
	u64 m_debugPresentPartialPresents = 0;
	u64 m_debugPresentCommitPresents = 0;
	u64 m_debugPresentHoldPresents = 0;
	u64 m_debugPresentPausedPresents = 0;
	RenderPresentation m_presentationScratch;
	TickCompletion m_tickCompletionScratch;
};

} // namespace bmsx
