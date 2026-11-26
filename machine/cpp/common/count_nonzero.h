#pragma once

#include <algorithm>
#include <cstdint>

#if defined(__ARM_NEON)
#include <arm_neon.h>
#endif

namespace bmsx {

inline std::uint32_t countNonzeroBytes(const std::uint8_t* bytes, std::uint32_t count) {
	std::uint32_t live = 0;
#if defined(__ARM_NEON)
	// Each true comparison subtracts 0xff, adding one in its byte lane.
	// Widen before a lane can wrap; never load past the supplied range.
	while (count >= 16u) {
		const auto vectors = std::min(count / 16u, 255u);
		auto lanes = vdupq_n_u8(0);
		for (std::uint32_t i = 0; i < vectors; ++i, bytes += 16)
			lanes = vsubq_u8(lanes, vcgtq_u8(vld1q_u8(bytes), vdupq_n_u8(0)));
		const auto pairs = vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(lanes)));
		live += static_cast<std::uint32_t>(vgetq_lane_u64(pairs, 0) + vgetq_lane_u64(pairs, 1));
		count -= vectors * 16u;
	}
#endif
	for (std::uint32_t i = 0; i < count; ++i) live += bytes[i] != 0;
	return live;
}

} // namespace bmsx
