#include "render/vdp/context_state.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "render/vdp/blitter/gles2.h"

namespace bmsx {

void restoreVdpContextState(VDP& vdp) {
	initializeVdpFrameBufferTextures(vdp);
	initializeVdpSlotTextures(vdp);
	#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::initialize();
#endif
}

void captureVdpContextState(VDP& vdp) {
	const VDP::VdpHostOutput output = vdp.readHostOutput();
	const size_t bytes = static_cast<size_t>(output.frameBufferWidth) * static_cast<size_t>(output.frameBufferHeight) * 4u;
	output.frameBufferRenderReadback->resize(bytes);
	readVdpRenderFrameBufferPixels(
		output.frameBufferRenderReadback->data(),
		static_cast<i32>(output.frameBufferWidth),
		static_cast<i32>(output.frameBufferHeight),
		0,
		0
	);
	auto& displayReadback = vdp.frameBufferDisplayReadback();
	displayReadback.resize(bytes);
	readVdpDisplayFrameBufferPixels(
		displayReadback.data(),
		static_cast<i32>(output.frameBufferWidth),
		static_cast<i32>(output.frameBufferHeight),
		0,
		0
	);
}

void shutdownVdpContextState() {
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::shutdown();
#endif
}

} // namespace bmsx
