#include "machine/devices/cartridge/controller.h"

#include "machine/devices/cartridge/signals.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

#include <cstring>

namespace bmsx {
namespace {

constexpr u32 CARTRIDGE_SLOT0_DREQ_MASK =
	(1u << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE)
	| (1u << DMA_REQUEST_CARTRIDGE_SLOT0_READ);
constexpr u32 CARTRIDGE_SLOT1_DREQ_MASK =
	(1u << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE)
	| (1u << DMA_REQUEST_CARTRIDGE_SLOT1_READ);
constexpr u64 CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET = 1ull << 32u;
constexpr u64 CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET = 2ull << 32u;

} // namespace

CartridgeController::CartridgeController(const CartridgeSocketMediaPair& media)
	: m_cards{
		media[0]
			? std::optional<CartridgeCard>(
				std::in_place,
				*media[0],
				CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET
			)
			: std::nullopt,
		media[1]
			? std::optional<CartridgeCard>(
				std::in_place,
				*media[1],
				CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET
			)
			: std::nullopt
	} {}

void CartridgeController::connect(Memory& memory, IrqController& irq, DmaController& dma) {
	m_irq = &irq;
	m_dma = &dma;
	memory.mapIoRead(IO_CART_SELECT, this, &CartridgeController::readSelectionThunk);
	memory.mapIoWrite(IO_CART_SELECT, this, &CartridgeController::writeSelectionThunk);
	memory.mapIoRead(IO_CART_STATUS, this, &CartridgeController::readStatusThunk);
}

void CartridgeController::installRom(u32 slotIndex, std::span<const u8> rom) {
	m_cards[slotIndex]->installRom(rom);
}

void CartridgeController::attachMappedPageInvalidator(
	MappedPageInvalidator& invalidator
) {
	if (m_cards[0]) m_cards[0]->attachMappedPageInvalidator(invalidator);
	if (m_cards[1]) m_cards[1]->attachMappedPageInvalidator(invalidator);
}

void CartridgeController::detachMappedPageInvalidator() {
	if (m_cards[0]) m_cards[0]->detachMappedPageInvalidator();
	if (m_cards[1]) m_cards[1]->detachMappedPageInvalidator();
}

void CartridgeController::clearMappedPageWriteWatches() {
	if (m_cards[0]) m_cards[0]->clearMappedPageWriteWatches();
	if (m_cards[1]) m_cards[1]->clearMappedPageWriteWatches();
}

void CartridgeController::bindMappedPage(
	u32 address,
	MappedBusSignals busSignals,
	MappedPageBinding& out
) {
	const u32 slotIndex = selectedSlot(busSignals);
	auto& card = m_cards[slotIndex];
	if (card) {
		card->bindMappedPage(address, out);
		return;
	}
	out.key = address + (slotIndex == 0u
		? CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET
		: CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET);
	out.cacheable = address < CART_RAM_BASE;
	out.readBytes = nullptr;
	out.writeWatch = nullptr;
}

void CartridgeController::reset() {
	m_selectionWord = 0u;
	if (m_cards[0]) m_cards[0]->reset();
	if (m_cards[1]) m_cards[1]->reset();
	publishDreqLines(0u);
	publishDreqLines(1u);
}

CartridgeControllerState CartridgeController::captureState(CartridgeControllerState storage) const {
	storage.selectionWord = m_selectionWord;
	for (size_t slot = 0; slot < m_cards.size(); ++slot) {
		if (!m_cards[slot]) continue;
		if (!storage.slots[slot]) storage.slots[slot].emplace();
		storage.slots[slot] = m_cards[slot]->captureState(std::move(*storage.slots[slot]));
	}
	return storage;
}

void CartridgeController::restoreState(const CartridgeControllerState& state) {
	for (u32 slotIndex = 0u; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (m_cards[slotIndex].has_value() != state.slots[slotIndex].has_value()) {
			throw BMSX_RUNTIME_ERROR(
				"Cartridge state does not match the occupied physical sockets."
			);
		}
	}
	m_selectionWord = state.selectionWord;
	for (u32 slotIndex = 0u; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (m_cards[slotIndex]) {
			m_cards[slotIndex]->restoreState(*state.slots[slotIndex]);
		}
	}
	publishDreqLines(0u);
	publishDreqLines(1u);
}

void CartridgeController::routeCardEffects(u32 slotIndex, u32 effects) {
	if ((effects & CARTRIDGE_CARD_EFFECT_IRQ_EDGE) != 0u) {
		m_irq->raise(slotIndex == 0u ? IRQ_CARTRIDGE_SLOT0 : IRQ_CARTRIDGE_SLOT1);
	}
	if ((effects & CARTRIDGE_CARD_EFFECT_DREQ_CHANGED) != 0u) {
		publishDreqLines(slotIndex);
	}
}

void CartridgeController::readBytes(u32 address, u8* out, size_t length) const {
	const auto& card = m_cards[selectedSlot()];
	if (card) {
		card->readBytes(address, out, length);
		return;
	}
	std::memset(out, 0, length);
}

bool CartridgeController::bindRomByteView(
	u32 slotIndex,
	u32 address,
	size_t length,
	Span<const u8>& out
) const {
	const auto& card = m_cards[slotIndex];
	return card ? card->bindRomByteView(address, length, out) : false;
}

void CartridgeController::publishDreqLines(u32 slotIndex) {
	u32 asserted = 0u;
	const auto& card = m_cards[slotIndex];
	const u32 lines = card ? card->dreqLines() : 0u;
	if (slotIndex == 0u) {
		if ((lines & CARTRIDGE_CARD_DREQ_WRITE) != 0u) {
			asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE;
		}
		if ((lines & CARTRIDGE_CARD_DREQ_READ) != 0u) {
			asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT0_READ;
		}
		m_dma->setRequestLines(CARTRIDGE_SLOT0_DREQ_MASK, asserted);
		return;
	}
	if ((lines & CARTRIDGE_CARD_DREQ_WRITE) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE;
	}
	if ((lines & CARTRIDGE_CARD_DREQ_READ) != 0u) {
		asserted |= 1u << DMA_REQUEST_CARTRIDGE_SLOT1_READ;
	}
	m_dma->setRequestLines(CARTRIDGE_SLOT1_DREQ_MASK, asserted);
}

u32 CartridgeController::readSelectionThunk(void* context, u32, MappedBusSignals) {
	return static_cast<CartridgeController*>(context)->m_selectionWord;
}

void CartridgeController::writeSelectionThunk(
	void* context,
	u32,
	u32 value,
	MappedBusSignals
) {
	static_cast<CartridgeController*>(context)->m_selectionWord = value;
}

u32 CartridgeController::readStatusThunk(void* context, u32, MappedBusSignals) {
	const CartridgeController& controller = *static_cast<CartridgeController*>(context);
	u32 status = controller.selectedSlot() == 1u ? CARTRIDGE_STATUS_SELECTED_SLOT1 : 0u;
	if (controller.m_cards[0]) status |= CARTRIDGE_STATUS_SLOT0_PRESENT;
	if (controller.m_cards[1]) status |= CARTRIDGE_STATUS_SLOT1_PRESENT;
	return status;
}

} // namespace bmsx
