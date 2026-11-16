#pragma once

#include "common/primitives.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "spec/gx/vram.h"

#if defined(__ARM_NEON)
#include <arm_neon.h>
#endif

namespace bmsx {

// One horizontal run of untextured render pixels on row y, starting at x.
// Each pixel is exactly gxGpuSoftwareWriteRenderVramPixel at (x+i, y), with
// interpolated colors taken from (fixed >> fraction bits) & 0xff and fixed
// advancing by its step per pixel. Flat spans pass their RGB bytes as fixed
// values shifted by the fraction bits and ignore the steps.
struct GxGpuSoftwareColorSpan {
	u32 rFixed;
	u32 gFixed;
	u32 bFixed;
	u32 rStep;
	u32 gStep;
	u32 bStep;
	u32 blendMode;
	bool checkMaskBit;
	bool setMaskBit;
};

namespace gx_gpu_span_detail {

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline void writeScalar(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan& span) {
	for (i32 end = x + count; x < end; x += 1) {
		gxGpuSoftwareWriteRenderVramPixel(software, x, y,
			(span.rFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu,
			(span.gFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu,
			(span.bFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu,
			DitherEnabled, BlendEnabled, span.blendMode, span.checkMaskBit, span.setMaskBit);
		if constexpr (InterpolatesColor) {
			span.rFixed += span.rStep;
			span.gFixed += span.gStep;
			span.bFixed += span.bStep;
		}
	}
}

#if defined(__ARM_NEON)

inline constexpr i32 NEON_SPAN_PIXELS = 8;

// Byte channel for eight pixels: (fixed >> fraction bits) & 0xff, wrapping
// rather than clamping, exactly as the scalar path.
inline uint16x8_t channelBytes(uint32x4_t low, uint32x4_t high) {
	const uint16x8_t shifted = vcombine_u16(
		vmovn_u32(vshrq_n_u32(low, GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS)),
		vmovn_u32(vshrq_n_u32(high, GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS)));
	return vandq_u16(shifted, vdupq_n_u16(0xffu));
}

// Dither clamps each byte to 0..255 before discarding three bits.
template<bool DitherEnabled>
inline uint16x8_t channel5(uint16x8_t bytes, int16x8_t dither) {
	if constexpr (DitherEnabled) {
		return vmovl_u8(vshr_n_u8(vqmovun_s16(vaddq_s16(vreinterpretq_s16_u16(bytes), dither)), 3));
	} else {
		return vshrq_n_u16(bytes, 3);
	}
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

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled, u32 BlendMode>
inline i32 writeVectors(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan& span) {
	const i32 vectorPixels = count & ~(NEON_SPAN_PIXELS - 1);
	if (vectorPixels == 0) {
		return 0;
	}
	u16* target = software.vram.data() + gxGpuSoftwareVramIndex(software, x, y);
	int16x8_t dither = vdupq_n_s16(0);
	if constexpr (DitherEnabled) {
		alignas(16) i16 offsets[NEON_SPAN_PIXELS];
		for (i32 lane = 0; lane < NEON_SPAN_PIXELS; lane += 1) {
			offsets[lane] = static_cast<i16>(gxGpuSoftwareDitherOffset(x + lane, y));
		}
		dither = vld1q_s16(offsets);
	}
	uint32x4_t rLow, rHigh, gLow, gHigh, bLow, bHigh, rAdvance, gAdvance, bAdvance;
	uint16x8_t rFlat, gFlat, bFlat;
	if constexpr (InterpolatesColor) {
		alignas(16) static constexpr u32 laneIndex[4] = {0u, 1u, 2u, 3u};
		const uint32x4_t lanes = vld1q_u32(laneIndex);
		rLow = vmlaq_n_u32(vdupq_n_u32(span.rFixed), lanes, span.rStep);
		gLow = vmlaq_n_u32(vdupq_n_u32(span.gFixed), lanes, span.gStep);
		bLow = vmlaq_n_u32(vdupq_n_u32(span.bFixed), lanes, span.bStep);
		rHigh = vaddq_u32(rLow, vdupq_n_u32(span.rStep * 4u));
		gHigh = vaddq_u32(gLow, vdupq_n_u32(span.gStep * 4u));
		bHigh = vaddq_u32(bLow, vdupq_n_u32(span.bStep * 4u));
		rAdvance = vdupq_n_u32(span.rStep * static_cast<u32>(NEON_SPAN_PIXELS));
		gAdvance = vdupq_n_u32(span.gStep * static_cast<u32>(NEON_SPAN_PIXELS));
		bAdvance = vdupq_n_u32(span.bStep * static_cast<u32>(NEON_SPAN_PIXELS));
	} else {
		rFlat = vdupq_n_u16(static_cast<u16>((span.rFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu));
		gFlat = vdupq_n_u16(static_cast<u16>((span.gFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu));
		bFlat = vdupq_n_u16(static_cast<u16>((span.bFixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu));
	}
	const uint16x8_t channelMask = vdupq_n_u16(0x1fu);
	const uint16x8_t outputMaskBit = vdupq_n_u16(span.setMaskBit ? 0x8000u : 0u);
	const uint16x8_t maskBit = vdupq_n_u16(0x8000u);
	const bool readsDestination = BlendEnabled || span.checkMaskBit;
	for (i32 done = 0; done < vectorPixels; done += NEON_SPAN_PIXELS) {
		uint16x8_t r8, g8, b8;
		if constexpr (InterpolatesColor) {
			r8 = channelBytes(rLow, rHigh);
			g8 = channelBytes(gLow, gHigh);
			b8 = channelBytes(bLow, bHigh);
			rLow = vaddq_u32(rLow, rAdvance);
			rHigh = vaddq_u32(rHigh, rAdvance);
			gLow = vaddq_u32(gLow, gAdvance);
			gHigh = vaddq_u32(gHigh, gAdvance);
			bLow = vaddq_u32(bLow, bAdvance);
			bHigh = vaddq_u32(bHigh, bAdvance);
		} else {
			r8 = rFlat;
			g8 = gFlat;
			b8 = bFlat;
		}
		uint16x8_t r5 = channel5<DitherEnabled>(r8, dither);
		uint16x8_t g5 = channel5<DitherEnabled>(g8, dither);
		uint16x8_t b5 = channel5<DitherEnabled>(b8, dither);
		uint16x8_t destination = vdupq_n_u16(0);
		if (readsDestination) {
			destination = vld1q_u16(target + done);
		}
		if constexpr (BlendEnabled) {
			r5 = blendChannel<BlendMode>(r5, vandq_u16(destination, channelMask));
			g5 = blendChannel<BlendMode>(g5, vandq_u16(vshrq_n_u16(destination, 5), channelMask));
			b5 = blendChannel<BlendMode>(b5, vandq_u16(vshrq_n_u16(destination, 10), channelMask));
		}
		uint16x8_t output = vorrq_u16(vorrq_u16(r5, vshlq_n_u16(g5, 5)), vorrq_u16(vshlq_n_u16(b5, 10), outputMaskBit));
		if (span.checkMaskBit) {
			output = vbslq_u16(vtstq_u16(destination, maskBit), destination, output);
		}
		vst1q_u16(target + done, output);
	}
	if constexpr (InterpolatesColor) {
		const u32 advanced = static_cast<u32>(vectorPixels);
		span.rFixed += span.rStep * advanced;
		span.gFixed += span.gStep * advanced;
		span.bFixed += span.bStep * advanced;
	}
	return vectorPixels;
}

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline i32 writeVectorsForMode(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan& span) {
	if constexpr (!BlendEnabled) {
		return writeVectors<InterpolatesColor, DitherEnabled, false, 0u>(software, x, y, count, span);
	} else {
		switch (span.blendMode) {
			case 0u: return writeVectors<InterpolatesColor, DitherEnabled, true, 0u>(software, x, y, count, span);
			case 1u: return writeVectors<InterpolatesColor, DitherEnabled, true, 1u>(software, x, y, count, span);
			case 2u: return writeVectors<InterpolatesColor, DitherEnabled, true, 2u>(software, x, y, count, span);
			default: return writeVectors<InterpolatesColor, DitherEnabled, true, 3u>(software, x, y, count, span);
		}
	}
}

#endif

} // namespace gx_gpu_span_detail

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline void gxGpuSoftwareWriteColorSpan(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan span) {
#if defined(__ARM_NEON)
	// VRAM rows are contiguous until the X address wraps.
	while (count > 0) {
		const i32 rowRemaining = static_cast<i32>(GX_GPU_VRAM_X_ADDRESS_PERIOD - (static_cast<u32>(x) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u)));
		const i32 run = count < rowRemaining ? count : rowRemaining;
		const i32 vectorPixels = gx_gpu_span_detail::writeVectorsForMode<InterpolatesColor, DitherEnabled, BlendEnabled>(
			software, x, y, run, span);
		gx_gpu_span_detail::writeScalar<InterpolatesColor, DitherEnabled, BlendEnabled>(
			software, x + vectorPixels, y, run - vectorPixels, span);
		x += run;
		count -= run;
	}
#else
	gx_gpu_span_detail::writeScalar<InterpolatesColor, DitherEnabled, BlendEnabled>(software, x, y, count, span);
#endif
}

} // namespace bmsx
