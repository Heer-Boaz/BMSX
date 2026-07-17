#pragma once

#include "common/primitives.h"

namespace bmsx {

using MappedBusMaster = u8;

constexpr MappedBusMaster MAPPED_BUS_MASTER_CPU = 0u;
constexpr MappedBusMaster MAPPED_BUS_MASTER_DMA = 1u;

} // namespace bmsx
