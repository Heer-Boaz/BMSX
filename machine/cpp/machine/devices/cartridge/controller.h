#pragma once

#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/cartridge.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"

#include <array>
#include <span>

namespace bmsx {

class DmaController;
class IrqController;
class Memory;

class CartridgeController {
public:
	explicit CartridgeController(const CartridgeSlotMediaPair& media);

	void connect(Memory& memory, IrqController& irq, DmaController& dma);
	void installRom(u32 slotIndex, std::span<const u8> rom);
	void attachMappedPageInvalidator(MappedPageInvalidator& invalidator);
	void detachMappedPageInvalidator();
	void clearMappedPageWriteWatches();
	void bindMappedPage(u32 address, MappedBusSignals busSignals, MappedPageBinding& out);
	u32 selectedSlot(MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU) const {
		if ((busSignals & MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE) == 0u) {
			return m_selectionWord & 1u;
		}
		return (busSignals & MAPPED_BUS_CARTRIDGE_SLOT1) >> 3u;
	}
	size_t ramByteCount() const { return m_slots[0].ram.size() + m_slots[1].ram.size(); }
	void reset();

	CartridgeControllerState captureState() const;
	void restoreState(const CartridgeControllerState& state);

	u8 readU8(u32 address, MappedBusSignals busSignals) const;
	u32 readU16(u32 address, MappedBusSignals busSignals) const;
	u32 readU32(u32 address, MappedBusSignals busSignals) const;
	void writeU8(u32 address, u8 value, MappedBusSignals busSignals);
	void writeU16(u32 address, u32 value, MappedBusSignals busSignals);
	void writeU32(u32 address, u32 value, MappedBusSignals busSignals);
	void readBytes(u32 address, u8* out, size_t length) const;
	bool bindRomByteView(u32 slotIndex, u32 address, size_t length, Span<const u8>& out) const;

private:
	struct Slot {
		CartridgeSlotMedia media;
		std::vector<u8> ram;
		u64 mappedKeyOffset = 0u;
		u32 mailboxDataWord = 0;
		u32 mailboxControlWord = 0;
		bool mailboxIrqPending = false;
	};

	static u32 readSelectionThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeSelectionThunk(void* context, u32 address, u32 value, MappedBusSignals busSignals);
	static u32 readStatusThunk(void* context, u32 address, MappedBusSignals busSignals);
	static u32 readSlot0BoardThunk(void* context, u32 address, MappedBusSignals busSignals);
	static u32 readSlot0RamBytesThunk(void* context, u32 address, MappedBusSignals busSignals);
	static u32 readSlot1BoardThunk(void* context, u32 address, MappedBusSignals busSignals);
	static u32 readSlot1RamBytesThunk(void* context, u32 address, MappedBusSignals busSignals);

	static u32 readU16From(std::span<const u8> bytes, size_t offset);
	static u32 readU32From(std::span<const u8> bytes, size_t offset);
	u32 readMailboxWord(const Slot& slot, u32 offset) const;
	void writeMailboxWord(u32 slotIndex, Slot& slot, u32 offset, u32 value);
	void publishDreqLines();
	static CartridgeSlotState captureSlot(const Slot& slot);
	void restoreSlot(Slot& slot, const CartridgeSlotState& state);

	std::array<Slot, CARTRIDGE_SLOT_COUNT> m_slots;
	std::array<MappedPageWriteWatches, CARTRIDGE_SLOT_COUNT> m_ramPageWriteWatches;
	MappedPageInvalidator* m_mappedPageInvalidator = nullptr;
	u32 m_selectionWord = 0;
	IrqController* m_irq;
	DmaController* m_dma;
};

} // namespace bmsx
