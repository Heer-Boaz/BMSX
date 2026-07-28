#pragma once

#include "common/primitives.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <span>
#include <vector>

namespace bmsx {

struct CartridgeSlotMedia {
	std::span<const u8> rom;
	u32 boardWord = 0;
	u32 ramByteCount = 0;
	bool present = false;
};

using CartridgeSlotMediaPair = std::array<CartridgeSlotMedia, CARTRIDGE_SLOT_COUNT>;

struct CartridgeSlotState {
	std::vector<u8> ram;
	u32 mailboxDataWord = 0;
	u32 mailboxControlWord = 0;
	bool mailboxIrqPending = false;
};

struct CartridgeControllerState {
	u32 selectionWord = 0;
	std::array<CartridgeSlotState, CARTRIDGE_SLOT_COUNT> slots;
};

} // namespace bmsx
