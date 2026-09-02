#pragma once

#include "common/primitives.h"

namespace bmsx {

constexpr u32 CARTRIDGE_CARD_EFFECT_IRQ_EDGE = 1u << 0u;
constexpr u32 CARTRIDGE_CARD_EFFECT_DREQ_CHANGED = 1u << 1u;

constexpr u32 CARTRIDGE_CARD_DREQ_READ = 1u << 0u;
constexpr u32 CARTRIDGE_CARD_DREQ_WRITE = 1u << 1u;

} // namespace bmsx
