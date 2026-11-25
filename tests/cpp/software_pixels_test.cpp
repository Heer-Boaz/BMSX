#include "render/shared/software_pixels.h"

#include <array>
#include <stdexcept>

using namespace bmsx;

int main() {
	constexpr i32 rows = 5, stride = 19;
	std::array<u32, rows * stride> source, expected, pixels;
	for (size_t i = 0; i < source.size(); ++i) source[i] = 0x41668517u * static_cast<u32>(i);
	for (i32 width = 1; width <= stride; ++width) {
		for (const i32 left : {-2, 0, 3}) {
			for (const i32 clip : {0, 1, 4}) {
				expected.fill(0x12345678u);
				pixels = expected;
				blitOpaquePixels(source.data(), width, rows, pixels.data(), stride,
					left, 0, left + width, rows, clip, 1, stride, rows);
				for (i32 y = 1; y < rows; ++y)
					for (i32 x = clip; x < stride; ++x)
						if (x >= left && x < left + width)
							expected[y * stride + x] = source[y * width + x - left] | 0xff000000u;
				if (pixels != expected) throw std::runtime_error("opaque copy changed the source mapping, alpha, or clipped row padding");
			}
		}
	}
}
