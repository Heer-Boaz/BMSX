#pragma once

#include "common/primitives.h"

namespace bmsx {

inline u16 readLE16(const u8* data) {
	return static_cast<u16>(data[0]) | (static_cast<u16>(data[1]) << 8);
}

inline u32 readLE32(const u8* data) {
	return static_cast<u32>(data[0])
		| (static_cast<u32>(data[1]) << 8)
		| (static_cast<u32>(data[2]) << 16)
		| (static_cast<u32>(data[3]) << 24);
}

inline u64 readLE64(const u8* data) {
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
	for (u32 byte = 0; byte < 2u; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8u)) & 0xffu);
	}
}

inline void writeLE32(u8* data, u32 value) {
	for (u32 byte = 0; byte < 4u; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8u)) & 0xffu);
	}
}

inline void writeLE64(u8* data, u64 value) {
	for (u32 byte = 0; byte < 8u; ++byte) {
		data[byte] = static_cast<u8>((value >> (byte * 8u)) & 0xffu);
	}
}

} // namespace bmsx
