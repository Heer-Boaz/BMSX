#include "boot_rom_fixture.h"

#include "blua32_test_rom.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/firmware/boot_primitives.h"

#include <span>

namespace bmsx::test {
namespace {

Blua32TestImage makeMinimalImage() {
	Blua32TestImage image;
	image.text.resize(INSTRUCTION_BYTES);
	writeInstruction(
		std::span<u8>(image.text),
		0,
		static_cast<u8>(OpCode::HALT),
		0,
		0,
		0
	);
	image.functions.push_back(Blua32TestFunction{
		.firstWord = 0u,
		.wordCount = 1u,
	});
	return image;
}

} // namespace

std::vector<u8> makeMinimalBootRom(
	RomImageDomain domain,
	u32 cartridgeBoardWord,
	u32 cartridgeRamByteCount) {
	Blua32TestImage image = makeMinimalImage();
	if (domain == RomImageDomain::System) {
		for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
			image.systemGlobalNames.emplace_back(primitive.name);
		}
	}
	return encodeBlua32TestRom(
		domain,
		image,
		cartridgeBoardWord,
		cartridgeRamByteCount
	).bytes;
}

std::vector<u8> makeMinimalDataRom(
	u32 cartridgeBoardWord,
	u32 cartridgeRamByteCount) {
	return encodeBlua32TestDataRom(
		cartridgeBoardWord,
		cartridgeRamByteCount
	);
}

} // namespace bmsx::test
