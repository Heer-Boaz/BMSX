#pragma once

#include "machine/cpu/blua32_image.h"
#include "machine/memory/map.h"
#include "rompack/format.h"

#include <string>
#include <vector>

namespace bmsx::test {

constexpr u32 BLUA32_TEST_IMAGE_OFFSET = 0x100u;

struct Blua32TestFunction {
	u32 firstWord = 0;
	u32 wordCount = 0;
	u32 numParams = 0;
	u32 maxStack = 1;
	bool isVararg = false;
	bool staticClosure = true;
};

struct Blua32TestClosureRelocation {
	u32 wordIndex = 0;
	u32 functionAddress = 0;
};

struct Blua32TestImage {
	std::vector<u8> text;
	std::vector<Blua32TestFunction> functions;
	std::vector<Blua32EncodedConstant> constants;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
	std::vector<Blua32TestClosureRelocation> closureRelocations;
	u32 startupFunctionIndex = 0;
	u32 irqFunctionIndex = 0;
	u32 exceptionFunctionIndex = 0;
};

struct Blua32TestRom {
	std::vector<u8> bytes;
	Blua32BootHeader boot;
	std::vector<u32> functionAddresses;
	u32 textAddress = 0;
};

constexpr auto blua32TestFunctionAddress(RomImageDomain domain, u32 functionIndex) -> u32 {
	const u32 romBase = domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	return romBase
		+ BLUA32_TEST_IMAGE_OFFSET
		+ BLUA32_IMAGE_HEADER_SIZE
		+ functionIndex * BLUA32_FUNCTION_RECORD_SIZE;
}

auto encodeBlua32TestRom(
	RomImageDomain domain,
	const Blua32TestImage& image,
	u32 cartridgeBoardWord = 0u,
	u32 cartridgeRamByteCount = 0u
) -> Blua32TestRom;

auto encodeBlua32TestDataRom(
	u32 cartridgeBoardWord = 0u,
	u32 cartridgeRamByteCount = 0u
) -> std::vector<u8>;

} // namespace bmsx::test
