// The span writer must store exactly what one gxGpuSoftwareWriteRenderVramPixel
// call per pixel stores. On NEON builds this compares the vector path with that
// scalar oracle; elsewhere it covers span splitting and accumulator advance.
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_span.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <algorithm>
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

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
void writeReference(GxGpuSoftwareState& software, i32 x, i32 y, i32 count, GxGpuSoftwareColorSpan span) {
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

template<bool InterpolatesColor, bool DitherEnabled, bool BlendEnabled>
void compareSpans(GxGpuSoftwareState& expected, GxGpuSoftwareState& actual, Random& random, size_t& spans) {
	static constexpr i32 starts[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 509, 1010, 1015, 1016, 1017, 1023, 1024, 2041};
	static constexpr i32 rows[] = {0, 1, 2, 3, 6, 255, 511, 512, 515};
	for (u32 blendMode = 0u; blendMode < (BlendEnabled ? 4u : 1u); blendMode += 1u) {
		for (u32 maskMode = 0u; maskMode < 4u; maskMode += 1u) {
			for (const i32 x : starts) {
				for (const i32 y : rows) {
					for (i32 count = 1; count <= 41; count += 1) {
						// A span stays on its (masked) row; other rows must stay identical.
						const size_t rowStart = gxGpuSoftwareVramIndex(expected, 0, y);
						for (size_t index = rowStart; index < rowStart + 1024u; index += 1u) {
							const u16 word = static_cast<u16>(random.next());
							expected.vram[index] = word;
							actual.vram[index] = word;
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
						writeReference<InterpolatesColor, DitherEnabled, BlendEnabled>(expected, x, y, count, span);
						gxGpuSoftwareWriteColorSpan<InterpolatesColor, DitherEnabled, BlendEnabled>(actual, x, y, count, span);
						if (!std::equal(expected.vram.begin() + static_cast<std::ptrdiff_t>(rowStart),
							expected.vram.begin() + static_cast<std::ptrdiff_t>(rowStart + 1024u),
							actual.vram.begin() + static_cast<std::ptrdiff_t>(rowStart))) {
							size_t index = rowStart;
							while (expected.vram[index] == actual.vram[index]) {
								index += 1u;
							}
							char message[256];
							std::snprintf(message, sizeof(message),
								"span mismatch interp=%d dither=%d blend=%d mode=%u mask=%u x=%d y=%d count=%d word=%zu expected=%04x actual=%04x",
								InterpolatesColor, DitherEnabled, BlendEnabled, blendMode, maskMode, x, y, count, index,
								expected.vram[index], actual.vram[index]);
							throw std::runtime_error(message);
						}
						spans += 1u;
					}
				}
			}
		}
	}
	require(expected.vram == actual.vram, "span wrote outside its row");
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
	compareSpans<false, false, false>(expected, actual, random, spans);
	compareSpans<false, false, true>(expected, actual, random, spans);
	compareSpans<false, true, false>(expected, actual, random, spans);
	compareSpans<false, true, true>(expected, actual, random, spans);
	compareSpans<true, false, false>(expected, actual, random, spans);
	compareSpans<true, false, true>(expected, actual, random, spans);
	compareSpans<true, true, false>(expected, actual, random, spans);
	compareSpans<true, true, true>(expected, actual, random, spans);
#if defined(__ARM_NEON)
	std::printf("gx gpu span tests passed: %zu NEON spans match the scalar oracle\n", spans);
#else
	std::printf("gx gpu span tests passed: %zu scalar spans\n", spans);
#endif
	return 0;
}
