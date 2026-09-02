#include "common/endian.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/bmsx/memory_map.h"
#include "rompack/format.h"
#include "rompack/image.h"
#include "rompack/tooling/blua32_image.h"
#include "rompack/tooling/blua32_symbols.h"
#include "support/blua32_test_rom.h"

#include <algorithm>
#include <array>
#include <span>
#include <stdexcept>

int main() {
	const bmsx::u32 instructionWord = bmsx::packInstructionWord(0x3fu, 0x3fu, 0x3fu, 0x3fu, 0xffu);
	if (instructionWord != 0xffffffffu) {
		throw std::runtime_error("BLua32 instruction fields did not pack to one raw word");
	}
	std::array<bmsx::u8, bmsx::INSTRUCTION_BYTES> instructionBytes{};
	bmsx::writeInstructionWord(instructionBytes, 0, instructionWord);
	if (instructionBytes != std::array<bmsx::u8, bmsx::INSTRUCTION_BYTES>{0xffu, 0xffu, 0xffu, 0xffu}) {
		throw std::runtime_error("BLua32 instruction word was not written big-endian");
	}
	if (bmsx::readInstructionWord(instructionBytes, 0) != instructionWord) {
		throw std::runtime_error("BLua32 instruction word did not round-trip");
	}

	const bmsx::SourceRange outerCallRange{"cart.lua", {4, 2}, {4, 14}};
	const bmsx::SourceRange innerCallRange{"cart.lua", {11, 3}, {11, 18}};
	const std::vector<bmsx::Blua32InlineCallSite> inlineCallSites{
		{"outer", outerCallRange},
		{"inner", innerCallRange},
	};
	bmsx::Blua32SymbolsImage symbols;
	symbols.version = bmsx::BLUA32_SYMBOLS_VERSION;
	symbols.metadata.functionIds = {"entry"};
	symbols.metadata.functionDisplayNames = {"entryDisplay"};
	symbols.metadata.debugRanges = {outerCallRange, std::nullopt};
	symbols.metadata.debugInlineCallSiteChains = {{}, inlineCallSites};
	symbols.metadata.debugInlineCallSiteChainIds = {1, 0};
	symbols.metadata.statementPointsByFunction = {{
		{2, innerCallRange, inlineCallSites},
	}};
	symbols.metadata.resumePointsByFunction = {{
		{3, innerCallRange, bmsx::OpCode::MOV, {0, 1}, {0}, {1}, inlineCallSites},
	}};
	symbols.metadata.localSlotsByFunction = {{
		{"value", 1, innerCallRange, outerCallRange, inlineCallSites},
	}};

	const std::vector<bmsx::u8> encodedSymbols = bmsx::encodeBlua32SymbolsImage(symbols);
	const bmsx::Blua32SymbolsImage decodedSymbols = bmsx::decodeBlua32SymbolsImage(encodedSymbols);
	if (decodedSymbols.version != bmsx::BLUA32_SYMBOLS_VERSION
		|| bmsx::blua32FunctionDisplayNameById(decodedSymbols, "entry") != "entryDisplay"
		|| decodedSymbols.metadata.debugRanges.size() != 2u
		|| decodedSymbols.metadata.debugInlineCallSiteChains.size() != 2u
		|| !decodedSymbols.metadata.debugInlineCallSiteChains[0].empty()
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1].size() != 2u
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1][0].calleeFunctionId != "outer"
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1][0].callRange.start.column != 2
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1][1].calleeFunctionId != "inner"
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1][1].callRange.end.column != 18
		|| decodedSymbols.metadata.debugInlineCallSiteChainIds
			!= std::vector<bmsx::u32>{1u, 0u}
		|| decodedSymbols.metadata.statementPointsByFunction[0][0].inlineCallSites[1].calleeFunctionId
			!= "inner"
		|| decodedSymbols.metadata.resumePointsByFunction[0][0].inlineCallSites[0].calleeFunctionId
			!= "outer"
		|| decodedSymbols.metadata.localSlotsByFunction[0][0].inlineCallSites[1].callRange.path
			!= "cart.lua") {
		throw std::runtime_error("BLua32 inline call-site symbols did not round-trip");
	}

	std::array<bmsx::u8, bmsx::CART_ROM_HEADER_SIZE - 1u> truncated{};
	for (const size_t size : {size_t{0}, size_t{32}, truncated.size()}) {
		bool rejected = false;
		try {
			bmsx::parseCartHeader(truncated.data(), size);
		} catch (const std::runtime_error&) {
			rejected = true;
		}
		if (!rejected) {
			throw std::runtime_error("Truncated ROM header was accepted");
		}
	}

	std::array<bmsx::u8, bmsx::BLUA32_IMAGE_HEADER_SIZE> unsupportedBlua32{};
	bmsx::writeLE32(
		unsupportedBlua32.data() + bmsx::BLUA32_IMAGE_MAGIC_OFFSET,
		bmsx::BLUA32_IMAGE_MAGIC
	);
	bmsx::writeLE32(
		unsupportedBlua32.data() + bmsx::BLUA32_IMAGE_VERSION_OFFSET,
		bmsx::BLUA32_IMAGE_VERSION + 1u
	);
	bool unsupportedRejected = false;
	try {
		bmsx::decodeBlua32Image(unsupportedBlua32, bmsx::SYSTEM_ROM_BASE);
	} catch (const std::runtime_error&) {
		unsupportedRejected = true;
	}
	if (!unsupportedRejected) {
		throw std::runtime_error("Unsupported BLua32 image version was accepted");
	}

	bmsx::test::Blua32TestImage functionRangeSource;
	functionRangeSource.text.resize(bmsx::INSTRUCTION_BYTES);
	functionRangeSource.functions = {{.firstWord = 0u, .wordCount = 1u}};
	bmsx::test::Blua32TestRom functionRangeRom = bmsx::test::encodeBlua32TestRom(
		bmsx::RomImageDomain::System,
		functionRangeSource
	);
	std::span<bmsx::u8> functionRangeImage(
		functionRangeRom.bytes.data() + bmsx::test::BLUA32_TEST_IMAGE_OFFSET,
		functionRangeRom.boot.imageByteCount
	);
	const bmsx::u32 functionRecordOffset = functionRangeRom.functionAddresses[0]
		- (bmsx::SYSTEM_ROM_BASE + bmsx::test::BLUA32_TEST_IMAGE_OFFSET);
	bmsx::writeLE32(
		functionRangeImage.data()
			+ functionRecordOffset
			+ bmsx::BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
		functionRangeRom.textAddress + 2u * bmsx::INSTRUCTION_BYTES
	);
	bool functionRangeRejected = false;
	try {
		bmsx::decodeBlua32Image(
			functionRangeImage,
			bmsx::SYSTEM_ROM_BASE + bmsx::test::BLUA32_TEST_IMAGE_OFFSET
		);
	} catch (const std::runtime_error&) {
		functionRangeRejected = true;
	}
	if (!functionRangeRejected) {
		throw std::runtime_error("BLua32 function text above the image text span was accepted");
	}

	bmsx::CartManifest romPackage;
	romPackage.hardware.emplace_back(bmsx::CartridgeRomDeviceConfig{});
	bmsx::CartRomHeader emptyHeader;
	try {
		bmsx::assertCartridgePackageFitsHardware(
			static_cast<size_t>(bmsx::CART_ROM_SIZE) + 1u,
			emptyHeader,
			romPackage.hardware);
	} catch (const std::runtime_error&) {
		bmsx::assertCartridgePackageFitsHardware(
			static_cast<size_t>(bmsx::CART_ROM_SIZE) + 1u,
			emptyHeader,
			{});
		bool formatLimitRejected = false;
		try {
			bmsx::assertCartridgePackageFitsHardware(
				static_cast<size_t>(bmsx::CART_PACKAGE_MAX_BYTE_COUNT) + 1u,
				emptyHeader,
				{});
		} catch (const std::runtime_error&) {
			formatLimitRejected = true;
		}
		if (!formatLimitRejected) {
			throw std::runtime_error("Package beyond the 32-bit format limit was accepted");
		}
		bmsx::CartRomHeader executableHeader;
		executableHeader.blua32ImageOffset = bmsx::CART_ROM_HEADER_SIZE;
		bool executableWithoutRomRejected = false;
		try {
			bmsx::assertCartridgePackageFitsHardware(
				bmsx::CART_ROM_HEADER_SIZE,
				executableHeader,
				{});
		} catch (const std::runtime_error&) {
			executableWithoutRomRejected = true;
		}
		if (!executableWithoutRomRejected) {
			throw std::runtime_error("Executable package without a ROM device was accepted");
		}
		bmsx::CartManifest hardwareOnlyManifest;
		std::vector<bmsx::u8> contradictoryPackage =
			bmsx::test::encodeBlua32TestDataRom(hardwareOnlyManifest);
		bmsx::CartRomHeader contradictoryHeader = bmsx::parseCartHeader(
			contradictoryPackage.data(),
			contradictoryPackage.size()
		);
		contradictoryHeader.blua32ImageOffset = bmsx::CART_ROM_HEADER_SIZE;
		bmsx::writeCartRomHeader(
			contradictoryPackage.data(),
			contradictoryHeader
		);
		bool contradictoryAdmissionRejected = false;
		try {
			(void)bmsx::parseCartridgePackage(
				contradictoryPackage.data(),
				contradictoryPackage.size()
			);
		} catch (const std::runtime_error&) {
			contradictoryAdmissionRejected = true;
		}
		if (!contradictoryAdmissionRejected) {
			throw std::runtime_error("Contradictory cartridge package passed admission");
		}
		return 0;
	}
	throw std::runtime_error("ROM-bearing package beyond the cartridge aperture was accepted");
}
