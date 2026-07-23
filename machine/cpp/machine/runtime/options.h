#pragma once

#include "common/primitives.h"
#include "machine/devices/cartridge/contracts.h"
#include <cstddef>
#include <span>

namespace bmsx {

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	std::span<const u8> systemRomBytes;
	CartridgeSlotMediaPair cartridgeSlots;
	bool pcrtcRunning;
	i64 ufpsScaled;
	i64 cpuHz;
	i64 cycleBudgetPerFrame;
	i64 totalHalfLines;
	i64 activeDisplayHalfLines;
	int geoWorkUnitsPerSec;
};

} // namespace bmsx
