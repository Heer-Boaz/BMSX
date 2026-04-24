#include "render/vdp/presentation.h"

#include "render/vdp/framebuffer.h"

namespace bmsx {

void commitVdpFrameOnVblankEdge(VDP& vdp) {
	vdp.syncRegisters();
	if (vdp.commitReadyFrameOnVblankEdge()) {
		presentVdpFrameBufferPages(vdp);
	}
}

} // namespace bmsx
