#pragma once

#include "common/primitives.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_XF_PACKET_KIND = 0x13000000u;
constexpr u32 VDP_XF_MATRIX_WORDS = 16u;
constexpr u32 VDP_XF_PACKET_PAYLOAD_WORDS = VDP_XF_MATRIX_WORDS * 2u;

struct VdpXfState {
	std::array<u32, VDP_XF_MATRIX_WORDS> viewMatrixWords{};
	std::array<u32, VDP_XF_MATRIX_WORDS> projectionMatrixWords{};
};

class VdpXfUnit {
public:
	std::array<u32, VDP_XF_MATRIX_WORDS> viewMatrixWords{};
	std::array<u32, VDP_XF_MATRIX_WORDS> projectionMatrixWords{};

	VdpXfUnit();
	void reset();
	VdpXfState captureState() const;
	void restoreState(const VdpXfState& state);
};

} // namespace bmsx
