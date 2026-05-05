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

inline void writeLE32(u8* data, u32 value) {
	data[0] = static_cast<u8>(value & 0xffu);
	data[1] = static_cast<u8>((value >> 8) & 0xffu);
	data[2] = static_cast<u8>((value >> 16) & 0xffu);
	data[3] = static_cast<u8>((value >> 24) & 0xffu);
}

} // namespace bmsx
