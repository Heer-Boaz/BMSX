#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

constexpr u32 VDP_JTU_PACKET_KIND = 0x15000000u;

class VdpJtuUnit {
public:
	std::array<u32, VDP_JTU_REGISTER_WORDS> matrixWords{};

	VdpJtuUnit();
	void reset();
};

} // namespace bmsx
