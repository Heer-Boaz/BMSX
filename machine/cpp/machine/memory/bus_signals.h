#pragma once

#include "common/primitives.h"

namespace bmsx {

using MappedBusSignals = u8;

constexpr MappedBusSignals MAPPED_BUS_MASTER_CPU = 0u;
constexpr MappedBusSignals MAPPED_BUS_MASTER_DMA = 1u;
constexpr MappedBusSignals MAPPED_BUS_DMA_MEMORY = 16u;
// Instruction select is consumed by the mapped decoder before any device handler.
constexpr MappedBusSignals MAPPED_BUS_INSTRUCTION_FETCH = 32u;
// IO handlers and write-ready lines receive the initiating master plus raw bus
// strobes. DMA asserts BLOCK_END on the final word of an admitted hardware block
// and can drive a cartridge socket's chip select independently on each bus side.
constexpr MappedBusSignals MAPPED_BUS_DMA_BLOCK_END = 2u;
constexpr MappedBusSignals MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE = 4u;
constexpr MappedBusSignals MAPPED_BUS_CARTRIDGE_SLOT1 = 8u;

constexpr MappedBusSignals mappedBusSignalsForCartridgeSlot(u32 slot) {
	return static_cast<MappedBusSignals>(
		MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE | (slot * MAPPED_BUS_CARTRIDGE_SLOT1)
	);
}

} // namespace bmsx
