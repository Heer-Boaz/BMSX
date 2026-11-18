#include "render/backend/gx_gpu_dirty_regions.h"
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;
using DirtyRect = std::array<i32, 4>;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int main() {
	GxGpuDirtyRegions dirty;
	std::vector<DirtyRect> copies;
	const auto record = [&](i32 left, i32 top, i32 right, i32 bottom) { copies.push_back({left, top, right, bottom}); };
	dirty.mark(0, 0, 320, 240);
	dirty.mark(640, 512, 768, 768);
	require(!dirty.consume(384, 256, 512, 384, record), "clean space between writes needs no copy");
	dirty.consume(0, 0, 320, 240, record);
	require(copies == std::vector<DirtyRect>{{0, 0, 320, 240}}, "contiguous dirty cells coalesce to one copy");
	copies.clear();
	dirty.consume(0, 0, 1024, 1024, record);
	require(copies == std::vector<DirtyRect>{{640, 512, 768, 768}}, "an unrelated atlas remains dirty after a framebuffer read");
	require(!dirty.consume(0, 0, 1024, 1024, record), "consumed cells no longer require copying");

	dirty.mark(0, 0, 1024, 1024);
	copies.clear();
	dirty.consume(511, 511, 513, 513, record);
	require(copies == std::vector<DirtyRect>{{496, 496, 528, 528}}, "a partial read crosses both bitmap words");
	dirty.mark(512, 512, 513, 513);
	copies.clear();
	dirty.consume(511, 511, 513, 513, record);
	require(copies == std::vector<DirtyRect>{{512, 512, 528, 528}}, "a later write re-dirties only its cell");
	dirty.clear();
	require(!dirty.consume(0, 0, 1024, 1024, record), "replacement clears all retained dirty state");
	dirty.mark(0, 0, 1024, 1024);
	copies.clear();
	dirty.consume(0, 0, 1024, 1024, record);
	require(copies == std::vector<DirtyRect>{{0, 0, 1024, 1024}}, "a full surface is one copy, not one copy per cell");
	for (const u32 yGate : {0u, 1u}) for (const u32 rowMask : {511u, 1023u}) {
		const u32 lastRow = gxGpuVramYAddressMask(yGate) & rowMask;
		dirty.markLogical(1023u, 1023u, 3u, 2u, yGate, rowMask);
		copies.clear();
		dirty.consume(0, 0, 1024, 1024, record);
		require(copies == std::vector<DirtyRect>{{0, 0, 16, 16}, {1008, 0, 1024, 16},
			{0, static_cast<i32>(lastRow & ~15u), 16, static_cast<i32>(lastRow + 1u)},
			{1008, static_cast<i32>(lastRow & ~15u), 1024, static_cast<i32>(lastRow + 1u)}},
			"logical demands wrap independently through X, the guest Y gate and physical rows");
	}

	std::array<u8, 64 * 64> expected{};
	u32 random = 0x31b872a9u;
	const auto next = [&] { random = random * 1664525u + 1013904223u; return random; };
	for (u32 operation = 0; operation < 3000; ++operation) {
		const u32 x0 = next() & 1023u, y0 = next() & 1023u;
		const u32 x1 = std::min(1024u, x0 + 1u + (next() & 255u));
		const u32 y1 = std::min(1024u, y0 + 1u + (next() & 255u));
		if (operation % 3u != 0u) {
			dirty.mark(x0, y0, x1, y1);
			for (u32 y = y0 >> 4u; y < (y1 + 15u) >> 4u; ++y)
				for (u32 x = x0 >> 4u; x < (x1 + 15u) >> 4u; ++x) expected[y * 64u + x] = 1u;
		} else {
			dirty.consume(x0, y0, x1, y1, [&](i32 left, i32 top, i32 right, i32 bottom) {
				require(left < static_cast<i32>(x1) && right > static_cast<i32>(x0)
					&& top < static_cast<i32>(y1) && bottom > static_cast<i32>(y0), "copies intersect the requested physical region");
				for (i32 y = top >> 4; y < bottom >> 4; ++y) for (i32 x = left >> 4; x < right >> 4; ++x) {
					require(expected[y * 64 + x] != 0, "coalesced copies do not swallow clean cells");
					expected[y * 64 + x] = 0u;
				}
			});
			for (u32 y = y0 >> 4u; y < (y1 + 15u) >> 4u; ++y)
				for (u32 x = x0 >> 4u; x < (x1 + 15u) >> 4u; ++x)
					require(expected[y * 64u + x] == 0u, "all requested dirty cells are consumed");
		}
	}
	std::cout << "GX dirty-region tests passed\n";
}
