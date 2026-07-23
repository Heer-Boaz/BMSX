#pragma once

#include "machine/devices/cartridge/contracts.h"

#include <span>

namespace bmsx::test {

inline CartridgeSlotMediaPair cartridgeSlots(
	std::span<const u8> slot0 = {},
	std::span<const u8> slot1 = {}
) {
	return {{
		{
			.rom = slot0,
			.present = !slot0.empty(),
		},
		{
			.rom = slot1,
			.present = !slot1.empty(),
		},
	}};
}

} // namespace bmsx::test
