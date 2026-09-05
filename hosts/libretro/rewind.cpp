#include "rewind.h"

#include "machine/runtime/runtime.h"
#include "presentation_state.h"
#include "render/video_presenter.h"
#include <algorithm>
#include <chrono>

namespace bmsx {
namespace {
constexpr i64 REPLAY_CYCLE_GRANT = 16384;
constexpr i64 REPLAY_WORK_MS = 8;
}

HostRewind::HostRewind(Runtime& runtime, VideoPresenter& presenter, RenderPresentationState& presentation)
	: runtime(runtime), presenter(presenter), presentation(presentation),
		options{2, 1024, runtime.timing.cpuHz * 6} {}

bool HostRewind::available() const { return runtime.history.checkpointCount() != 0; }
i64 HostRewind::positionCycles() const {
	return request == RewindRequest::Seek ? requestedCycles
		: active ? runtime.history.targetCycles : runtime.history.latestCycles();
}

void HostRewind::stepCheckpoint(i32 direction) {
	const auto& history = runtime.history;
	const i64 position = positionCycles();
	if (direction < 0) {
		for (size_t index = history.checkpointCount(); index > 0; --index) {
			const i64 cycles = history.checkpointCycles(index - 1);
			if (cycles < position) { seekTo(cycles); return; }
		}
	} else {
		for (size_t index = 0; index < history.checkpointCount(); ++index) {
			const i64 cycles = history.checkpointCycles(index);
			if (cycles > position) { seekTo(cycles); return; }
		}
	}
}

void HostRewind::seekTo(i64 cycles) {
	const auto& history = runtime.history;
	requestedCycles = std::clamp(cycles, history.earliestCycles(), history.latestCycles());
	request = RewindRequest::Seek;
	resumeAtTarget = false;
	presentationPending = false;
	active = true;
	stopped = false;
}

void HostRewind::returnToPresent() {
	if (!active) return;
	seekTo(runtime.history.latestCycles());
	resumeAtTarget = true;
}

void HostRewind::resumeHere() { request = RewindRequest::Resume; }
void HostRewind::pauseSeek() { request = RewindRequest::Pause; }

void HostRewind::capture() {
	presenter.backend().captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	runtime.history.captureCheckpoint();
}

void HostRewind::restore() {
	presenter.backend().captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	if (request == RewindRequest::Seek) {
		request = RewindRequest::None;
		runtime.history.beginSeek(requestedCycles);
		presentationPending = true;
	}
}

void HostRewind::service(bool collect) {
	auto& history = runtime.history;
	auto& gpu = runtime.machine.gxGpu;
	auto& backend = presenter.backend();
	if (!collect) {
		history.stop();
		active = false;
		request = RewindRequest::None;
		resumeAtTarget = false;
		presentationPending = false;
		stopped = false;
		return;
	}
	if (history.mode == HistoryMode::Disabled) {
		active = false;
		request = RewindRequest::None;
		resumeAtTarget = false;
		presentationPending = false;
		stopped = false;
		history.start(options);
	}
	while (gpu.backendServicePending()) {
		if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
		else backend.executeGxGpuReadback(gpu);
	}
	if (gpu.backendServiceBlocksMachine()) return;
	switch (request) {
		case RewindRequest::Seek:
			restore();
			return;
		case RewindRequest::Resume:
			request = RewindRequest::None;
			if (history.mode != HistoryMode::Recording) history.resumeRecording();
			active = false;
			resumeAtTarget = false;
			break;
		case RewindRequest::Pause:
			request = RewindRequest::None;
			if (history.mode == HistoryMode::Recording) active = false;
			else {
				history.cancelSeek();
				history.targetCycles = runtime.machine.scheduler.currentNowCycles();
				presentationPending = true;
			}
			resumeAtTarget = false;
			break;
		case RewindRequest::None:
			break;
	}
	if (history.checkpointPending) {
		capture();
		return;
	}
	if (!active) return;
	if (history.mode == HistoryMode::Replaying) {
		const i64 previousTick = runtime.frameScheduler.lastTickSequence;
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(REPLAY_WORK_MS);
		while (history.mode == HistoryMode::Replaying) {
			const auto result = history.advanceSeek(REPLAY_CYCLE_GRANT);
			while (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (result == HistorySeekResult::Stopped) {
				history.cancelSeek();
				history.targetCycles = runtime.machine.scheduler.currentNowCycles();
				stopped = true;
				resumeAtTarget = false;
			}
			if (result == HistorySeekResult::Complete || result == HistorySeekResult::Stopped) presentationPending = true;
			if (gpu.backendServiceBlocksMachine() || std::chrono::steady_clock::now() >= deadline) break;
		}
		runtime.machine.audioController.synchronizeOutput().clear();
		runtime.machine.systemDebugTransmit.clearOutput();
		presentation.syncAfterRuntimeUpdate(runtime, previousTick);
	}
	if (presentationPending && !gpu.backendServiceBlocksMachine()) {
		presentation.requestRestoredPresentation();
		presentationPending = false;
	}
	if (history.mode == HistoryMode::Reviewing && !presentationPending && resumeAtTarget) request = RewindRequest::Resume;
}

} // namespace bmsx
