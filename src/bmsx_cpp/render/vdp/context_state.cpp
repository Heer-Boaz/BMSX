#include "render/vdp/context_state.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "render/vdp/blitter/gles2.h"

namespace bmsx {

void restoreVdpContextState(VDP& vdp) {
	initializeVdpFrameBufferTextures(vdp);
	initializeVdpSlotTextures(vdp);
	VdpGles2Blitter::initialize();
}

void captureVdpContextState(VDP& vdp) {
	for (auto& slot : vdp.m_vramSlots) {
		if (slot.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
			continue;
		}
		const size_t bytes = static_cast<size_t>(slot.surfaceWidth) * static_cast<size_t>(slot.surfaceHeight) * 4u;
		slot.cpuReadback.resize(bytes);
		readVdpRenderFrameBufferPixels(
			slot.cpuReadback.data(),
			static_cast<i32>(slot.surfaceWidth),
			static_cast<i32>(slot.surfaceHeight),
			0,
			0
		);
		vdp.m_displayFrameBufferCpuReadback.resize(bytes);
		readVdpDisplayFrameBufferPixels(
			vdp.m_displayFrameBufferCpuReadback.data(),
			static_cast<i32>(slot.surfaceWidth),
			static_cast<i32>(slot.surfaceHeight),
			0,
			0
		);
	}
}

void shutdownVdpContextState() {
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::shutdown();
#endif
}

} // namespace bmsx
