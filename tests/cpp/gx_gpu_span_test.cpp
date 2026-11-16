// The span writers must store exactly what one scalar pixel write per pixel
// stores. On NEON builds this compares the vector paths with those scalar
// oracles; elsewhere it covers run splitting, sampler order and accumulators.
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_span.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdio>
#include <stdexcept>
#include <string>

namespace {

using namespace bmsx;

struct Random {
	u32 state;
	u32 next() {
		state ^= state << 13u;
		state ^= state >> 17u;
		state ^= state << 5u;
		return state;
	}
};

void require(bool condition, const std::string& message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

u32 colorByte(u32 fixed) {
	return (fixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu;
}

template<bool InterpolatesColor>
void advance(GxGpuSoftwareColorSpan& span) {
	if constexpr (InterpolatesColor) {
		span.rFixed += span.rStep;
		span.gFixed += span.gStep;
		span.bFixed += span.bStep;
	}
}

constexpr i32 SPAN_STARTS[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 509, 1010, 1015, 1016, 1017, 1023, 1024, 2041};
constexpr i32 SPAN_ROWS[] = {0, 1, 2, 3, 6, 255, 511, 512, 515};
constexpr i32 MAX_SPAN = 41;

// Runs write(expected, ...) and write(actual, ...) over every start, row, length
// and mask mode, comparing the touched row each time and all VRAM at the end.
template<bool InterpolatesColor, typename Writes>
void compareAll(const char* name, u32 blendModes, GxGpuSoftwareState& expected, GxGpuSoftwareState& actual,
	Random& random, size_t& spans, Writes&& writes) {
	std::array<u16, MAX_SPAN> samples{};
	for (u32 blendMode = 0u; blendMode < blendModes; blendMode += 1u) {
		for (u32 maskMode = 0u; maskMode < 4u; maskMode += 1u) {
			for (const i32 x : SPAN_STARTS) {
				for (const i32 y : SPAN_ROWS) {
					for (i32 count = 1; count <= MAX_SPAN; count += 1) {
						// A span stays on its (masked) row; other rows must stay identical.
						const size_t rowStart = gxGpuSoftwareVramIndex(expected, 0, y);
						for (size_t index = rowStart; index < rowStart + 1024u; index += 1u) {
							const u16 word = static_cast<u16>(random.next());
							expected.vram[index] = word;
							actual.vram[index] = word;
						}
						// Texels: a quarter transparent zero words, bit 15 random otherwise.
						for (u16& sample : samples) {
							const u32 bits = random.next();
							sample = (bits & 3u) == 0u ? 0u : static_cast<u16>(bits >> 8u);
						}
						// Small steps keep interpolated bytes moving; large and negative
						// steps wrap the masked byte and the 32-bit accumulator.
						const u32 stepScale = (random.next() & 1u) != 0u ? 0x3ffu : 0xffffffffu;
						const GxGpuSoftwareColorSpan span = InterpolatesColor
							? GxGpuSoftwareColorSpan{random.next(), random.next(), random.next(),
								random.next() & stepScale, random.next() & stepScale, static_cast<u32>(-static_cast<i32>(random.next() & 0x7fffu)),
								blendMode, (maskMode & 1u) != 0u, (maskMode & 2u) != 0u}
							: GxGpuSoftwareColorSpan{(random.next() & 0xffu) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
								(random.next() & 0xffu) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
								(random.next() & 0xffu) << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
								0u, 0u, 0u, blendMode, (maskMode & 1u) != 0u, (maskMode & 2u) != 0u};
						writes(expected, actual, x, y, count, span, samples);
						if (!std::equal(expected.vram.begin() + static_cast<std::ptrdiff_t>(rowStart),
							expected.vram.begin() + static_cast<std::ptrdiff_t>(rowStart + 1024u),
							actual.vram.begin() + static_cast<std::ptrdiff_t>(rowStart))) {
							size_t index = rowStart;
							while (expected.vram[index] == actual.vram[index]) {
								index += 1u;
							}
							char message[256];
							std::snprintf(message, sizeof(message),
								"%s mismatch mode=%u mask=%u x=%d y=%d count=%d word=%zu expected=%04x actual=%04x",
								name, blendMode, maskMode, x, y, count, index, expected.vram[index], actual.vram[index]);
							throw std::runtime_error(message);
						}
						spans += 1u;
					}
				}
			}
		}
	}
	require(expected.vram == actual.vram, std::string(name) + " wrote outside its row");
}

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
void compareColorSpans(const char* name, GxGpuSoftwareState& expected, GxGpuSoftwareState& actual, Random& random, size_t& spans) {
	compareAll<InterpolatesColor>(name, BlendEnabled ? 4u : 1u, expected, actual, random, spans,
		[](GxGpuSoftwareState& reference, GxGpuSoftwareState& candidate, i32 x, i32 y, i32 count,
			GxGpuSoftwareColorSpan span, const std::array<u16, MAX_SPAN>&) {
			gxGpuSoftwareWriteColorSpan<InterpolatesColor, DitherEnabled, BlendEnabled>(candidate, x, y, count, span);
			for (i32 end = x + count; x < end; x += 1) {
				gxGpuSoftwareWriteRenderVramPixel(reference, x, y, colorByte(span.rFixed), colorByte(span.gFixed), colorByte(span.bFixed),
					DitherEnabled, BlendEnabled, span.blendMode, span.checkMaskBit, span.setMaskBit);
				advance<InterpolatesColor>(span);
			}
		});
}

template<bool RawTextureEnabled, bool SemiTransparencyEnabled, bool InterpolatesColor, bool DitherEnabled>
void compareTexturedSpans(const char* name, GxGpuSoftwareState& expected, GxGpuSoftwareState& actual, Random& random, size_t& spans) {
	compareAll<InterpolatesColor>(name, SemiTransparencyEnabled ? 4u : 1u, expected, actual, random, spans,
		[](GxGpuSoftwareState& reference, GxGpuSoftwareState& candidate, i32 x, i32 y, i32 count,
			GxGpuSoftwareColorSpan span, const std::array<u16, MAX_SPAN>& samples) {
			size_t fetched = 0u;
			auto sampler = [&]() { return static_cast<u32>(samples[fetched++]); };
			gxGpuSoftwareWriteTexturedSpan<RawTextureEnabled, SemiTransparencyEnabled, InterpolatesColor, DitherEnabled>(
				candidate, x, y, count, span, sampler);
			require(fetched == static_cast<size_t>(count), "textured span fetched a different texel count");
			for (i32 index = 0; index < count; index += 1) {
				gxGpuSoftwareWriteTexturedVramPixel<RawTextureEnabled, SemiTransparencyEnabled>(reference, x + index, y,
					colorByte(span.rFixed), colorByte(span.gFixed), colorByte(span.bFixed), samples[static_cast<size_t>(index)],
					DitherEnabled, span.blendMode, span.checkMaskBit, span.setMaskBit);
				advance<InterpolatesColor>(span);
			}
		});
}

} // namespace

int main() {
	// A small VRAM keeps the full-memory comparison cheap while still wrapping Y.
	constexpr size_t vramBytes = 1024u * 2u * 512u;
	GxGpuSoftwareState expected(vramBytes, 0u);
	GxGpuSoftwareState actual(vramBytes, 0u);
	require(expected.vram.size() == 1024u * 512u, "span test VRAM geometry drifted");
	Random random{0x9e3779b9u};
	size_t spans = 0u;
	compareColorSpans<false, false, false>("flat", expected, actual, random, spans);
	compareColorSpans<false, false, true>("flat blend", expected, actual, random, spans);
	compareColorSpans<false, true, false>("flat dither", expected, actual, random, spans);
	compareColorSpans<false, true, true>("flat dither blend", expected, actual, random, spans);
	compareColorSpans<true, false, false>("gouraud", expected, actual, random, spans);
	compareColorSpans<true, false, true>("gouraud blend", expected, actual, random, spans);
	compareColorSpans<true, true, false>("gouraud dither", expected, actual, random, spans);
	compareColorSpans<true, true, true>("gouraud dither blend", expected, actual, random, spans);
	// The rasterizer's textured combinations: raw texturing never interpolates or dithers.
	compareTexturedSpans<true, false, false, false>("raw texture", expected, actual, random, spans);
	compareTexturedSpans<true, true, false, false>("raw texture semi", expected, actual, random, spans);
	compareTexturedSpans<false, false, false, false>("modulated", expected, actual, random, spans);
	compareTexturedSpans<false, true, false, false>("modulated semi", expected, actual, random, spans);
	compareTexturedSpans<false, false, false, true>("modulated dither", expected, actual, random, spans);
	compareTexturedSpans<false, true, false, true>("modulated dither semi", expected, actual, random, spans);
	compareTexturedSpans<false, false, true, false>("modulated gouraud", expected, actual, random, spans);
	compareTexturedSpans<false, true, true, false>("modulated gouraud semi", expected, actual, random, spans);
	compareTexturedSpans<false, false, true, true>("modulated gouraud dither", expected, actual, random, spans);
	compareTexturedSpans<false, true, true, true>("modulated gouraud dither semi", expected, actual, random, spans);
#if defined(__ARM_NEON)
	std::printf("gx gpu span tests passed: %zu NEON spans match the scalar oracle\n", spans);
#else
	std::printf("gx gpu span tests passed: %zu scalar spans\n", spans);
#endif
	return 0;
}
