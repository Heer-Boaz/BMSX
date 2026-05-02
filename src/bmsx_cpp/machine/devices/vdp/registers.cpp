#include "machine/devices/vdp/registers.h"

namespace bmsx {

VdpLayerPriority decodeVdpLayerPriority(u32 value) {
	const u32 priority = (value >> 8u) & 0xffffu;
	return {
		static_cast<Layer2D>(value & 0xffu),
		priority,
		static_cast<f32>(priority),
	};
}

u32 encodeVdpLayerPriority(Layer2D layer, f32 priority) {
	return ((static_cast<u32>(static_cast<i32>(priority)) & 0xffffu) << 8u) | (static_cast<u32>(layer) & 0xffu);
}

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

u32 encodeVdpDrawCtrl(bool flipH, bool flipV, u32 pmuBank, f32 parallaxWeight) {
	const u32 rawQ8_8 = static_cast<u32>(static_cast<i32>(parallaxWeight * 256.0f)) & 0xffffu;
	return (flipH ? VDP_DRAW_CTRL_FLIP_H : 0u)
		| (flipV ? VDP_DRAW_CTRL_FLIP_V : 0u)
		| ((pmuBank & 0xffu) << VDP_DRAW_CTRL_PMU_BANK_SHIFT)
		| (rawQ8_8 << VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT);
}

} // namespace bmsx
