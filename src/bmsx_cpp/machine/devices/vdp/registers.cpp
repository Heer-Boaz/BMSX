#include "machine/devices/vdp/registers.h"

namespace bmsx {


VdpDrawCtrl decodeVdpDrawCtrl(u32 value) {
	const u32 rawQ8_8 = (value >> VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT) & 0xffffu;
	const i32 signedQ8_8 = (rawQ8_8 & 0x8000u) != 0u ? static_cast<i32>(rawQ8_8) - 0x10000 : static_cast<i32>(rawQ8_8);
	return {
		(value & VDP_DRAW_CTRL_FLIP_H) != 0u,
		(value & VDP_DRAW_CTRL_FLIP_V) != 0u,
		(value & VDP_DRAW_CTRL_BLEND_MASK) >> VDP_DRAW_CTRL_BLEND_SHIFT,
		((value & VDP_DRAW_CTRL_PMU_BANK_MASK) >> VDP_DRAW_CTRL_PMU_BANK_SHIFT) & 0xffu,
		static_cast<f32>(signedQ8_8) / 256.0f,
	};
}

} // namespace bmsx
