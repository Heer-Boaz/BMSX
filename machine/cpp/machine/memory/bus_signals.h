#pragma once

#include "common/primitives.h"

namespace bmsx {

using MappedBusSignals = u8;

constexpr MappedBusSignals MAPPED_BUS_MASTER_CPU = 0u;
constexpr MappedBusSignals MAPPED_BUS_MASTER_DMA = 1u;
// IO handlers receive the initiating master plus raw bus strobes. DMA asserts
// BLOCK_END on the final word of an admitted hardware block and TRANSFER_END
// on the final word of the programmed transfer.
constexpr MappedBusSignals MAPPED_BUS_DMA_BLOCK_END = 2u;
constexpr MappedBusSignals MAPPED_BUS_DMA_TRANSFER_END = 4u;

} // namespace bmsx
