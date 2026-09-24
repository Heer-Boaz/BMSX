#include "common/endian.h"
#include "common/serializer/binencoder.h"
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
	symbols.metadata.functionIds = {"entry"};
	symbols.metadata.traceStatements = std::vector<std::string>{"fixture.compile", "fixture.bind"};
	symbols.metadata.preloadModules = {"fixture/observer"};
	symbols.metadata.functionDisplayNames = {"entryDisplay"};
	symbols.metadata.debugRanges = {outerCallRange, std::nullopt};
	symbols.metadata.debugInlineCallSiteChains = {{}, inlineCallSites};
	symbols.metadata.debugInlineCallSiteChainIds = {1, 0};
	symbols.metadata.statementPointsByFunction = {{
		{2, innerCallRange, inlineCallSites},
	}};
	symbols.metadata.resumePointsByFunction = {{
		{3, innerCallRange, bmsx::OpCode::MOV, {0, 1}, {0}, {1}, inlineCallSites, std::nullopt},
		{4, innerCallRange, bmsx::OpCode::RET, {0}, {0}, {}, {}, "startup.entry.return"},
	}};
	symbols.metadata.localSlotsByFunction = {{
		{"value", true, 1, innerCallRange, outerCallRange, inlineCallSites, {{2, 4}, {6, 8}}},
	}};
	symbols.metadata.outerBindingsByFunction = {{
		{0, bmsx::Blua32UpvalueRecord{true, 17}, inlineCallSites, {{2, 4}}},
		{0, bmsx::Blua32UpvalueRecord{false, 0}, {}, {{0, 8}}},
		{0, std::nullopt, inlineCallSites, {}},
		{1, std::nullopt, {}, {}},
	}};
	symbols.metadata.functionDefinitions = {innerCallRange};
	symbols.metadata.lexicalDeclarations = {
		{"module:cart/module", "value", bmsx::LexicalDeclarationKind::Local, true, innerCallRange},
		{"module:cart/module", "unused", bmsx::LexicalDeclarationKind::Local, true, outerCallRange},
	};
	symbols.metadata.upvalueBindingsByFunction = {{0u}};

	const std::vector<bmsx::u8> encodedSymbols = bmsx::encodeBlua32SymbolsImage(symbols);
	const bmsx::BinValue symbolsPayload = bmsx::decodeBinary(encodedSymbols.data(), encodedSymbols.size());
	if (symbolsPayload.asObject().contains("version")) {
		throw std::runtime_error("BLua32 symbols must not carry a schema version");
	}
	const bmsx::Blua32SymbolsImage decodedSymbols = bmsx::decodeBlua32SymbolsImage(encodedSymbols);
	if (decodedSymbols.metadata.resumePointsByFunction[0][0].resumeId.has_value()
		|| decodedSymbols.metadata.resumePointsByFunction[0][1].resumeId != "startup.entry.return") {
		throw std::runtime_error("BLua32 generated continuation identity did not round-trip");
	}
	if (decodedSymbols.metadata.traceStatements != symbols.metadata.traceStatements
		|| decodedSymbols.metadata.preloadModules != symbols.metadata.preloadModules) {
		throw std::runtime_error("BLua32 compilation configuration did not round-trip");
	}
	for (const bmsx::TraceStatementSelection& selection : std::array<bmsx::TraceStatementSelection, 3>{
		std::string("erase"), std::string("emit"), std::vector<std::string>{},
	}) {
		symbols.metadata.traceStatements = selection;
		if (bmsx::decodeBlua32SymbolsImage(bmsx::encodeBlua32SymbolsImage(symbols)).metadata.traceStatements != selection) {
			throw std::runtime_error("BLua32 explicit erasure/emission/empty selection did not round-trip");
		}
	}
	const auto& captures = decodedSymbols.metadata.outerBindingsByFunction[0];
	if (captures.size() != 4 || captures[0].declarationIndex != 0
		|| !captures[0].location->inStack || captures[0].location->index != 17
		|| captures[0].inlineCallSites.size() != 2 || captures[0].inlineCallSites[1].calleeFunctionId != "inner"
		|| captures[0].liveWordRanges.size() != 1 || captures[0].liveWordRanges[0].start != 2 || captures[0].liveWordRanges[0].end != 4
		|| captures[1].location->inStack || captures[1].location->index != 0 || !captures[1].inlineCallSites.empty()
		|| captures[1].liveWordRanges[0].end != 8
		|| captures[2].location.has_value() || !captures[2].liveWordRanges.empty()) {
		throw std::runtime_error("BLua32 capture origins, inline chains and physical locations did not round-trip");
	}
	if (captures[3].declarationIndex != 1 || captures[3].location.has_value() || !captures[3].liveWordRanges.empty()
		|| decodedSymbols.metadata.lexicalDeclarations[1].name != "unused") {
		throw std::runtime_error("BLua32 uncaptured lexical declaration did not round-trip");
	}
	for (bmsx::u32 word = 0; word <= 9; ++word) {
		if (bmsx::blua32SlotLiveAtPc(captures[0].liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES) != (word >= 2 && word < 4)
			|| bmsx::blua32SlotLiveAtPc(captures[2].liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES)) {
			throw std::runtime_error("BLua32 capture locations use the same half-open ranges as locals");
		}
	}
	const auto& slot = decodedSymbols.metadata.localSlotsByFunction[0][0];
	std::vector<bmsx::ProgramWordRange> orderedRanges;
	bmsx::appendProgramWordRange(orderedRanges, 2, 3);
	bmsx::appendProgramWordRange(orderedRanges, 3, 4);
	bmsx::appendProgramWordRange(orderedRanges, 6, 8);
	if (orderedRanges.size() != 2 || orderedRanges[0].start != 2 || orderedRanges[0].end != 4
		|| orderedRanges[1].start != 6 || orderedRanges[1].end != 8) {
		throw std::runtime_error("BLua32 interval appends must coalesce adjacency but retain gaps");
	}
	for (const bool isConst : {false, true}) {
		symbols.metadata.localSlotsByFunction[0][0].isConst = isConst;
		symbols.metadata.lexicalDeclarations[0].isConst = isConst;
		const auto decoded = bmsx::decodeBlua32SymbolsImage(bmsx::encodeBlua32SymbolsImage(symbols));
		if (decoded.metadata.localSlotsByFunction[0][0].isConst != isConst
			|| decoded.metadata.lexicalDeclarations[0].isConst != isConst) {
			throw std::runtime_error("BLua32 declaration immutability did not round-trip");
		}
	}
	if (slot.liveWordRanges.size() != 2 || slot.liveWordRanges[0].start != 2 || slot.liveWordRanges[1].end != 8) {
		throw std::runtime_error("BLua32 local word locations did not round-trip");
	}
	for (bmsx::u32 word = 0; word <= 9; ++word) {
		const bool expected = (word >= 2 && word < 4) || (word >= 6 && word < 8);
		if (bmsx::blua32SlotLiveAtPc(slot.liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES) != expected) {
			throw std::runtime_error("BLua32 local word locations must be half-open with explicit gaps");
		}
	}
	bmsx::Blua32LocalSlotDebug foldedSlot{};
	if (bmsx::blua32SlotLiveAtPc(foldedSlot.liveWordRanges, 0x2000, 0x2000)) {
		throw std::runtime_error("BLua32 folded local must not invent a debug location");
	}
	if (decodedSymbols.metadata.functionDefinitions.size() != 1u
		|| decodedSymbols.metadata.functionDefinitions[0]->start.line != 11
		|| decodedSymbols.metadata.lexicalDeclarations.size() != 2u
		|| decodedSymbols.metadata.lexicalDeclarations[0].functionId != "module:cart/module"
		|| decodedSymbols.metadata.lexicalDeclarations[0].name != "value"
		|| decodedSymbols.metadata.lexicalDeclarations[0].kind != bmsx::LexicalDeclarationKind::Local
		|| decodedSymbols.metadata.lexicalDeclarations[0].definition->path != "cart.lua"
		|| decodedSymbols.metadata.lexicalDeclarations[0].definition->start.line != 11
		|| decodedSymbols.metadata.upvalueBindingsByFunction != std::vector<std::vector<bmsx::u32>>{{0u}}) {
		throw std::runtime_error("BLua32 captured-local provenance did not round-trip");
	}
	if (bmsx::blua32FunctionDisplayNameById(decodedSymbols, "entry") != "entryDisplay"
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

	symbols.metadata.functionDefinitions[0].reset();
	symbols.metadata.lexicalDeclarations[0].definition.reset();
	symbols.metadata.lexicalDeclarations[0].kind = bmsx::LexicalDeclarationKind::Receiver;
	const auto removedSymbols = bmsx::decodeBlua32SymbolsImage(bmsx::encodeBlua32SymbolsImage(symbols));
	if (removedSymbols.metadata.functionDefinitions[0].has_value()
		|| removedSymbols.metadata.lexicalDeclarations[0].definition.has_value()
		|| removedSymbols.metadata.lexicalDeclarations[0].kind != bmsx::LexicalDeclarationKind::Receiver) {
		throw std::runtime_error("BLua32 removed declaration did not round-trip");
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
