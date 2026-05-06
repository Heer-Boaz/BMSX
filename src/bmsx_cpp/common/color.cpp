#include "common/color.h"

namespace bmsx {

Color Color::fromRGBA8(u8 r, u8 g, u8 b, u8 a) {
	return {r / 255.0f, g / 255.0f, b / 255.0f, a / 255.0f};
}

Color Color::fromHex(u32 hex) {
	return fromRGBA8(
		(hex >> 24) & 0xFF,
		(hex >> 16) & 0xFF,
		(hex >> 8) & 0xFF,
		hex & 0xFF
	);
}

u8 Color::channelToByte(f32 value) {
	return static_cast<u8>(value * 255.0f);
}

u32 Color::toRGBA8() const {
	return (static_cast<u32>(channelToByte(r)) << 24)
		| (static_cast<u32>(channelToByte(g)) << 16)
		| (static_cast<u32>(channelToByte(b)) << 8)
		| static_cast<u32>(channelToByte(a));
}

u32 Color::toARGB32() const {
	const u8 ai = channelToByte(a);
	const u8 ri = channelToByte(r);
	const u8 gi = channelToByte(g);
	const u8 bi = channelToByte(b);
	return (static_cast<u32>(ai) << 24)
		| (static_cast<u32>(ri) << 16)
		| (static_cast<u32>(gi) << 8)
		| static_cast<u32>(bi);
}

u32 Color::toRGBA32() const {
	return toRGBA8();
}

Color Color::white() { return {1.0f, 1.0f, 1.0f, 1.0f}; }
Color Color::black() { return {0.0f, 0.0f, 0.0f, 1.0f}; }
Color Color::red() { return {1.0f, 0.0f, 0.0f, 1.0f}; }
Color Color::green() { return {0.0f, 1.0f, 0.0f, 1.0f}; }
Color Color::blue() { return {0.0f, 0.0f, 1.0f, 1.0f}; }
Color Color::transparent() { return {0.0f, 0.0f, 0.0f, 0.0f}; }

} // namespace bmsx
