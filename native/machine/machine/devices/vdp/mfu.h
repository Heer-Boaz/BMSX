#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_MFU_PACKET_KIND = 0x14000000u;

class VdpMfuUnit {
public:
	std::array<u32, VDP_MFU_WEIGHT_COUNT> weightWords{};

	void reset();
};

} // namespace bmsx
