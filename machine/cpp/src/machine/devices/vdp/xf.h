#pragma once

#include "common/primitives.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_XF_PACKET_KIND = 0x13000000u;
constexpr u32 VDP_XF_MATRIX_WORDS = 16u;
constexpr u32 VDP_XF_MATRIX_COUNT = 8u;
constexpr u32 VDP_XF_MATRIX_REGISTER_WORDS = VDP_XF_MATRIX_WORDS * VDP_XF_MATRIX_COUNT;
constexpr u32 VDP_XF_VIEW_MATRIX_INDEX_REGISTER = VDP_XF_MATRIX_REGISTER_WORDS;
constexpr u32 VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER = VDP_XF_VIEW_MATRIX_INDEX_REGISTER + 1u;
constexpr u32 VDP_XF_REGISTER_WORDS = VDP_XF_PROJECTION_MATRIX_INDEX_REGISTER + 1u;
constexpr u32 VDP_XF_VIEW_MATRIX_RESET_INDEX = 0u;
constexpr u32 VDP_XF_PROJECTION_MATRIX_RESET_INDEX = 1u;
constexpr u32 VDP_XF_MATRIX_PACKET_PAYLOAD_WORDS = 1u + VDP_XF_MATRIX_WORDS;
constexpr u32 VDP_XF_SELECT_PACKET_PAYLOAD_WORDS = 3u;

struct VdpXfState {
	std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS> matrixWords{};
	u32 viewMatrixIndex = VDP_XF_VIEW_MATRIX_RESET_INDEX;
	u32 projectionMatrixIndex = VDP_XF_PROJECTION_MATRIX_RESET_INDEX;
};

class VdpXfUnit {
public:
	std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS> matrixWords{};
	u32 viewMatrixIndex = VDP_XF_VIEW_MATRIX_RESET_INDEX;
	u32 projectionMatrixIndex = VDP_XF_PROJECTION_MATRIX_RESET_INDEX;

	VdpXfUnit();
	void reset();
	bool writeRegister(u32 registerIndex, u32 word);
	VdpXfState captureState() const;
	void restoreState(const VdpXfState& state);
};

} // namespace bmsx
