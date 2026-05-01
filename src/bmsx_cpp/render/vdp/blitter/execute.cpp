#include "render/vdp/blitter/execute.h"

#include "render/vdp/blitter/gles2.h"
#include "render/vdp/blitter/software.h"

namespace bmsx {
namespace {

void executeVdpBlitterQueue(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue) {
	if (queue.empty()) {
		return;
	}
#if BMSX_ENABLE_GLES2
	if (VdpGles2Blitter::execute(vdp, queue)) {
		return;
	}
#endif
	VdpSoftwareBlitter::execute(vdp, queue);
}

} // namespace

void drainReadyVdpExecution(VDP& vdp) {
	const auto* queue = vdp.takeReadyExecutionQueue();
	if (queue == nullptr) {
		return;
	}
	executeVdpBlitterQueue(vdp, *queue);
	vdp.completeReadyExecution(queue);
}

} // namespace bmsx
