#pragma once

#include "common/primitives.h"
#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/model.h"
#include <cstddef>
#include <span>

namespace bmsx {

/**
 * Runtime options for initialization.
 */
struct RuntimeOptions {
	std::span<const u8> systemRomBytes;
	CartridgeSlotMediaPair cartridgeSlots;
	const MachineModelSpec& machineModel;
};

} // namespace bmsx
