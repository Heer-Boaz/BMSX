#include "machine/devices/vdp/blitter.h"

namespace bmsx {

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(value * 255.0f + 0.5f);
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
