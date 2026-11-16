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

// One horizontal run of render pixels on row y, starting at x. Vertex colors
// are (fixed >> fraction bits) & 0xff, with fixed advancing by its step per
// pixel when interpolated. Flat spans pass their RGB bytes shifted by the
// fraction bits and ignore the steps.
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

inline u32 colorByte(u32 fixed) {
	return (fixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu;
}

template<bool InterpolatesColor>
inline void advanceColors(GxGpuSoftwareColorSpan& span, u32 pixels) {
	if constexpr (InterpolatesColor) {
		span.rFixed += span.rStep * pixels;
		span.gFixed += span.gStep * pixels;
		span.bFixed += span.bStep * pixels;
	}
}

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline void writeColorScalar(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan& span) {
	for (i32 end = x + count; x < end; x += 1) {
		gxGpuSoftwareWriteRenderVramPixel(software, x, y,
			colorByte(span.rFixed), colorByte(span.gFixed), colorByte(span.bFixed),
			DitherEnabled, BlendEnabled, span.blendMode, span.checkMaskBit, span.setMaskBit);
		advanceColors<InterpolatesColor>(span, 1u);
	}
}

template<bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled, typename Sampler>
inline void writeTexturedScalar(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan& span, Sampler& sampler) {
	for (i32 end = x + count; x < end; x += 1) {
		gxGpuSoftwareWriteTexturedVramPixel<RawTextureEnabled, SemiTransparencyEnabled>(software, x, y,
			colorByte(span.rFixed), colorByte(span.gFixed), colorByte(span.bFixed), sampler(),
			DitherEnabled, span.blendMode, span.checkMaskBit, span.setMaskBit);
		advanceColors<InterpolatesColor>(span, 1u);
	}
}

#if defined(__ARM_NEON)

inline constexpr i32 NEON_SPAN_PIXELS = 8;

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
				advance[channel] = vdupq_n_u32(step[channel] * static_cast<u32>(NEON_SPAN_PIXELS));
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
	alignas(16) i16 offsets[NEON_SPAN_PIXELS];
	for (i32 lane = 0; lane < NEON_SPAN_PIXELS; lane += 1) {
		offsets[lane] = static_cast<i16>(gxGpuSoftwareDitherOffset(x + lane, y));
	}
	return vld1q_s16(offsets);
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

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled, u32 BlendMode>
inline void writeColorVectors(GxGpuSoftwareState& software, i32 x, i32 y, i32 vectorPixels, GxGpuSoftwareColorSpan& span) {
	u16* target = software.vram.data() + gxGpuSoftwareVramIndex(software, x, y);
	const int16x8_t dither = DitherEnabled ? ditherLanes(x, y) : vdupq_n_s16(0);
	ColorLanes<InterpolatesColor> colors(span);
	const uint16x8_t outputMaskBit = vdupq_n_u16(span.setMaskBit ? 0x8000u : 0u);
	const uint16x8_t maskBit = vdupq_n_u16(0x8000u);
	const bool readsDestination = BlendEnabled || span.checkMaskBit;
	for (i32 done = 0; done < vectorPixels; done += NEON_SPAN_PIXELS) {
		uint16x8_t r5 = colorChannel5<DitherEnabled>(colors.next(0), dither);
		uint16x8_t g5 = colorChannel5<DitherEnabled>(colors.next(1), dither);
		uint16x8_t b5 = colorChannel5<DitherEnabled>(colors.next(2), dither);
		uint16x8_t destination = vdupq_n_u16(0);
		if (readsDestination) {
			destination = vld1q_u16(target + done);
		}
		if constexpr (BlendEnabled) {
			r5 = blendChannel<BlendMode>(r5, channelOf(destination, 0));
			g5 = blendChannel<BlendMode>(g5, channelOf(destination, 1));
			b5 = blendChannel<BlendMode>(b5, channelOf(destination, 2));
		}
		uint16x8_t output = vorrq_u16(packChannels(r5, g5, b5), outputMaskBit);
		if (span.checkMaskBit) {
			output = vbslq_u16(vtstq_u16(destination, maskBit), destination, output);
		}
		vst1q_u16(target + done, output);
	}
	advanceColors<InterpolatesColor>(span, static_cast<u32>(vectorPixels));
}

// Texels come from the caller's sampler, eight per vector: its fetch8() when it
// has one, otherwise eight exact scalar fetches. Everything after runs per lane.
template<bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled, u32 BlendMode, typename Sampler>
inline void writeTexturedVectors(GxGpuSoftwareState& software, i32 x, i32 y, i32 vectorPixels, GxGpuSoftwareColorSpan& span, Sampler& sampler) {
	u16* target = software.vram.data() + gxGpuSoftwareVramIndex(software, x, y);
	const int16x8_t dither = DitherEnabled ? ditherLanes(x, y) : vdupq_n_s16(0);
	ColorLanes<InterpolatesColor> colors(span);
	const uint16x8_t zero = vdupq_n_u16(0);
	const uint16x8_t maskBit = vdupq_n_u16(0x8000u);
	const uint16x8_t forcedMaskBit = vdupq_n_u16(span.setMaskBit ? 0x8000u : 0u);
	const uint16x8_t checkMask = vdupq_n_u16(span.checkMaskBit ? 0x8000u : 0u);
	alignas(16) u16 samples[NEON_SPAN_PIXELS];
	for (i32 done = 0; done < vectorPixels; done += NEON_SPAN_PIXELS) {
		uint16x8_t sample;
		if constexpr (requires { sampler.fetch8(); }) {
			sample = sampler.fetch8();
		} else {
			for (i32 lane = 0; lane < NEON_SPAN_PIXELS; lane += 1) {
				samples[lane] = static_cast<u16>(sampler());
			}
			sample = vld1q_u16(samples);
		}
		uint16x8_t r5 = channelOf(sample, 0);
		uint16x8_t g5 = channelOf(sample, 1);
		uint16x8_t b5 = channelOf(sample, 2);
		if constexpr (!RawTextureEnabled) {
			r5 = modulatedChannel5<DitherEnabled>(r5, colors.next(0), dither);
			g5 = modulatedChannel5<DitherEnabled>(g5, colors.next(1), dither);
			b5 = modulatedChannel5<DitherEnabled>(b5, colors.next(2), dither);
		}
		const uint16x8_t destination = vld1q_u16(target + done);
		const uint16x8_t sampleMaskBit = vandq_u16(sample, maskBit);
		uint16x8_t color = packChannels(r5, g5, b5);
		if constexpr (SemiTransparencyEnabled) {
			const uint16x8_t blended = packChannels(
				blendChannel<BlendMode>(r5, channelOf(destination, 0)),
				blendChannel<BlendMode>(g5, channelOf(destination, 1)),
				blendChannel<BlendMode>(b5, channelOf(destination, 2)));
			color = vbslq_u16(vtstq_u16(sample, maskBit), blended, color);
		}
		const uint16x8_t output = vorrq_u16(color, vorrq_u16(forcedMaskBit, sampleMaskBit));
		// A zero texel writes nothing; neither does a protected destination.
		const uint16x8_t keep = vorrq_u16(vceqq_u16(sample, zero), vtstq_u16(destination, checkMask));
		vst1q_u16(target + done, vbslq_u16(keep, destination, output));
	}
	advanceColors<InterpolatesColor>(span, static_cast<u32>(vectorPixels));
}

template<typename Write>
inline void dispatchBlendMode(u32 blendMode, Write&& write) {
	switch (blendMode) {
		case 0u: write.template operator()<0u>(); return;
		case 1u: write.template operator()<1u>(); return;
		case 2u: write.template operator()<2u>(); return;
		default: write.template operator()<3u>(); return;
	}
}

// VRAM rows are contiguous until the X address wraps.
template<typename Run>
inline void forEachContiguousRun(i32 x, i32 count, Run&& run) {
	while (count > 0) {
		const i32 rowRemaining = static_cast<i32>(GX_GPU_VRAM_X_ADDRESS_PERIOD - (static_cast<u32>(x) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u)));
		const i32 length = count < rowRemaining ? count : rowRemaining;
		run(x, length, length & ~(NEON_SPAN_PIXELS - 1));
		x += length;
		count -= length;
	}
}

#endif

} // namespace gx_gpu_span_detail

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline void gxGpuSoftwareWriteColorSpan(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan span) {
	using namespace gx_gpu_span_detail;
#if defined(__ARM_NEON)
	forEachContiguousRun(x, count, [&](i32 runX, i32 length, i32 vectorPixels) {
		if (vectorPixels != 0) {
			if constexpr (BlendEnabled) {
				dispatchBlendMode(span.blendMode, [&]<u32 BlendMode>() {
					writeColorVectors<InterpolatesColor, DitherEnabled, true, BlendMode>(software, runX, y, vectorPixels, span);
				});
			} else {
				writeColorVectors<InterpolatesColor, DitherEnabled, false, 0u>(software, runX, y, vectorPixels, span);
			}
		}
		writeColorScalar<InterpolatesColor, DitherEnabled, BlendEnabled>(software, runX + vectorPixels, y, length - vectorPixels, span);
	});
#else
	writeColorScalar<InterpolatesColor, DitherEnabled, BlendEnabled>(software, x, y, count, span);
#endif
}

// sampler() returns the next pixel's fetched texture word, in pixel order.
template<bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled, typename Sampler>
inline void gxGpuSoftwareWriteTexturedSpan(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan span, Sampler& sampler) {
	using namespace gx_gpu_span_detail;
#if defined(__ARM_NEON)
	forEachContiguousRun(x, count, [&](i32 runX, i32 length, i32 vectorPixels) {
		if (vectorPixels != 0) {
			if constexpr (SemiTransparencyEnabled) {
				dispatchBlendMode(span.blendMode, [&]<u32 BlendMode>() {
					writeTexturedVectors<RawTextureEnabled, true, InterpolatesColor, DitherEnabled, BlendMode>(
						software, runX, y, vectorPixels, span, sampler);
				});
			} else {
				writeTexturedVectors<RawTextureEnabled, false, InterpolatesColor, DitherEnabled, 0u>(
					software, runX, y, vectorPixels, span, sampler);
			}
		}
		writeTexturedScalar<RawTextureEnabled, SemiTransparencyEnabled, InterpolatesColor, DitherEnabled>(
			software, runX + vectorPixels, y, length - vectorPixels, span, sampler);
	});
#else
	writeTexturedScalar<RawTextureEnabled, SemiTransparencyEnabled, InterpolatesColor, DitherEnabled>(software, x, y, count, span, sampler);
#endif
}

} // namespace bmsx
