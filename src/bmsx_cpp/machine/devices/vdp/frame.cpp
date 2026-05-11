#include "machine/devices/vdp/frame.h"

namespace bmsx {

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
	frame.xf.reset();
	frame.skyboxControl = 0;
	frame.skyboxFaceWords.fill(0u);
}

} // namespace bmsx
