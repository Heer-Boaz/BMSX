#include "machine/devices/cartridge/controller.h"

#include "machine/devices/cartridge/signals.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <cstring>

namespace bmsx {
namespace {

constexpr u64 CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET = mappedPageDomainKey(1u);
constexpr u64 CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET = mappedPageDomainKey(2u);

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
	} {
	selectCpuSlot(0u);
}

void CartridgeController::connect(Memory& memory, IrqController& irq, DmaController& dma) {
	m_irq = &irq;
	m_dma = &dma;
	memory.mapIoRead(IO_CART_SELECT, this, &CartridgeController::readSelectionThunk);
	memory.mapIoWrite(IO_CART_SELECT, this, &CartridgeController::writeSelectionThunk);
	memory.mapIoRead(IO_CART_STATUS, this, &CartridgeController::readStatusThunk);
	memory.mapIoRead(IO_CART_ROM_BYTE_COUNT, this, &CartridgeController::readRomByteCountThunk);
	memory.mapIoRead(IO_CART_RAM_BYTE_COUNT, this, &CartridgeController::readRamByteCountThunk);
}

void CartridgeController::installRom(u32 slotIndex, std::span<const u8> rom) {
	m_cards[slotIndex]->installRom(rom);
	if (slotIndex == selectedSlot()) selectCpuSlot(m_selectionWord);
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
	out.cacheable = false;
	out.readBytes = nullptr;
	out.writeWatch = {};
}

void CartridgeController::reset() {
	selectCpuSlot(0u);
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
	selectCpuSlot(state.selectionWord);
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

bool CartridgeController::isReadableRange(u32 address, size_t length) const {
	const auto& card = m_cards[selectedSlot()];
	if (!card) return false;
	if (address >= CART_MMIO_BASE) return length <= CART_BUS_END - address && card->hasMailbox();
	Span<const u8> bytes;
	return card->bindMappedReadView(address, length, bytes);
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

bool CartridgeController::bindMappedReadView(u32 address, size_t length, MappedBusSignals busSignals, Span<const u8>& out) const {
	const auto& card = m_cards[selectedSlot(busSignals)];
	return card && card->bindMappedReadView(address, length, out);
}

void CartridgeController::publishDreqLines(u32 slotIndex) {
	const auto& card = m_cards[slotIndex];
	const u32 lines = card ? card->dreqLines() : 0u;
	const u32 write = (lines & CARTRIDGE_CARD_DREQ_WRITE) != 0u ? CARTRIDGE_DMA_BURST_WORD_CAPACITY : 0u;
	const u32 read = (lines & CARTRIDGE_CARD_DREQ_READ) != 0u ? CARTRIDGE_DMA_BURST_WORD_CAPACITY : 0u;
	m_dma->setEndpointRequests(slotIndex == 0u ? DmaEndpoint::Cartridge0Write : DmaEndpoint::Cartridge1Write, write,
		slotIndex == 0u ? DmaEndpoint::Cartridge0Read : DmaEndpoint::Cartridge1Read, read);
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
	static_cast<CartridgeController*>(context)->selectCpuSlot(value);
}

void CartridgeController::selectCpuSlot(u32 selection) {
	m_selectionWord = selection;
	const auto* rom = romStorage(selectedSlot());
	m_cpuRom = rom ? Span<const u8>(rom->data(), std::min<size_t>(rom->size(), CART_ROM_SIZE))
		: Span<const u8>{};
}

u32 CartridgeController::readRomByteCountThunk(void* context, u32, MappedBusSignals) {
	const auto& controller = *static_cast<const CartridgeController*>(context);
	const auto* rom = controller.romStorage(controller.selectedSlot());
	return rom ? static_cast<u32>(rom->size()) : 0u;
}

u32 CartridgeController::readRamByteCountThunk(void* context, u32, MappedBusSignals) {
	const auto& controller = *static_cast<const CartridgeController*>(context);
	const auto& card = controller.m_cards[controller.selectedSlot()];
	return card ? static_cast<u32>(card->ramByteCount()) : 0u;
}

u32 CartridgeController::readStatusThunk(void* context, u32, MappedBusSignals) {
	const CartridgeController& controller = *static_cast<CartridgeController*>(context);
	u32 status = controller.selectedSlot() == 1u ? CARTRIDGE_STATUS_SELECTED_SLOT1 : 0u;
	if (controller.m_cards[0]) status |= CARTRIDGE_STATUS_SLOT0_PRESENT;
	if (controller.m_cards[1]) status |= CARTRIDGE_STATUS_SLOT1_PRESENT;
	return status;
}

} // namespace bmsx
