#include "render/vdp/context_state.h"

#include "render/gameview.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"

namespace bmsx {

void restoreVdpContextState(VDP& vdp, GameView& view) {
	view.vdpFrameBufferTextures().initialize(vdp);
	view.vdpSlotTextures().initialize(vdp);
}

} // namespace bmsx
