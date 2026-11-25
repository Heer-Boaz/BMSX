#pragma once

#include "common/primitives.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "spec/gx/vram.h"

#include "render/backend/software/gx_gpu_span_lanes.h"

namespace bmsx {

namespace gx_gpu_span_detail {

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

#if defined(__ARM_NEON) || defined(__SSE2__)

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled, u32 BlendMode>
inline void writeColorVectors(GxGpuSoftwareState& software, i32 x, i32 y, i32 vectorPixels, GxGpuSoftwareColorSpan& span) {
	u16* target = software.vram.data() + gxGpuSoftwareVramIndex(software, x, y);
	const auto dither = ditherLanes(x, y);
	ColorLanes<InterpolatesColor> colors(span);
	const bool readsDestination = BlendEnabled || span.checkMaskBit;
	for (i32 done = 0; done < vectorPixels; done += SPAN_PIXELS) {
		auto r5 = colorChannel5<DitherEnabled>(colors.next(0), dither);
		auto g5 = colorChannel5<DitherEnabled>(colors.next(1), dither);
		auto b5 = colorChannel5<DitherEnabled>(colors.next(2), dither);
#if defined(__ARM_NEON)
		const auto destination = readsDestination ? vld1q_u16(target + done) : vdupq_n_u16(0);
#else
		const auto destination = readsDestination ? _mm_loadu_si128(reinterpret_cast<const __m128i*>(target + done)) : _mm_setzero_si128();
#endif
		if constexpr (BlendEnabled) {
			r5 = blendChannel<BlendMode>(r5, channelOf(destination, 0));
			g5 = blendChannel<BlendMode>(g5, channelOf(destination, 1));
			b5 = blendChannel<BlendMode>(b5, channelOf(destination, 2));
		}
		auto output = packChannels(r5, g5, b5);
		storeColorLanes(target + done, output, destination, span.checkMaskBit, span.setMaskBit);
	}
	advanceColors<InterpolatesColor>(span, static_cast<u32>(vectorPixels));
}

// Texels come from the caller's sampler, eight per vector: its fetch8() when it
// has one, otherwise eight exact scalar fetches. Everything after runs per lane.
template<bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled, u32 BlendMode, typename Sampler>
inline void writeTexturedVectors(GxGpuSoftwareState& software, i32 x, i32 y, i32 vectorPixels, GxGpuSoftwareColorSpan& span, Sampler& sampler) {
	u16* target = software.vram.data() + gxGpuSoftwareVramIndex(software, x, y);
	const auto dither = ditherLanes(x, y);
	ColorLanes<InterpolatesColor> colors(span);
	alignas(16) u16 samples[SPAN_PIXELS];
	for (i32 done = 0; done < vectorPixels; done += SPAN_PIXELS) {
		PixelLanes sample;
		if constexpr (requires { sampler.fetch8(); }) {
			sample = sampler.fetch8();
		} else {
			for (i32 lane = 0; lane < SPAN_PIXELS; lane += 1) {
				samples[lane] = static_cast<u16>(sampler());
			}
#if defined(__ARM_NEON)
			sample = vld1q_u16(samples);
#else
			sample = _mm_load_si128(reinterpret_cast<const __m128i*>(samples));
#endif
		}
		auto r5 = channelOf(sample, 0);
		auto g5 = channelOf(sample, 1);
		auto b5 = channelOf(sample, 2);
		if constexpr (!RawTextureEnabled) {
			r5 = modulatedChannel5<DitherEnabled>(r5, colors.next(0), dither);
			g5 = modulatedChannel5<DitherEnabled>(g5, colors.next(1), dither);
			b5 = modulatedChannel5<DitherEnabled>(b5, colors.next(2), dither);
		}
#if defined(__ARM_NEON)
		const auto destination = vld1q_u16(target + done);
#else
		const auto destination = _mm_loadu_si128(reinterpret_cast<const __m128i*>(target + done));
#endif
		auto color = sample;
		if constexpr (!RawTextureEnabled || SemiTransparencyEnabled) color = packChannels(r5, g5, b5);
		if constexpr (SemiTransparencyEnabled) {
			const auto blended = packChannels(
				blendChannel<BlendMode>(r5, channelOf(destination, 0)),
				blendChannel<BlendMode>(g5, channelOf(destination, 1)),
				blendChannel<BlendMode>(b5, channelOf(destination, 2)));
#if defined(__ARM_NEON)
			color = vbslq_u16(vtstq_u16(sample, vdupq_n_u16(0x8000)), blended, color);
#else
			const auto semi = _mm_srai_epi16(sample, 15);
			color = _mm_or_si128(_mm_and_si128(semi, blended), _mm_andnot_si128(semi, color));
#endif
		}
		// Transparent texels and protected destinations retain their old word.
		storeTexturedLanes(target + done, sample, color, destination, span.checkMaskBit, span.setMaskBit);
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
		run(x, length, length & ~(SPAN_PIXELS - 1));
		x += length;
		count -= length;
	}
}

#endif

} // namespace gx_gpu_span_detail

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
inline void gxGpuSoftwareWriteColorSpan(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan span) {
	using namespace gx_gpu_span_detail;
#if defined(__ARM_NEON) || defined(__SSE2__)
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
#if defined(__ARM_NEON) || defined(__SSE2__)
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
