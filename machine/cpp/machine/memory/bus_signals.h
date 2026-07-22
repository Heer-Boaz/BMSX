#pragma once

#include "common/primitives.h"

namespace bmsx {

using MappedBusSignals = u8;

constexpr MappedBusSignals MAPPED_BUS_MASTER_CPU = 0u;
constexpr MappedBusSignals MAPPED_BUS_MASTER_DMA = 1u;
// IO handlers and write-ready lines receive the initiating master plus raw bus
// strobes. DMA asserts BLOCK_END on the final word of an admitted hardware block.
constexpr MappedBusSignals MAPPED_BUS_DMA_BLOCK_END = 2u;

} // namespace bmsx
