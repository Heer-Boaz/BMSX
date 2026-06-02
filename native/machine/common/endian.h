#pragma once

#include "common/primitives.h"

namespace bmsx {

inline auto readLE16(const u8* data) -> u16 {
	return static_cast<u16>(data[0]) | (static_cast<u16>(data[1]) << 8);
}

inline auto readI16LE(const u8* data) -> i16 {
	return static_cast<i16>(readLE16(data));
}

inline auto readLE32(const u8* data) -> u32 {
	return static_cast<u32>(data[0])
		| (static_cast<u32>(data[1]) << 8)
		| (static_cast<u32>(data[2]) << 16)
		| (static_cast<u32>(data[3]) << 24);
}

inline auto readLE64(const u8* data) -> u64 {
	return static_cast<u64>(data[0])
		| (static_cast<u64>(data[1]) << 8)
		| (static_cast<u64>(data[2]) << 16)
		| (static_cast<u64>(data[3]) << 24)
		| (static_cast<u64>(data[4]) << 32)
		| (static_cast<u64>(data[5]) << 40)
		| (static_cast<u64>(data[6]) << 48)
		| (static_cast<u64>(data[7]) << 56);
}

inline void writeLE16(u8* data, u32 value) {
	for (u32 byte = 0; byte < 2U; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8U)) & 0xffU);
	}
}

inline void writeLE32(u8* data, u32 value) {
	for (u32 byte = 0; byte < 4U; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8U)) & 0xffU);
	}
}

inline void writeLE64(u8* data, u64 value) {
	for (u32 byte = 0; byte < 8U; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8U)) & 0xffU);
	}
}

} // namespace bmsx
