#include "machine/devices/vdp/blitter.h"

namespace bmsx {

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(value * 255.0f + 0.5f);
}

VdpFrameBufferColor packFrameBufferColor(const Color& color) {
	return {
		frameBufferColorByte(color.r),
		frameBufferColorByte(color.g),
		frameBufferColorByte(color.b),
		frameBufferColorByte(color.a),
	};
}

u32 packFrameBufferColorWord(f32 r, f32 g, f32 b, f32 a) {
	return (static_cast<u32>(frameBufferColorByte(a)) << 24u)
		| (static_cast<u32>(frameBufferColorByte(r)) << 16u)
		| (static_cast<u32>(frameBufferColorByte(g)) << 8u)
		| static_cast<u32>(frameBufferColorByte(b));
}

u32 packFrameBufferColorWord(const Color& color) {
	return packFrameBufferColorWord(color.r, color.g, color.b, color.a);
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
