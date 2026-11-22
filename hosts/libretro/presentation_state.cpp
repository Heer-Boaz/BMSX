#include "presentation_state.h"
#include "common/time.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/runtime/runtime.h"
#include "render/backend/pass/library.h"
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

void RenderPresentationState::recordTickCompletion(bool visualCommitted) {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	m_debugPresentTickCompleted += 1;
	if (visualCommitted) {
		m_debugPresentTickCommitted += 1;
	} else {
		m_debugPresentTickDeferred += 1;
	}
}

void RenderPresentationState::recordPresentation(VideoPresenter::PresentationMode mode, bool commitFrame, bool paused) {
	if (!isPresentRateDebugEnabled()) {
		return;
	}
	if (paused) {
		m_debugPresentPausedPresents += 1;
		return;
	}
	if (mode == VideoPresenter::PresentationMode::Partial) {
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
		"[BMSX] host_frames=%llu host_fps=%.2f ufps=%.2f tick_completed=%llu tick_committed=%llu tick_deferred=%llu present_partial=%llu present_commit=%llu present_hold=%llu present_paused=%llu draw_pending=%d active_tick=%d\n",
		static_cast<unsigned long long>(m_debugPresentHostFrames),
		hostFps,
		runtime.timing.ufps,
		static_cast<unsigned long long>(m_debugPresentTickCompleted),
		static_cast<unsigned long long>(m_debugPresentTickCommitted),
		static_cast<unsigned long long>(m_debugPresentTickDeferred),
		static_cast<unsigned long long>(m_debugPresentPartialPresents),
		static_cast<unsigned long long>(m_debugPresentCommitPresents),
		static_cast<unsigned long long>(m_debugPresentHoldPresents),
		static_cast<unsigned long long>(m_debugPresentPausedPresents),
		runtime.isDrawPending() ? 1 : 0,
		runtime.frameLoop.frameActive ? 1 : 0
	);
	m_debugPresentReportAt = now;
	m_debugPresentHostFrames = 0;
	m_debugPresentTickCompleted = 0;
	m_debugPresentTickCommitted = 0;
	m_debugPresentTickDeferred = 0;
	m_debugPresentPartialPresents = 0;
	m_debugPresentCommitPresents = 0;
	m_debugPresentHoldPresents = 0;
	m_debugPresentPausedPresents = 0;
}

void RenderPresentationState::beginHostFrame() {
	if (m_presentationIntent != PresentationIntent::Commit) clearPresentation();
}

void RenderPresentationState::clearPresentation() {
	m_presentationIntent = PresentationIntent::None;
}

void RenderPresentationState::reset(VideoPresenter& presenter, Runtime& runtime) {
	clearPresentation();
	m_pcrtcScanoutRevision = 0u;
	const GxGpuDeviceOutput& output = runtime.machine.gxGpu.readDeviceOutput();
	presenter.setScanoutSize(
		static_cast<i32>(gxGpuDisplayModeScreenWidth(output.displayModeWord)),
		gxGpuVerticalVisibleLines(output.verticalDisplayRangeWord, output.displayModeWord)
	);
	m_debugPresentReportInitialized = false;
	m_debugPresentHostFrames = 0;
	m_debugPresentTickCompleted = 0;
	m_debugPresentTickCommitted = 0;
	m_debugPresentTickDeferred = 0;
	m_debugPresentPartialPresents = 0;
	m_debugPresentCommitPresents = 0;
	m_debugPresentHoldPresents = 0;
	m_debugPresentPausedPresents = 0;
}

void RenderPresentationState::markPresentation(PresentationIntent intent) {
	if (intent > m_presentationIntent) m_presentationIntent = intent;
}

void RenderPresentationState::requestHeldPresentation() {
	markPresentation(PresentationIntent::Held);
}

void RenderPresentationState::requestRestoredPresentation() {
	m_pcrtcScanoutRevision = 0u;
	markPresentation(PresentationIntent::Commit);
}

bool RenderPresentationState::consumePresentation(RenderPresentation& outPresentation) {
	if (m_presentationIntent == PresentationIntent::None) {
		return false;
	}
	outPresentation.mode = m_presentationIntent == PresentationIntent::Partial
		? VideoPresenter::PresentationMode::Partial : VideoPresenter::PresentationMode::Completed;
	outPresentation.commitFrame = m_presentationIntent == PresentationIntent::Commit;

	clearPresentation();
	return true;
}

void RenderPresentationState::syncAfterRuntimeUpdate(Runtime& runtime, i64 previousTickSequence, bool allowPartial) {
	bool tickVisualCommitted = runtime.frameScheduler.lastTickVisualFrameCommitted;
	bool completionPending = false;
	while (runtime.frameScheduler.consumeTickCompletion(m_tickCompletionScratch)) {
		completionPending = true;
		if (m_tickCompletionScratch.visualCommitted) {
			tickVisualCommitted = true;
		}
		recordTickCompletion(m_tickCompletionScratch.visualCommitted);
	}
	if (runtime.frameScheduler.lastTickSequence != previousTickSequence || (!allowPartial && completionPending)) {
		markPresentation(tickVisualCommitted ? PresentationIntent::Commit : PresentationIntent::Held);
	} else if (allowPartial && runtime.isDrawPending()) {
		markPresentation(PresentationIntent::Partial);
	}
}

const GxGpuDeviceOutput* RenderPresentationState::prepare(Runtime& runtime, bool pausedPresent, RenderPresentation& frame) {
	const bool pending = consumePresentation(frame);
	if (!pending && !pausedPresent) return nullptr;
	if (!pending) {
		frame.mode = VideoPresenter::PresentationMode::Completed;
		frame.commitFrame = false;
	}
	const auto& output = runtime.machine.gxGpu.readDeviceOutput();
	frame.gpu = {output.pcrtcScanout, output.vramReplacementSerial};
	recordPresentation(frame.mode, frame.commitFrame, pausedPresent);
	flushDebugReport(runtime);
	return &output;
}

void RenderPresentationState::present(
	VideoPresenter& presenter, const RenderPresentation& frame, f64 currentTime, f64 deltaTime
) {
	const auto& scanout = frame.gpu.pcrtcScanout;
	const bool displayConfigurationChanged = m_pcrtcScanoutRevision != scanout.revision;
	m_pcrtcScanoutRevision = scanout.revision;
	if (displayConfigurationChanged && scanout.outputActive) {
		presenter.setScanoutSize(static_cast<i32>(scanout.outputWidth), static_cast<i32>(scanout.outputHeight));
	}
	presenter.configurePresentation(frame.mode, frame.commitFrame);
	presenter.present(frame.gpu, currentTime, deltaTime);
}

bool RenderPresentationState::render(
	VideoPresenter& presenter, Runtime& runtime, f64 currentTime, f64 deltaTime, bool pausedPresent
) {
	RenderPresentation frame;
	const auto* output = prepare(runtime, pausedPresent, frame);
	if (output == nullptr) return false;
	presenter.backend().executeGxGpuPresentation(*output);
	present(presenter, frame, currentTime, deltaTime);
	if (frame.commitFrame) runtime.machine.gxGpu.retirePresentedCommands();
	return true;
}

} // namespace bmsx
