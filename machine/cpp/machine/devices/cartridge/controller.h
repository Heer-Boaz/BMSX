#pragma once

#include "machine/devices/cartridge/card.h"
#include "machine/devices/cartridge/contracts.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/bmsx/cartridge.h"

#include <array>
#include <optional>
#include <span>

namespace bmsx {

class DmaController;
class IrqController;
class Memory;

class CartridgeController {
public:
	explicit CartridgeController(const CartridgeSocketMediaPair& media);

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
	size_t ramByteCount() const {
		return (m_cards[0] ? m_cards[0]->ramByteCount() : 0u)
			+ (m_cards[1] ? m_cards[1]->ramByteCount() : 0u);
	}
	void reset();

	CartridgeControllerState captureState(CartridgeControllerState storage = {}) const;
	void restoreState(const CartridgeControllerState& state);

	u8 readU8(u32 address, MappedBusSignals busSignals) const {
		const auto& card = m_cards[selectedSlot(busSignals)];
		return card ? card->readU8(address) : 0u;
	}
	u32 readU16(u32 address, MappedBusSignals busSignals) const {
		const auto& card = m_cards[selectedSlot(busSignals)];
		return card ? card->readU16(address) : 0u;
	}
	u32 readU32(u32 address, MappedBusSignals busSignals) const {
		const auto& card = m_cards[selectedSlot(busSignals)];
		return card ? card->readU32(address) : 0u;
	}
	void writeU8(u32 address, u8 value, MappedBusSignals busSignals) {
		auto& card = m_cards[selectedSlot(busSignals)];
		if (card) card->writeU8(address, value);
	}
	void writeU16(u32 address, u32 value, MappedBusSignals busSignals) {
		auto& card = m_cards[selectedSlot(busSignals)];
		if (card) card->writeU16(address, value);
	}
	void writeU32(u32 address, u32 value, MappedBusSignals busSignals) {
		const u32 slotIndex = selectedSlot(busSignals);
		auto& card = m_cards[slotIndex];
		if (!card) return;
		const u32 effects = card->writeU32(address, value);
		if (effects != 0u) routeCardEffects(slotIndex, effects);
	}
	void readBytes(u32 address, u8* out, size_t length) const;
	bool bindRomByteView(u32 slotIndex, u32 address, size_t length, Span<const u8>& out) const;

private:
	static u32 readSelectionThunk(void* context, u32 address, MappedBusSignals busSignals);
	static void writeSelectionThunk(void* context, u32 address, u32 value, MappedBusSignals busSignals);
	static u32 readStatusThunk(void* context, u32 address, MappedBusSignals busSignals);

	void routeCardEffects(u32 slotIndex, u32 effects);
	void publishDreqLines(u32 slotIndex);

	std::array<std::optional<CartridgeCard>, CARTRIDGE_SLOT_COUNT> m_cards;
	u32 m_selectionWord = 0u;
	IrqController* m_irq;
	DmaController* m_dma;
};

} // namespace bmsx
