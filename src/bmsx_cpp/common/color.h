#pragma once

#include "common/types.h"

namespace bmsx {

struct Color {
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;

	Color() = default;
	Color(f32 r_, f32 g_, f32 b_, f32 a_ = 1.0f) : r(r_), g(g_), b(b_), a(a_) {}

	static Color fromRGBA8(u8 r, u8 g, u8 b, u8 a = 255);
	static Color fromHex(u32 hex);
	static u8 channelToByte(f32 value);
	u32 toRGBA8() const;
	u32 toARGB32() const;
	u32 toRGBA32() const;

	static Color white();
	static Color black();
	static Color red();
	static Color green();
	static Color blue();
	static Color transparent();
};

} // namespace bmsx
