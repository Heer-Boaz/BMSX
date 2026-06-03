#pragma once

#include "render/host_overlay/commands.h"
#include <cstddef>

namespace bmsx {

struct HostOverlayFrame {
	i32 width = 0;
	i32 height = 0;
	i32 logicalWidth = 0;
	i32 logicalHeight = 0;
	i32 renderWidth = 0;
	i32 renderHeight = 0;
	const Host2DKind* commandKinds = nullptr;
	const Host2DRef* commandRefs = nullptr;
	size_t commandCount = 0;
};

void publishOverlayFrame(const HostOverlayFrame& frame);
bool hasPendingOverlayFrame();
HostOverlayFrame consumeOverlayFrame();
void clearOverlayFrame();

} // namespace bmsx
