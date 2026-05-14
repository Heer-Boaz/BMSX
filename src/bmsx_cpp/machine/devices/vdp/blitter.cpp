#include "machine/devices/vdp/blitter.h"

namespace bmsx {

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(value * 255.0f + 0.5f);
}

u32 packArgbColor(const VdpFrameBufferColor& value) {
	return (static_cast<u32>(value.a) << 24u)
		| (static_cast<u32>(value.r) << 16u)
		| (static_cast<u32>(value.g) << 8u)
		| static_cast<u32>(value.b);
}

VdpFrameBufferColor unpackArgbColor(u32 value) {
	return {
		static_cast<u8>((value >> 16u) & 0xffu),
		static_cast<u8>((value >> 8u) & 0xffu),
		static_cast<u8>(value & 0xffu),
		static_cast<u8>((value >> 24u) & 0xffu),
	};
}

} // namespace bmsx
