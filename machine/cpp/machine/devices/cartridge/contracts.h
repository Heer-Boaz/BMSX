#pragma once

#include "common/primitives.h"

#include <array>
#include <span>
#include <vector>

namespace bmsx {

constexpr u32 CARTRIDGE_SLOT_COUNT = 2u;
constexpr u32 CARTRIDGE_BOARD_RAM = 1u << 0;
constexpr u32 CARTRIDGE_BOARD_MAILBOX = 1u << 1;

constexpr u32 CARTRIDGE_STATUS_SLOT0_PRESENT = 1u << 0;
constexpr u32 CARTRIDGE_STATUS_SLOT1_PRESENT = 1u << 1;
constexpr u32 CARTRIDGE_STATUS_SLOT0_PROGRAM = 1u << 8;
constexpr u32 CARTRIDGE_STATUS_SLOT1_PROGRAM = 1u << 9;
constexpr u32 CARTRIDGE_STATUS_SELECTED_SLOT1 = 1u << 16;

constexpr u32 CARTRIDGE_MAILBOX_DATA_OFFSET = 0x00u;
constexpr u32 CARTRIDGE_MAILBOX_CONTROL_OFFSET = 0x04u;
constexpr u32 CARTRIDGE_MAILBOX_STATUS_OFFSET = 0x08u;
constexpr u32 CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET = 0x0cu;
constexpr u32 CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER = 1u << 0;
constexpr u32 CARTRIDGE_MAILBOX_CONTROL_DREQ_READ = 1u << 1;
constexpr u32 CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE = 1u << 2;
constexpr u32 CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING = 1u << 0;

struct CartridgeSlotMedia {
	std::span<const u8> rom;
	u32 boardWord = 0;
	u32 ramByteCount = 0;
	bool present = false;
	bool programPresent = false;
};

using CartridgeSlotMediaPair = std::array<CartridgeSlotMedia, CARTRIDGE_SLOT_COUNT>;

constexpr u32 cartridgeBootSlot(const CartridgeSlotMediaPair& media) {
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (media[slotIndex].programPresent) return slotIndex;
	}
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (media[slotIndex].present) return slotIndex;
	}
	return 0u;
}

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
