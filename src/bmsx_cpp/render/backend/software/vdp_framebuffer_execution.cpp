#include "render/backend/software/vdp_framebuffer_execution.h"

#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/runtime/runtime.h"
#include "render/backend/backend.h"
#include "render/backend/software/vdp_framebuffer_rasterizer.h"

namespace bmsx {

SoftwareBackend::~SoftwareBackend() = default;

void SoftwareBackend::executeVdpFrameBufferCommands(VDP& vdp, VdpBlitterCommandBuffer& commands, std::vector<u8>& frameBufferPixels) {
	if (m_vdpFrameBufferRasterizerOwner != &vdp) {
		m_vdpFrameBufferRasterizerOwner = &vdp;
		m_vdpFrameBufferRasterizer = std::make_unique<VdpFrameBufferRasterizer>(vdp);
	}
	m_vdpFrameBufferRasterizer->executeFrameBufferCommands(commands, vdp.frameBufferWidth(), vdp.frameBufferHeight(), frameBufferPixels);
}

void SoftwareBackend::bootstrapVdp2DBlit() {
}

void SoftwareBackend::executeVdp2DBlit(VdpFrameBufferExecutionPassState& state) {
	VDP& vdp = state.runtime->machine.vdp;
	if (state.target == VdpFrameBufferExecutionTarget::ActiveFrame) {
		drainReadyVdpFrameBufferExecutionForSoftware(*this, vdp);
		return;
	}
	VdpSurfaceUploadSlot& frameBufferSlot = vdp.frameBufferExecutionTarget();
	executeVdpFrameBufferCommands(vdp, *state.commands, frameBufferSlot.cpuReadback);
	vdp.completeDisplayFrameBufferReplay(frameBufferSlot);
}

void drainReadyVdpFrameBufferExecutionForSoftware(SoftwareBackend& backend, VDP& vdp) {
	VdpBlitterCommandBuffer* commands = vdp.readyFrameBufferCommands();
	if (commands == nullptr) {
		return;
	}
	VdpSurfaceUploadSlot& frameBufferSlot = vdp.frameBufferExecutionTarget();
	backend.executeVdpFrameBufferCommands(vdp, *commands, frameBufferSlot.cpuReadback);
	vdp.completeReadyFrameBufferExecution(frameBufferSlot);
}

} // namespace bmsx
