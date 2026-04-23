#include "render/vdp/context_state.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "render/vdp/blitter/gles2.h"

namespace bmsx {

void restoreVdpContextState(VDP& vdp) {
	const auto& frameBufferEntry = vdp.m_memory.getAssetEntry(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	vdp.restoreVramSlotTexture(frameBufferEntry, FRAMEBUFFER_RENDER_TEXTURE_KEY);
	vdp.ensureDisplayFrameBufferTexture();
	vdp.syncRenderFrameBufferToDisplayPage();
	syncVdpSlotTextures(vdp);
}

void captureVdpContextState(VDP& vdp) {
	for (auto& slot : vdp.m_vramSlots) {
		auto& entry = vdp.m_memory.getAssetEntry(slot.assetId);
		if (slot.textureKey != FRAMEBUFFER_RENDER_TEXTURE_KEY) {
			slot.contextSnapshot = slot.cpuReadback;
			continue;
		}
		const size_t bytes = static_cast<size_t>(entry.regionW) * static_cast<size_t>(entry.regionH) * 4u;
		slot.contextSnapshot.resize(bytes);
		readVdpRenderFrameBufferTextureRegion(
			slot.contextSnapshot.data(),
			static_cast<i32>(entry.regionW),
			static_cast<i32>(entry.regionH),
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
