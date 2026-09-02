#include "boot_rom_fixture.h"

#include "blua32_test_rom.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "spec/blua32/builtin.h"
#include "rompack/tooling/blua32_symbols.h"

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
	RomImageDomain domain) {
	CartManifest manifest;
	if (domain == RomImageDomain::Cartridge) {
		manifest.hardware.emplace_back(CartridgeRomDeviceConfig{});
	}
	return makeMinimalBootRom(domain, manifest);
}

std::vector<u8> makeMinimalBootRom(
	RomImageDomain domain,
	const CartManifest& manifest) {
	Blua32TestImage image = makeMinimalImage();
	if (domain == RomImageDomain::System) {
		for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
			image.systemGlobalNames.emplace_back(primitive.name);
		}
	}
	return encodeBlua32TestRom(
		domain,
		image,
		manifest
	).bytes;
}

std::vector<u8> makeMinimalDiagnosticBootRom(RomImageDomain domain) {
	Blua32TestImage image = makeMinimalImage();
	if (domain == RomImageDomain::System) {
		for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
			image.systemGlobalNames.emplace_back(primitive.name);
		}
	}
	const Blua32TestRom executable = encodeBlua32TestRom(domain, image);
	Blua32SymbolsImage symbols;
	symbols.version = BLUA32_SYMBOLS_VERSION;
	symbols.imageAddress = (domain == RomImageDomain::System ? SYSTEM_ROM_BASE : CART_ROM_BASE)
		+ BLUA32_TEST_IMAGE_OFFSET;
	symbols.functionAddresses = executable.functionAddresses;
	symbols.metadata.functionIds.emplace_back("test.boot");
	symbols.metadata.globalNames = image.globalNames;
	symbols.metadata.systemGlobalNames = image.systemGlobalNames;
	symbols.metadata.debugRanges.emplace_back(SourceRange{
		"test/boot.lua",
		SourcePosition{3, 5},
		SourcePosition{3, 9},
	});
	symbols.metadata.debugInlineCallSiteChains.emplace_back();
	symbols.metadata.debugInlineCallSiteChainIds.push_back(0u);
	symbols.metadata.resumePointsByFunction.resize(image.functions.size());
	symbols.metadata.localSlotsByFunction.resize(image.functions.size());
	symbols.metadata.upvalueNamesByFunction.resize(image.functions.size());
	image.toolingSymbols = encodeBlua32SymbolsImage(symbols);
	return encodeBlua32TestRom(domain, image).bytes;
}

std::vector<u8> makeMinimalDataRom(const CartManifest& manifest) {
	return encodeBlua32TestDataRom(manifest);
}

std::vector<u8> makeMinimalDataRom() {
	return encodeBlua32TestDataRom();
}

} // namespace bmsx::test
