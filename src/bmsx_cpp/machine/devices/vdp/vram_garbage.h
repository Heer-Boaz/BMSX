#pragma once

#include "core/primitives.h"
#include <cstddef>

namespace bmsx {

inline constexpr size_t VRAM_GARBAGE_CHUNK_BYTES = 64u * 1024u;
inline constexpr uint32_t VRAM_GARBAGE_SPACE_SALT = 0x5652414dU;

struct VramGarbageStream {
	uint32_t machineSeed = 0;
	uint32_t bootSeed = 0;
	uint32_t slotSalt = 0;
	uint32_t addr = 0;
};

void fillVramGarbageScratch(u8* buffer, size_t length, VramGarbageStream& stream);

} // namespace bmsx
