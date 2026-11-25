#include "render/shared/software_pixels.h"

#if defined(__ARM_NEON)
#include <arm_neon.h>
#elif defined(__SSE2__)
#include <emmintrin.h>
#endif

namespace bmsx {
namespace {

void copyOpaque(const u32* source, u32* target, size_t count) {
#if defined(__ARM_NEON) || defined(__SSE2__)
	constexpr size_t lanes = 4;
#if defined(__ARM_NEON)
	const auto alpha = vdupq_n_u32(0xff000000u);
#else
	const auto alpha = _mm_set1_epi32(-16777216);
#endif
	while (count >= lanes) {
#if defined(__ARM_NEON)
		vst1q_u32(target, vorrq_u32(vld1q_u32(source), alpha));
#else
		const auto pixels = _mm_loadu_si128(reinterpret_cast<const __m128i*>(source));
		_mm_storeu_si128(reinterpret_cast<__m128i*>(target), _mm_or_si128(pixels, alpha));
#endif
		source += lanes;
		target += lanes;
		count -= lanes;
	}
#endif
	while (count--) *target++ = *source++ | 0xff000000u;
}

} // namespace

// Opaque nearest sampling at pixel centres. Clipping never changes the source mapping.
void blitOpaquePixels(const u32* source, i32 sourceWidth, i32 sourceHeight,
	u32* target, i32 targetStride, i32 left, i32 top, i32 right, i32 bottom,
	i32 clipLeft, i32 clipTop, i32 clipRight, i32 clipBottom) {
	const i32 startX = std::max(left, clipLeft), startY = std::max(top, clipTop);
	const i32 endX = std::min(right, clipRight), endY = std::min(bottom, clipBottom);
	if (startX >= endX || startY >= endY) return;
	if (right - left == sourceWidth && bottom - top == sourceHeight) {
		const size_t width = endX - startX;
		const size_t height = endY - startY;
		source += static_cast<size_t>(startY - top) * sourceWidth + startX - left;
		target += static_cast<size_t>(startY) * targetStride + startX;
		if (width == static_cast<size_t>(sourceWidth) && width == static_cast<size_t>(targetStride)) {
			copyOpaque(source, target, width * height);
		} else {
			for (size_t y = 0; y < height; ++y)
				copyOpaque(source + y * sourceWidth, target + y * targetStride, width);
		}
		return;
	}
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

} // namespace bmsx
