#include "machine/devices/cartridge/controller.h"

#include "common/endian.h"
#include "machine/bus/io.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"

#include <algorithm>
#include <cstring>

namespace bmsx {
namespace {

constexpr u32 CARTRIDGE_DREQ_MASK =
	(1u << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE)
	| (1u << DMA_REQUEST_CARTRIDGE_SLOT0_READ)
	| (1u << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE)
	| (1u << DMA_REQUEST_CARTRIDGE_SLOT1_READ);

} // namespace

CartridgeController::CartridgeController(const CartridgeSlotMediaPair& media) {
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const CartridgeSlotMedia& source = media[slotIndex];
		Slot& slot = m_slots[slotIndex];
		slot.media = source;
		slot.ram.resize(source.ramByteCount);
	}
	m_selectionWord = 0u;
}

void CartridgeController::connect(Memory& memory, IrqController& irq, DmaController& dma) {
	m_irq = &irq;
	m_dma = &dma;
	memory.mapIoRead(IO_CART_SELECT, this, &CartridgeController::readSelectionThunk);
	memory.mapIoWrite(IO_CART_SELECT, this, &CartridgeController::writeSelectionThunk);
	memory.mapIoRead(IO_CART_STATUS, this, &CartridgeController::readStatusThunk);
	memory.mapIoRead(IO_CART_SLOT0_BOARD, this, &CartridgeController::readSlot0BoardThunk);
	memory.mapIoRead(IO_CART_SLOT0_RAM_BYTES, this, &CartridgeController::readSlot0RamBytesThunk);
	memory.mapIoRead(IO_CART_SLOT1_BOARD, this, &CartridgeController::readSlot1BoardThunk);
	memory.mapIoRead(IO_CART_SLOT1_RAM_BYTES, this, &CartridgeController::readSlot1RamBytesThunk);
}

void CartridgeController::reset() {
	m_selectionWord = 0u;
	for (Slot& slot : m_slots) {
		slot.mailboxDataWord = 0u;
		slot.mailboxControlWord = 0u;
		slot.mailboxIrqPending = false;
	}
	publishDreqLines();
}

CartridgeControllerState CartridgeController::captureState() const {
	CartridgeControllerState state;
	state.selectionWord = m_selectionWord;
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		state.slots[slotIndex] = captureSlot(m_slots[slotIndex]);
	}
	return state;
}

void CartridgeController::restoreState(const CartridgeControllerState& state) {
	m_selectionWord = state.selectionWord;
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		restoreSlot(m_slots[slotIndex], state.slots[slotIndex]);
	}
	publishDreqLines();
}

u8 CartridgeController::readU8(u32 address, MappedBusSignals busSignals) const {
	const Slot& slot = m_slots[slotIndexForSignals(busSignals)];
	if (address < CART_RAM_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
		return offset < slot.media.rom.size() ? slot.media.rom[offset] : 0u;
	}
	if (address < CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return 0u;
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		return offset < slot.ram.size() ? slot.ram[offset] : 0u;
	}
	const u32 word = readMailboxWord(slot, address - CART_MMIO_BASE);
	return static_cast<u8>(word >> ((address & 3u) << 3u));
}

u32 CartridgeController::readU16(u32 address, MappedBusSignals busSignals) const {
	const Slot& slot = m_slots[slotIndexForSignals(busSignals)];
	if (address < CART_RAM_BASE) {
		return readU16From(slot.media.rom, static_cast<size_t>(address - CART_ROM_BASE));
	}
	if (address < CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return 0u;
		return readU16From(slot.ram, static_cast<size_t>(address - CART_RAM_BASE));
	}
	const u32 word = readMailboxWord(slot, address - CART_MMIO_BASE);
	return (word >> ((address & 2u) << 3u)) & 0xffffu;
}

u32 CartridgeController::readU32(u32 address, MappedBusSignals busSignals) const {
	const Slot& slot = m_slots[slotIndexForSignals(busSignals)];
	if (address < CART_RAM_BASE) {
		return readU32From(slot.media.rom, static_cast<size_t>(address - CART_ROM_BASE));
	}
	if (address < CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return 0u;
		return readU32From(slot.ram, static_cast<size_t>(address - CART_RAM_BASE));
	}
	return readMailboxWord(slot, address - CART_MMIO_BASE);
}

void CartridgeController::writeU8(u32 address, u8 value, MappedBusSignals busSignals) {
	Slot& slot = m_slots[slotIndexForSignals(busSignals)];
	if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return;
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		if (offset < slot.ram.size()) {
			slot.ram[offset] = value;
		}
	}
}

void CartridgeController::writeU16(u32 address, u32 value, MappedBusSignals busSignals) {
	if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
	Slot& slot = m_slots[slotIndexForSignals(busSignals)];
	if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return;
	const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
	if (offset + 2u <= slot.ram.size()) {
		writeLE16(slot.ram.data() + offset, static_cast<u16>(value));
	}
}

void CartridgeController::writeU32(u32 address, u32 value, MappedBusSignals busSignals) {
	const u32 slotIndex = slotIndexForSignals(busSignals);
	Slot& slot = m_slots[slotIndex];
	if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) return;
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		if (offset + 4u <= slot.ram.size()) {
			writeLE32(slot.ram.data() + offset, value);
		}
		return;
	}
	if (address >= CART_MMIO_BASE) {
		writeMailboxWord(slotIndex, slot, address - CART_MMIO_BASE, value);
	}
}

void CartridgeController::readBytes(u32 address, u8* out, size_t length) const {
	const Slot& slot = m_slots[selectedSlot()];
	if (address < CART_RAM_BASE && static_cast<u64>(address) + length <= CART_RAM_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
		const size_t available = offset < slot.media.rom.size()
			? std::min(length, slot.media.rom.size() - offset)
			: 0u;
		if (available != 0u) {
			std::memcpy(out, slot.media.rom.data() + offset, available);
		}
		if (available != length) {
			std::memset(out + available, 0, length - available);
		}
		return;
	}
	if (address >= CART_RAM_BASE && static_cast<u64>(address) + length <= CART_MMIO_BASE) {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) == 0u) {
			std::memset(out, 0, length);
			return;
		}
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		const size_t available = offset < slot.ram.size()
			? std::min(length, slot.ram.size() - offset)
			: 0u;
		if (available != 0u) {
			std::memcpy(out, slot.ram.data() + offset, available);
		}
		if (available != length) {
			std::memset(out + available, 0, length - available);
		}
		return;
	}
	for (size_t index = 0; index < length; ++index) {
		out[index] = readU8(address + static_cast<u32>(index), MAPPED_BUS_MASTER_CPU);
	}
}

bool CartridgeController::bindRomByteView(u32 slotIndex, u32 address, size_t length, Span<const u8>& out) const {
	const std::span<const u8> rom = m_slots[slotIndex].media.rom;
	const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
	if (length == 0u || offset >= rom.size() || length > rom.size() - offset) {
		return false;
	}
	out = Span<const u8>(rom.data() + offset, length);
	return true;
}

u32 CartridgeController::slotIndexForSignals(MappedBusSignals busSignals) const {
	if ((busSignals & MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE) == 0u) {
		return selectedSlot();
	}
	return (busSignals & MAPPED_BUS_CARTRIDGE_SLOT1) != 0u ? 1u : 0u;
}

u32 CartridgeController::readU16From(std::span<const u8> bytes, size_t offset) {
	if (offset + 2u <= bytes.size()) return readLE16(bytes.data() + offset);
	return offset < bytes.size() ? bytes[offset] : 0u;
}

u32 CartridgeController::readU32From(std::span<const u8> bytes, size_t offset) {
	if (offset + 4u <= bytes.size()) return readLE32(bytes.data() + offset);
	if (offset >= bytes.size()) return 0u;
	u32 word = bytes[offset];
	if (offset + 1u < bytes.size()) word |= static_cast<u32>(bytes[offset + 1u]) << 8u;
	if (offset + 2u < bytes.size()) word |= static_cast<u32>(bytes[offset + 2u]) << 16u;
	return word;
}

u32 CartridgeController::readMailboxWord(const Slot& slot, u32 offset) const {
	if ((slot.media.boardWord & CARTRIDGE_BOARD_MAILBOX) == 0u) return 0u;
	switch (offset & ~3u) {
		case CARTRIDGE_MAILBOX_DATA_OFFSET:
			return slot.mailboxDataWord;
		case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
			return slot.mailboxControlWord;
		case CARTRIDGE_MAILBOX_STATUS_OFFSET:
			return slot.mailboxIrqPending ? CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING : 0u;
		default:
			return 0u;
	}
}

void CartridgeController::writeMailboxWord(u32 slotIndex, Slot& slot, u32 offset, u32 value) {
	if ((slot.media.boardWord & CARTRIDGE_BOARD_MAILBOX) == 0u) return;
	switch (offset) {
		case CARTRIDGE_MAILBOX_DATA_OFFSET:
			slot.mailboxDataWord = value;
			return;
		case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
			slot.mailboxControlWord = value & ~CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER;
			if ((value & CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) != 0u && !slot.mailboxIrqPending) {
				slot.mailboxIrqPending = true;
				m_irq->raise(slotIndex == 0u ? IRQ_CARTRIDGE_SLOT0 : IRQ_CARTRIDGE_SLOT1);
			}
			publishDreqLines();
			return;
		case CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET:
			if (value != 0u) slot.mailboxIrqPending = false;
			return;
		default:
			return;
	}
}

void CartridgeController::publishDreqLines() {
	u32 asserted = 0u;
	const Slot& slot0 = m_slots[0];
	const Slot& slot1 = m_slots[1];
	if ((slot0.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE;
	}
	if ((slot0.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT0_READ;
	}
	if ((slot1.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE;
	}
	if ((slot1.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT1_READ;
	}
	m_dma->setRequestLines(CARTRIDGE_DREQ_MASK, asserted);
}

CartridgeSlotState CartridgeController::captureSlot(const Slot& slot) {
	CartridgeSlotState state;
	state.ram = slot.ram;
	state.mailboxDataWord = slot.mailboxDataWord;
	state.mailboxControlWord = slot.mailboxControlWord;
	state.mailboxIrqPending = slot.mailboxIrqPending;
	return state;
}

void CartridgeController::restoreSlot(Slot& slot, const CartridgeSlotState& state) {
	if (state.ram.size() != slot.ram.size()) {
		throw BMSX_RUNTIME_ERROR("Cartridge RAM size does not match the inserted board.");
	}
	std::copy_n(state.ram.data(), slot.ram.size(), slot.ram.data());
	slot.mailboxDataWord = state.mailboxDataWord;
	slot.mailboxControlWord = state.mailboxControlWord;
	slot.mailboxIrqPending = state.mailboxIrqPending;
}

u64 CartridgeController::readSelectionThunk(void* context, u32, MappedBusSignals) {
	return valueNumber(static_cast<f64>(static_cast<CartridgeController*>(context)->m_selectionWord));
}

void CartridgeController::writeSelectionThunk(void* context, u32, u64 value, MappedBusSignals) {
	static_cast<CartridgeController*>(context)->m_selectionWord = toU32(value);
}

u64 CartridgeController::readStatusThunk(void* context, u32, MappedBusSignals) {
	const CartridgeController& controller = *static_cast<CartridgeController*>(context);
	u32 status = controller.selectedSlot() == 1u ? CARTRIDGE_STATUS_SELECTED_SLOT1 : 0u;
	if (controller.m_slots[0].media.present) status |= CARTRIDGE_STATUS_SLOT0_PRESENT;
	if (controller.m_slots[1].media.present) status |= CARTRIDGE_STATUS_SLOT1_PRESENT;
	return valueNumber(static_cast<f64>(status));
}

u64 CartridgeController::readSlot0BoardThunk(void* context, u32, MappedBusSignals) {
	return valueNumber(static_cast<f64>(static_cast<CartridgeController*>(context)->m_slots[0].media.boardWord));
}

u64 CartridgeController::readSlot0RamBytesThunk(void* context, u32, MappedBusSignals) {
	return valueNumber(static_cast<f64>(static_cast<CartridgeController*>(context)->m_slots[0].ram.size()));
}

u64 CartridgeController::readSlot1BoardThunk(void* context, u32, MappedBusSignals) {
	return valueNumber(static_cast<f64>(static_cast<CartridgeController*>(context)->m_slots[1].media.boardWord));
}

u64 CartridgeController::readSlot1RamBytesThunk(void* context, u32, MappedBusSignals) {
	return valueNumber(static_cast<f64>(static_cast<CartridgeController*>(context)->m_slots[1].ram.size()));
}

} // namespace bmsx
