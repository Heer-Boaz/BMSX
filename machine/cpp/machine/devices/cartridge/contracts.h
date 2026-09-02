#pragma once

#include "common/primitives.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <optional>
#include <span>
#include <vector>

namespace bmsx {

struct CartridgeCardMedia {
	std::optional<std::span<const u8>> rom;
	std::optional<size_t> ramByteCount;
	bool mailboxPresent = false;
};

using CartridgeSocketMediaPair = std::array<
	std::optional<CartridgeCardMedia>,
	CARTRIDGE_SLOT_COUNT
>;

struct CartridgeMailboxState {
	u32 dataWord = 0u;
	u32 controlWord = 0u;
	bool irqPending = false;
};

struct CartridgeCardState {
	std::optional<std::vector<u8>> ram;
	std::optional<CartridgeMailboxState> mailbox;
};

struct CartridgeControllerState {
	u32 selectionWord = 0;
	std::array<std::optional<CartridgeCardState>, CARTRIDGE_SLOT_COUNT> slots;
};

} // namespace bmsx
