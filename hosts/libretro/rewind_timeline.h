#pragma once

#include "common/rect.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/shared/bmsx_font.h"
#include "render/shared/submissions.h"
#include <array>
#include <string_view>

namespace bmsx {

class Runtime;
class VideoPresenter;
class HostRewind;

class HostRewindTimeline final {
public:
	HostRewindTimeline();
	RectBounds hitRect;
	void moveCursor(Runtime& runtime, HostRewind& rewind, i32 direction);
	void seekAt(Runtime& runtime, HostRewind& rewind, i32 x);
	void queueRenderCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind);

private:
	Font font{FontVariant::Tiny};
	std::array<RectRenderSubmission, 4> rects;
	std::array<GlyphRenderSubmission, 6> labels;
	std::array<i32, 6> labelWidths;
	std::array<Host2DKind, 10> commandKinds;
	std::array<Host2DRef, 10> commandRefs;
	HostMenuFrame renderFrame{commandKinds.data(), commandRefs.data(), commandKinds.size()};
	i64 rangeTenths = -1;
	i64 offsetTenths = -1;
	std::string_view statusText;
};

} // namespace bmsx
