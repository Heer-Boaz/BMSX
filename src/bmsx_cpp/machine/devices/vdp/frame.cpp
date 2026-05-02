#include "machine/devices/vdp/frame.h"

namespace bmsx {

void copyResolvedBlitterSample(VdpResolvedBlitterSample& target, const VdpResolvedBlitterSample& source) {
	target.source.surfaceId = source.source.surfaceId;
	target.source.srcX = source.source.srcX;
	target.source.srcY = source.source.srcY;
	target.source.width = source.source.width;
	target.source.height = source.source.height;
	target.surfaceWidth = source.surfaceWidth;
	target.surfaceHeight = source.surfaceHeight;
	target.slot = source.slot;
}

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame) {
	frame.queue.clear();
	frame.billboards.clear();
	frame.occupied = false;
	frame.hasCommands = false;
	frame.hasFrameBufferCommands = false;
	frame.ready = false;
	frame.cost = 0;
	frame.workRemaining = 0;
	frame.ditherType = 0;
	frame.skyboxControl = 0;
	frame.skyboxFaceWords.fill(0u);
}

} // namespace bmsx
