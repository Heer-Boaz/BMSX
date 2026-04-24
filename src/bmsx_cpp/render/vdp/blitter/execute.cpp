#include "render/vdp/blitter/execute.h"

#include "render/vdp/blitter/gles2.h"
#include "render/vdp/blitter/software.h"

namespace bmsx {
namespace {

void executeVdpBlitterQueue(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue, f64 timeSeconds) {
	if (queue.empty()) {
		return;
	}
#if BMSX_ENABLE_GLES2
	if (VdpGles2Blitter::execute(vdp, queue, timeSeconds)) {
		return;
	}
#endif
	VdpSoftwareBlitter::execute(vdp, queue);
}

} // namespace

void drainReadyVdpExecution(VDP& vdp, f64 timeSeconds) {
	const auto* queue = vdp.takeReadyExecutionQueue();
	if (queue == nullptr) {
		return;
	}
	executeVdpBlitterQueue(vdp, *queue, timeSeconds);
	vdp.completeReadyExecution(queue);
}

} // namespace bmsx
