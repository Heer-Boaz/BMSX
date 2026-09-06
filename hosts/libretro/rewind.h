#pragma once

#include "common/primitives.h"
#include "machine/runtime/history/history.h"

namespace bmsx {

enum class RewindRequest { None, Seek, Resume, Pause, Play };

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
};

} // namespace bmsx
