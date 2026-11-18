#include "render/post/crt/noise.h"
#include "common/hash.h"
#include <vector>

namespace bmsx::CRTPipeline {
std::span<const u8> noiseTextureBytes() {
	static const auto bytes = [] {
		std::vector<u8> result(NOISE_WIDTH * NOISE_HEIGHT * 4u);
		for (u32 y = 0u; y < NOISE_HEIGHT; ++y) {
			const u8 line = static_cast<u8>(fmix32(y ^ 0x63d83595u) >> 24u);
			for (u32 x = 0u; x < NOISE_WIDTH; ++x) {
				const u32 pixel = y * NOISE_WIDTH + x;
				result[pixel * 4u] = static_cast<u8>(fmix32(pixel ^ 0xa511e9b3u) >> 24u);
				result[pixel * 4u + 1u] = line;
				result[pixel * 4u + 2u] = 0u;
				result[pixel * 4u + 3u] = 255u;
			}
		}
		return result;
	}();
	return bytes;
}
}
