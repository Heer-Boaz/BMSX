#pragma once

#include "common/primitives.h"

namespace bmsx {

class HostOverlayMenu;
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
};

LibretroFrameResult runLibretroFrame(
	Runtime& runtime,
	LibretroInput& input,
	HostOverlayMenu& overlayMenu,
	HostRewind& rewind,
	RenderPresentationState& presentation,
	VideoPresenter& presenter,
	f64& totalTime,
	f64 deltaTime);

} // namespace bmsx
