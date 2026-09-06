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
bool HostRewind::seeking() const { return request == RewindRequest::Seek || (request != RewindRequest::Pause && !playbackActive && runtime.history.mode == HistoryMode::Replaying); }
bool HostRewind::playing() const { return request != RewindRequest::Pause && (playbackActive || request == RewindRequest::Play || afterSeek == RewindRequest::Play); }
bool HostRewind::audioMuted() const { return active && !playbackActive; }
i64 HostRewind::positionCycles() const {
	if (playbackActive) return runtime.machine.scheduler.currentNowCycles();
	return active ? requestedCycles : runtime.history.latestCycles();
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
	afterSeek = RewindRequest::None;
	playbackActive = false;
	presentationPending = false;
	active = true;
	stopped = false;
}

void HostRewind::returnToPresent() {
	if (!active) return;
	seekTo(runtime.history.latestCycles());
	afterSeek = RewindRequest::Resume;
}

void HostRewind::resumeHere() {
	if (seeking()) afterSeek = RewindRequest::Resume;
	else request = RewindRequest::Resume;
}
void HostRewind::pauseSeek() {
	request = RewindRequest::Pause;
	afterSeek = RewindRequest::None;
}

void HostRewind::togglePlayback() {
	if (playing()) pauseSeek();
	else if (seeking()) afterSeek = RewindRequest::Play;
	else if (!active) {
		seekTo(runtime.history.latestCycles());
		afterSeek = RewindRequest::Play;
	} else request = RewindRequest::Play;
}

void HostRewind::capture() {
	presenter.backend().captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	runtime.history.captureCheckpoint();
}

void HostRewind::restore() {
	presenter.backend().finishGxGpuReadbacks();
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
		afterSeek = RewindRequest::None;
		playbackActive = false;
		presentationPending = false;
		stopped = false;
		return;
	}
	if (history.mode == HistoryMode::Disabled) {
		active = false;
		request = RewindRequest::None;
		afterSeek = RewindRequest::None;
		playbackActive = false;
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
			afterSeek = RewindRequest::None;
			playbackActive = false;
			break;
		case RewindRequest::Play:
			request = RewindRequest::None;
			history.beginPlayback();
			playbackActive = history.mode == HistoryMode::Replaying;
			playbackTimeResetPending = true;
			requestedCycles = runtime.machine.scheduler.currentNowCycles();
			stopped = false;
			return;
		case RewindRequest::Pause:
			request = RewindRequest::None;
			if (history.mode == HistoryMode::Recording) active = false;
			else {
				history.cancelSeek();
				history.targetCycles = runtime.machine.scheduler.currentNowCycles();
				requestedCycles = history.targetCycles;
				presentationPending = true;
			}
			afterSeek = RewindRequest::None;
			playbackActive = false;
			break;
		case RewindRequest::None:
			break;
	}
	if (history.checkpointPending) {
		capture();
		return;
	}
	if (!active || playbackActive) return;
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
				requestedCycles = history.targetCycles;
				stopped = true;
				afterSeek = RewindRequest::None;
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
	if (history.mode == HistoryMode::Reviewing && !presentationPending && afterSeek != RewindRequest::None) {
		request = afterSeek;
		afterSeek = RewindRequest::None;
	}
}

void HostRewind::runPlayback(f64 hostDeltaMs) {
	if (!playbackActive) return;
	if (playbackTimeResetPending) {
		playbackTimeResetPending = false;
		hostDeltaMs = 0;
	}
	auto& history = runtime.history;
	auto& gpu = runtime.machine.gxGpu;
	auto& backend = presenter.backend();
	const i64 previousTick = runtime.frameScheduler.lastTickSequence;
	history.advancePlayback(hostDeltaMs);
	while (gpu.backendServicePending()) {
		if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
		else backend.executeGxGpuReadback(gpu);
		history.advancePlayback(0);
	}
	presentation.syncAfterRuntimeUpdate(runtime, previousTick);
	requestedCycles = runtime.machine.scheduler.currentNowCycles();
	if (history.mode == HistoryMode::Reviewing) playbackActive = false;
}

} // namespace bmsx
