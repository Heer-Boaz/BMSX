#pragma once

#include "common/primitives.h"
#include "machine/runtime/history/history.h"

namespace bmsx {

enum class RewindRequest { None, Seek, Resume, Pause };

class Runtime;
class VideoPresenter;
class RenderPresentationState;

class HostRewind final {
public:
	HostRewind(Runtime& runtime, VideoPresenter& presenter, RenderPresentationState& presentation);
	bool active = false;
	bool stopped = false;
	bool available() const;
	i64 positionCycles() const;
	void stepCheckpoint(i32 direction);
	void seekTo(i64 cycles);
	void returnToPresent();
	void resumeHere();
	void pauseSeek();
	void service(bool collect);

private:
	void capture();
	void restore();

	Runtime& runtime;
	VideoPresenter& presenter;
	RenderPresentationState& presentation;
	HistoryOptions options;
	RewindRequest request = RewindRequest::None;
	i64 requestedCycles = 0;
	bool resumeAtTarget = false;
	bool presentationPending = false;
};

} // namespace bmsx
