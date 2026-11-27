#pragma once

#include "common/primitives.h"

namespace bmsx {

class HostOverlayMenu;
class GlesFrameWorker;
class HostRewind;
class LibretroInput;
class RenderPresentationState;
class Runtime;
class VideoPresenter;

enum class LibretroFrameResult : u8 {
	NotPresented,
	Presented,
	RebootRequested,
	ExitRequested,
	SuspendRequested,
};

LibretroFrameResult runLibretroFrame(
	Runtime& runtime,
	LibretroInput& input,
	HostOverlayMenu& overlayMenu,
	HostRewind& rewind,
	RenderPresentationState& presentation,
	VideoPresenter& presenter,
	f64& totalTime,
	f64 deltaTime,
	bool singleGuestTick = false,
	GlesFrameWorker* worker = nullptr);

} // namespace bmsx
