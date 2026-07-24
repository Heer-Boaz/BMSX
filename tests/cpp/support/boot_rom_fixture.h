#pragma once

#include "common/primitives.h"
#include "rompack/format.h"
#include <vector>

namespace bmsx::test {

std::vector<u8> makeMinimalBootRom(
	RomImageDomain domain,
	u32 cartridgeBoardWord = 0u,
	u32 cartridgeRamByteCount = 0u);
std::vector<u8> makeMinimalDataRom(
	u32 cartridgeBoardWord = 0u,
	u32 cartridgeRamByteCount = 0u);

} // namespace bmsx::test
