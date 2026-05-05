#pragma once

#include "common/primitives.h"

namespace bmsx {

constexpr u32 VDP_UNIT_PACKET_WORD_COUNT_MASK = 0x00ff0000u;
constexpr u32 VDP_UNIT_PACKET_FLAGS_MASK = 0x0000ffffu;

inline bool isVdpUnitPacketHeaderValid(u32 word, u32 expectedPayloadWords) {
	const u32 payloadWords = (word & VDP_UNIT_PACKET_WORD_COUNT_MASK) >> 16u;
	return payloadWords == expectedPayloadWords && (word & VDP_UNIT_PACKET_FLAGS_MASK) == 0u;
}

} // namespace bmsx
