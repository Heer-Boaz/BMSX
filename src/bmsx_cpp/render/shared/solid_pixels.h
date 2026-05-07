/*
 * solid_pixels.h - helpers for generated solid-color pixel buffers
 */

#ifndef BMSX_RENDER_SHARED_SOLID_PIXELS_H
#define BMSX_RENDER_SHARED_SOLID_PIXELS_H

#include "common/primitives.h"
#include <vector>

namespace bmsx {

inline void writeSolidRgba8Pixels(u8* pixels, size_t byteCount, u32 argb) {
	const u8 r = static_cast<u8>((argb >> 16u) & 0xffu);
	const u8 g = static_cast<u8>((argb >> 8u) & 0xffu);
	const u8 b = static_cast<u8>(argb & 0xffu);
	const u8 a = static_cast<u8>((argb >> 24u) & 0xffu);
	for (size_t i = 0; i < byteCount; i += 4) {
		pixels[i + 0] = r;
		pixels[i + 1] = g;
		pixels[i + 2] = b;
		pixels[i + 3] = a;
	}
}

inline std::vector<u8> createSolidRgba8Pixels(i32 width, i32 height, u32 argb) {
	std::vector<u8> pixels(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
	writeSolidRgba8Pixels(pixels.data(), pixels.size(), argb);
	return pixels;
}

} // namespace bmsx

#endif // BMSX_RENDER_SHARED_SOLID_PIXELS_H
