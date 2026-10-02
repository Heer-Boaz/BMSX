#pragma once

#include "common/primitives.h"
#include "machine/runtime/history/history.h"

namespace bmsx {

enum class RewindRequest { None, Seek, Resume, Pause, Play, Step };

class Runtime;
class VideoPresenter;
class RenderPresentationState;

class HostRewind final {
public:
	HostRewind(Runtime& runtime, VideoPresenter& presenter, RenderPresentationState& presentation);
	bool active = false;
	bool stopped = false;
	bool available() const;
	bool seeking() const;
	bool playing() const;
	bool audioMuted() const;
	i64 positionCycles() const;
	i64 frameStepCycles(i32 direction, i32 count = 1) const;
	void stepFrame(i32 direction);
	void stepCheckpoint(i32 direction);
	void seekTo(i64 cycles);
	void returnToPresent();
	void resumeHere();
	void pauseSeek();
	void togglePlayback();
	void service(bool collect);
	void runPlayback(f64 hostDeltaMs);

private:
	void capture();
	void restore();

	Runtime& runtime;
	VideoPresenter& presenter;
	RenderPresentationState& presentation;
	HistoryOptions options;
	RewindRequest request = RewindRequest::None;
	i64 requestedCycles = 0;
	RewindRequest afterSeek = RewindRequest::None;
	bool playbackActive = false;
	bool playbackTimeResetPending = false;
	bool presentationPending = false;
	i64 stepTargetTick = 0;
};

} // namespace bmsx
