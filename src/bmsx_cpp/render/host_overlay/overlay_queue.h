#pragma once

#include "render/shared/queues.h"
#include <cstddef>

namespace bmsx {

struct HostOverlayFrame {
	i32 width = 0;
	i32 height = 0;
	i32 logicalWidth = 0;
	i32 logicalHeight = 0;
	i32 renderWidth = 0;
	i32 renderHeight = 0;
	size_t commandCount = 0;
};

namespace HostOverlayQueue {

void clearOverlayCommands();
void submitImage(HostImageRenderSubmission command);
void submitRectangle(RectRenderSubmission command);
void submitDrawPolygon(PolyRenderSubmission command);
void submitGlyphs(GlyphRenderSubmission command);
void publishOverlayFrame(const HostOverlayFrame& frame);
bool hasPendingOverlayFrame();
const HostOverlayFrame& consumeOverlayFrame();
const RenderQueues::Host2DEntry& commandAt(size_t index);
void clearOverlayFrame();

} // namespace HostOverlayQueue

} // namespace bmsx
