#include "machine/devices/vdp/registers.h"

namespace bmsx {


void decodeVdpDrawCtrl(u32 value, VdpDrawCtrl& target) {
	target.flipH = (value & VDP_DRAW_CTRL_FLIP_H) != 0u;
	target.flipV = (value & VDP_DRAW_CTRL_FLIP_V) != 0u;
	target.blendMode = (value & VDP_DRAW_CTRL_BLEND_MASK) >> VDP_DRAW_CTRL_BLEND_SHIFT;
}

} // namespace bmsx
