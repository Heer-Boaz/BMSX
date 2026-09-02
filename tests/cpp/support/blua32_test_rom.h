#pragma once

#include "rompack/tooling/blua32_image.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"
#include "rompack/format.h"
#include "rompack/manifest.h"

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
	std::vector<Blua32UpvalueRecord> upvalues{};
};

struct Blua32TestClosureRelocation {
	u32 wordIndex = 0;
	u32 functionAddress = 0;
};

struct Blua32TestImage {
	std::vector<u8> text;
	std::vector<u8> toolingSymbols;
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
	const Blua32TestImage& image
) -> Blua32TestRom;
auto encodeBlua32TestRom(
	RomImageDomain domain,
	const Blua32TestImage& image,
	const CartManifest& manifest
) -> Blua32TestRom;

void programBlua32TestResetVector(Blua32TestRom& rom, u32 functionIndex);

auto encodeBlua32TestDataRom() -> std::vector<u8>;
auto encodeBlua32TestDataRom(const CartManifest& manifest) -> std::vector<u8>;

} // namespace bmsx::test
