#include "render/vdp/blitter/execute.h"

#include "render/vdp/blitter/gles2.h"
#include "render/vdp/blitter/software.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "render/vdp/texture_transfer.h"

namespace bmsx {
void drainReadyVdpExecution(VDP& vdp) {
	const VDP::VdpHostOutput output = vdp.readHostOutput();
	const auto* queue = output.executionQueue;
	if (queue == nullptr) {
		return;
	}
	if (!queue->empty()) {
#if BMSX_ENABLE_GLES2
		if (vdpTextureBackend().type() == BackendType::OpenGLES2) {
			syncVdpSlotTextures(vdp);
			applyVdpFrameBufferTextureWrites(vdp);
			if (VdpGles2Blitter::execute(output, *queue)) {
				vdp.completeHostExecution(output);
				return;
			}
		}
#endif
		VdpSoftwareBlitter::execute(output, *queue);
	}
	vdp.completeHostExecution(output);
}

} // namespace bmsx
