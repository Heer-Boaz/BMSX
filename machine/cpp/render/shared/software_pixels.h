#pragma once

#include "common/primitives.h"
#include <algorithm>

namespace bmsx {

// Opaque nearest sampling at pixel centres. Clipping never changes the source mapping.
inline void blitOpaquePixels(const u32* source, i32 sourceWidth, i32 sourceHeight,
	u32* target, i32 targetStride, i32 left, i32 top, i32 right, i32 bottom,
	i32 clipLeft, i32 clipTop, i32 clipRight, i32 clipBottom) {
	const i32 startX = std::max(left, clipLeft), startY = std::max(top, clipTop);
	const i32 endX = std::min(right, clipRight), endY = std::min(bottom, clipBottom);
	if (startX >= endX || startY >= endY) return;
	const u32 sourceStepX = (static_cast<u32>(sourceWidth) << 16u) / static_cast<u32>(right - left);
	const u32 sourceStepY = (static_cast<u32>(sourceHeight) << 16u) / static_cast<u32>(bottom - top);
	u32 sourceY = (sourceStepY >> 1u) + static_cast<u32>(startY - top) * sourceStepY;
	for (i32 y = startY; y < endY; y += 1) {
		const u32 sourceRow = (sourceY >> 16u) * static_cast<u32>(sourceWidth);
		i32 offset = y * targetStride + startX;
		u32 sourceX = (sourceStepX >> 1u) + static_cast<u32>(startX - left) * sourceStepX;
		for (i32 x = startX; x < endX; x += 1) {
			target[offset] = source[sourceRow + (sourceX >> 16u)] | 0xff000000u;
			offset += 1;
			sourceX += sourceStepX;
		}
		sourceY += sourceStepY;
	}
}

inline u32 packSoftwareArgb(u8 r, u8 g, u8 b, u8 a) {
	return (static_cast<u32>(a) << 24u)
		| (static_cast<u32>(r) << 16u)
		| (static_cast<u32>(g) << 8u)
		| static_cast<u32>(b);
}

struct SoftwareColorBytes {
	u8 r = 0u;
	u8 g = 0u;
	u8 b = 0u;
	u8 a = 0u;
};

inline u8 modulateSoftwareChannel(u8 source, u8 tint) {
	return static_cast<u8>((static_cast<u32>(source) * tint + 127u) / 255u);
}

inline void blendSoftwareArgb(u32& target, u8 r, u8 g, u8 b, u8 a) {
	if (a == 0u) {
		return;
	}
	if (a == 255u) {
		target = packSoftwareArgb(r, g, b, 255u);
		return;
	}
	const u32 invA = 255u - static_cast<u32>(a);
	const u32 dr = (target >> 16u) & 0xffu;
	const u32 dg = (target >> 8u) & 0xffu;
	const u32 db = target & 0xffu;
	const u32 da = (target >> 24u) & 0xffu;
	const u32 outR = (static_cast<u32>(r) * a + dr * invA + 127u) / 255u;
	const u32 outG = (static_cast<u32>(g) * a + dg * invA + 127u) / 255u;
	const u32 outB = (static_cast<u32>(b) * a + db * invA + 127u) / 255u;
	const u32 outA = static_cast<u32>(a) + (da * invA + 127u) / 255u;
	target = (outA << 24u) | (outR << 16u) | (outG << 8u) | outB;
}

inline void blendTintedSoftwarePixel(u32& target, const u8* sourcePixel, const SoftwareColorBytes& tint) {
	const u8 a = modulateSoftwareChannel(sourcePixel[3], tint.a);
	if (a == 0u) {
		return;
	}
	const u8 r = modulateSoftwareChannel(sourcePixel[0], tint.r);
	const u8 g = modulateSoftwareChannel(sourcePixel[1], tint.g);
	const u8 b = modulateSoftwareChannel(sourcePixel[2], tint.b);
	blendSoftwareArgb(
		target,
		r,
		g,
		b,
		a
	);
}

} // namespace bmsx
