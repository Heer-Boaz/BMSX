#pragma once

#include "render/backend/software/gx_gpu_span_color.h"

#if defined(__ARM_NEON)
#include <arm_neon.h>
#elif defined(__SSE2__)
#include <emmintrin.h>
#endif

#if defined(__ARM_NEON) || defined(__SSE2__)
namespace bmsx::gx_gpu_span_detail {

inline constexpr i32 SPAN_PIXELS = 8;

// Each dither matrix row repeated to twelve offsets, so every X phase reads
// eight consecutive ones.
struct DitherRows {
	alignas(16) i16 offsets[4][12];
};

inline constexpr DitherRows DITHER_ROWS = [] {
	DitherRows rows{};
	for (i32 y = 0; y < 4; y += 1) {
		for (i32 x = 0; x < 12; x += 1) {
			rows.offsets[y][x] = static_cast<i16>(gxGpuSoftwareDitherOffset(x, y));
		}
	}
	return rows;
}();

#if defined(__ARM_NEON)
using PixelLanes = uint16x8_t;
// Vertex color bytes for eight consecutive pixels.
template<bool InterpolatesColor>
struct ColorLanes {
	uint32x4_t low[3];
	uint32x4_t high[3];
	uint32x4_t advance[3];
	uint16x8_t flat[3];

	explicit ColorLanes(const GxGpuSoftwareColorSpan& span) {
		const u32 fixed[3] = {span.rFixed, span.gFixed, span.bFixed};
		const u32 step[3] = {span.rStep, span.gStep, span.bStep};
		if constexpr (InterpolatesColor) {
			alignas(16) static constexpr u32 laneIndex[4] = {0u, 1u, 2u, 3u};
			const uint32x4_t lanes = vld1q_u32(laneIndex);
			for (int channel = 0; channel < 3; channel += 1) {
				low[channel] = vmlaq_n_u32(vdupq_n_u32(fixed[channel]), lanes, step[channel]);
				high[channel] = vaddq_u32(low[channel], vdupq_n_u32(step[channel] * 4u));
				advance[channel] = vdupq_n_u32(step[channel] * static_cast<u32>(SPAN_PIXELS));
			}
		} else {
			for (int channel = 0; channel < 3; channel += 1) {
				flat[channel] = vdupq_n_u16(static_cast<u16>(colorByte(fixed[channel])));
			}
		}
	}

	// Wraps rather than clamps, exactly as the scalar byte extraction.
	uint16x8_t next(int channel) {
		if constexpr (InterpolatesColor) {
			const uint16x8_t bytes = vandq_u16(vcombine_u16(
				vmovn_u32(vshrq_n_u32(low[channel], GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS)),
				vmovn_u32(vshrq_n_u32(high[channel], GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS))), vdupq_n_u16(0xffu));
			low[channel] = vaddq_u32(low[channel], advance[channel]);
			high[channel] = vaddq_u32(high[channel], advance[channel]);
			return bytes;
		} else {
			return flat[channel];
		}
	}
};

// The dither offset has period four in X, so one vector serves a whole run.
inline int16x8_t ditherLanes(i32 x, i32 y) {
	return vld1q_s16(DITHER_ROWS.offsets[y & 3] + (x & 3));
}

// Untextured: dither clamps each byte to 0..255 before discarding three bits.
template<bool DitherEnabled>
inline uint16x8_t colorChannel5(uint16x8_t bytes, int16x8_t dither) {
	if constexpr (DitherEnabled) {
		return vmovl_u8(vshr_n_u8(vqmovun_s16(vaddq_s16(vreinterpretq_s16_u16(bytes), dither)), 3));
	} else {
		return vshrq_n_u16(bytes, 3);
	}
}

// Textured: (texel5 * vertex8) >> 4, plus dither, floored at zero, >> 3, at most 31.
template<bool DitherEnabled>
inline uint16x8_t modulatedChannel5(uint16x8_t texture5, uint16x8_t vertex8, int16x8_t dither) {
	int16x8_t value = vreinterpretq_s16_u16(vshrq_n_u16(vmulq_u16(texture5, vertex8), 4));
	if constexpr (DitherEnabled) {
		value = vmaxq_s16(vaddq_s16(value, dither), vdupq_n_s16(0));
	}
	return vminq_u16(vshrq_n_u16(vreinterpretq_u16_s16(value), 3), vdupq_n_u16(31u));
}

template<u32 BlendMode>
inline uint16x8_t blendChannel(uint16x8_t source5, uint16x8_t destination5) {
	if constexpr (BlendMode == 0u) {
		return vhaddq_u16(destination5, source5);
	} else if constexpr (BlendMode == 1u) {
		return vminq_u16(vaddq_u16(destination5, source5), vdupq_n_u16(31u));
	} else if constexpr (BlendMode == 2u) {
		return vqsubq_u16(destination5, source5);
	} else {
		return vminq_u16(vaddq_u16(destination5, vshrq_n_u16(source5, 2)), vdupq_n_u16(31u));
	}
}

inline uint16x8_t channelOf(uint16x8_t word, int channel) {
	const uint16x8_t mask = vdupq_n_u16(0x1fu);
	return channel == 0 ? vandq_u16(word, mask)
		: channel == 1 ? vandq_u16(vshrq_n_u16(word, 5), mask)
		: vandq_u16(vshrq_n_u16(word, 10), mask);
}

inline uint16x8_t packChannels(uint16x8_t r5, uint16x8_t g5, uint16x8_t b5) {
	return vorrq_u16(vorrq_u16(r5, vshlq_n_u16(g5, 5)), vshlq_n_u16(b5, 10));
}

#else
using PixelLanes = __m128i;
// SSE2 supplies eight 16-bit colour lanes. Interpolation stays in 32-bit
// lanes until byte extraction so the fixed accumulators wrap before packing.
template<bool InterpolatesColor>
struct ColorLanes {
	__m128i low[3], high[3], advance[3], flat[3];
	explicit ColorLanes(const GxGpuSoftwareColorSpan& span) {
		const u32 fixed[] = {span.rFixed, span.gFixed, span.bFixed};
		const u32 step[] = {span.rStep, span.gStep, span.bStep};
		for (int c = 0; c < 3; ++c) {
			if constexpr (InterpolatesColor) {
				low[c] = _mm_setr_epi32(fixed[c], fixed[c] + step[c], fixed[c] + 2u * step[c], fixed[c] + 3u * step[c]);
				high[c] = _mm_add_epi32(low[c], _mm_set1_epi32(4u * step[c]));
				advance[c] = _mm_set1_epi32(8u * step[c]);
			} else flat[c] = _mm_set1_epi16(colorByte(fixed[c]));
		}
	}

	__m128i next(int c) {
		if constexpr (!InterpolatesColor) return flat[c];
		const auto mask = _mm_set1_epi32(255);
		const auto l = _mm_and_si128(_mm_srli_epi32(low[c], GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS), mask);
		const auto h = _mm_and_si128(_mm_srli_epi32(high[c], GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS), mask);
		low[c] = _mm_add_epi32(low[c], advance[c]);
		high[c] = _mm_add_epi32(high[c], advance[c]);
		return _mm_packs_epi32(l, h);
	}
};

inline __m128i ditherLanes(i32 x, i32 y) {
	return _mm_loadu_si128(reinterpret_cast<const __m128i*>(DITHER_ROWS.offsets[y & 3] + (x & 3)));
}

template<bool DitherEnabled>
inline __m128i colorChannel5(__m128i bytes, __m128i dither) {
	if constexpr (DitherEnabled) bytes = _mm_min_epi16(_mm_max_epi16(_mm_add_epi16(bytes, dither), _mm_setzero_si128()), _mm_set1_epi16(255));
	return _mm_srli_epi16(bytes, 3);
}

template<bool DitherEnabled>
inline __m128i modulatedChannel5(__m128i texel, __m128i vertex, __m128i dither) {
	auto product = _mm_srli_epi16(_mm_mullo_epi16(texel, vertex), 4);
	if constexpr (DitherEnabled) product = _mm_max_epi16(_mm_add_epi16(product, dither), _mm_setzero_si128());
	return _mm_min_epi16(_mm_srli_epi16(product, 3), _mm_set1_epi16(31));
}

template<u32 Mode>
inline __m128i blendChannel(__m128i s, __m128i d) {
	if constexpr (Mode == 0) return _mm_srli_epi16(_mm_add_epi16(s, d), 1);
	if constexpr (Mode == 2) return _mm_subs_epu16(d, s);
	if constexpr (Mode == 3) s = _mm_srli_epi16(s, 2);
	return _mm_min_epi16(_mm_add_epi16(d, s), _mm_set1_epi16(31));
}

inline __m128i channelOf(__m128i word, int channel) {
	return _mm_and_si128(channel == 0 ? word : channel == 1 ? _mm_srli_epi16(word, 5) : _mm_srli_epi16(word, 10), _mm_set1_epi16(31));
}

inline __m128i packChannels(__m128i r, __m128i g, __m128i b) {
	return _mm_or_si128(r, _mm_or_si128(_mm_slli_epi16(g, 5), _mm_slli_epi16(b, 10)));
}
#endif

inline void storeColorLanes(u16* target, PixelLanes output, PixelLanes destination, bool checkMaskBit, bool setMaskBit) {
#if defined(__ARM_NEON)
	if (setMaskBit) output = vorrq_u16(output, vdupq_n_u16(0x8000u));
	if (checkMaskBit) output = vbslq_u16(vtstq_u16(destination, vdupq_n_u16(0x8000u)), destination, output);
	vst1q_u16(target, output);
#else
	if (setMaskBit) output = _mm_or_si128(output, _mm_set1_epi16(-32768));
	if (checkMaskBit) {
		const auto keep = _mm_srai_epi16(destination, 15);
		output = _mm_or_si128(_mm_and_si128(keep, destination), _mm_andnot_si128(keep, output));
	}
	_mm_storeu_si128(reinterpret_cast<__m128i*>(target), output);
#endif
}

inline void storeTexturedLanes(u16* target, PixelLanes sample, PixelLanes color, PixelLanes destination, bool checkMaskBit, bool setMaskBit) {
#if defined(__ARM_NEON)
	const auto output = vorrq_u16(color, setMaskBit ? vdupq_n_u16(0x8000) : vandq_u16(sample, vdupq_n_u16(0x8000)));
	auto keep = vceqq_u16(sample, vdupq_n_u16(0));
	if (checkMaskBit) keep = vorrq_u16(keep, vtstq_u16(destination, vdupq_n_u16(0x8000)));
	vst1q_u16(target, vbslq_u16(keep, destination, output));
#else
	const auto mask = _mm_set1_epi16(-32768);
	const auto output = _mm_or_si128(color, setMaskBit ? mask : _mm_and_si128(sample, mask));
	auto keep = _mm_cmpeq_epi16(sample, _mm_setzero_si128());
	if (checkMaskBit) keep = _mm_or_si128(keep, _mm_srai_epi16(destination, 15));
	_mm_storeu_si128(reinterpret_cast<__m128i*>(target),
		_mm_or_si128(_mm_and_si128(keep, destination), _mm_andnot_si128(keep, output)));
#endif
}

} // namespace bmsx::gx_gpu_span_detail
#endif
