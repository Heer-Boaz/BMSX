#pragma once

#include "core/primitives.h"
#include "machine/devices/vdp/fault.h"
#include <string>

namespace bmsx {

constexpr u32 VDP_UNIT_PACKET_WORD_COUNT_MASK = 0x00ff0000u;
constexpr u32 VDP_UNIT_PACKET_FLAGS_MASK = 0x0000ffffu;

inline bool isVdpUnitPacketHeaderValid(u32 word, u32 expectedPayloadWords) {
	const u32 payloadWords = (word & VDP_UNIT_PACKET_WORD_COUNT_MASK) >> 16u;
	return payloadWords == expectedPayloadWords && (word & VDP_UNIT_PACKET_FLAGS_MASK) == 0u;
}

inline void decodeVdpUnitPacketHeader(const char* packetName, u32 word, u32 expectedPayloadWords) {
	const u32 payloadWords = (word & VDP_UNIT_PACKET_WORD_COUNT_MASK) >> 16u;
	if (payloadWords != expectedPayloadWords) {
		throw vdpStreamFault(std::string(packetName) + " word count " + std::to_string(payloadWords) + " is invalid.");
	}
	if ((word & VDP_UNIT_PACKET_FLAGS_MASK) != 0u) {
		throw vdpStreamFault(std::string(packetName) + " reserved flags are set (" + std::to_string(word) + ").");
	}
}

} // namespace bmsx
