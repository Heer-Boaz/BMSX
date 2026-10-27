#include "common/endian.h"
#include "common/serializer/binencoder.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/bmsx/memory_map.h"
#include "rompack/format.h"
#include "rompack/image.h"
#include "rompack/tokens.h"
#include "rompack/tooling/toc_encode.h"
#include "rompack/tooling/blua32_image.h"
#include "rompack/tooling/blua32_symbols.h"
#include "support/blua32_test_rom.h"

#include <algorithm>
#include <array>
#include <span>
#include <stdexcept>

int main() {
	for (const bool programModule : {false, true}) {
		bmsx::RomTocEntry source;
		source.resid = "source";
		source.type = bmsx::AssetType::Lua;
		const auto token = bmsx::hashAssetId(source.resid);
		source.id_token_lo = token.lo;
		source.id_token_hi = token.hi;
		source.program_module = programModule;
		source.start = 0x100;
		source.end = 0x120;
		source.source_path = "entry.lua";
		source.metabuffer_start = 0x200;
		source.metabuffer_end = 0x208;
		source.collision_bin_start = 0x300;
		source.collision_bin_end = 0x304;
		source.update_timestamp = 0x100000003;
		bmsx::RomTocPayload directory;
		directory.entries.push_back(source);
		const auto bytes = bmsx::encodeRomToc(directory);
		const auto decoded = bmsx::decodeRomToc(bytes);
		const auto& entry = decoded.entries[0];
		if (entry.program_module != programModule || entry.start != source.start || entry.end != source.end
			|| entry.source_path != source.source_path || entry.update_timestamp != source.update_timestamp
			|| entry.metabuffer_start != source.metabuffer_start || entry.metabuffer_end != source.metabuffer_end
			|| entry.collision_bin_start != source.collision_bin_start || entry.collision_bin_end != source.collision_bin_end
			|| bmsx::encodeRomToc(decoded) != bytes) {
			throw std::runtime_error("ROM source membership and physical ranges did not round-trip");
		}
	}

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

	const auto outerCallRange = std::make_shared<const bmsx::SourceRange>(bmsx::SourceRange{"cart.lua", {4, 2}, {4, 14}});
	const auto innerCallRange = std::make_shared<const bmsx::SourceRange>(bmsx::SourceRange{"cart.lua", {11, 3}, {11, 18}});
	const auto inlineCallSites = std::make_shared<const std::vector<bmsx::Blua32InlineCallSite>>(std::initializer_list<bmsx::Blua32InlineCallSite>{
		{"outer", outerCallRange},
		{"inner", innerCallRange},
	});
	const auto ranges24 = std::make_shared<const std::vector<bmsx::ProgramWordRange>>(std::initializer_list<bmsx::ProgramWordRange>{{2, 4}});
	const auto ranges2468 = std::make_shared<const std::vector<bmsx::ProgramWordRange>>(std::initializer_list<bmsx::ProgramWordRange>{{2, 4}, {6, 8}});
	const auto ranges08 = std::make_shared<const std::vector<bmsx::ProgramWordRange>>(std::initializer_list<bmsx::ProgramWordRange>{{0, 8}});
	const auto noInlineCalls = std::make_shared<const std::vector<bmsx::Blua32InlineCallSite>>();
	const auto noWordRanges = std::make_shared<const std::vector<bmsx::ProgramWordRange>>();
	const auto noRegisters = std::make_shared<const std::vector<bmsx::i32>>();
	const auto registers01 = std::make_shared<const std::vector<bmsx::i32>>(std::initializer_list<bmsx::i32>{0, 1});
	const auto registers0 = std::make_shared<const std::vector<bmsx::i32>>(std::initializer_list<bmsx::i32>{0});
	const auto registers1 = std::make_shared<const std::vector<bmsx::i32>>(std::initializer_list<bmsx::i32>{1});
	bmsx::Blua32SymbolsImage symbols;
	symbols.metadata.optLevel = 2;
	symbols.metadata.functionIds = {"entry"};
	symbols.metadata.traceStatements = std::vector<std::string>{"fixture.compile", "fixture.bind"};
	symbols.metadata.preloadModules = {"fixture/observer"};
	symbols.metadata.compiledModulePaths = {"fixture/entry", "fixture/observer", "fixture/constants"};
	symbols.metadata.functionDisplayNames = {"entryDisplay"};
	symbols.metadata.debugRanges = {outerCallRange, nullptr};
	symbols.metadata.debugInlineCallSiteChains = {noInlineCalls, inlineCallSites};
	symbols.metadata.debugInlineCallSiteChainIds = {1, 0};
	symbols.metadata.statementPointsByFunction = {{
		{2, std::make_shared<const bmsx::SourceRange>(*innerCallRange),
			std::make_shared<const std::vector<bmsx::Blua32InlineCallSite>>(*inlineCallSites)},
	}};
	symbols.metadata.resumePointsByFunction = {{
		{3, innerCallRange, bmsx::OpCode::MOV, registers01, registers0, registers1, inlineCallSites, std::nullopt},
		{4, innerCallRange, bmsx::OpCode::RET, std::make_shared<const std::vector<bmsx::i32>>(*registers0),
			registers0, noRegisters, noInlineCalls, "startup.entry.return"},
	}};
	symbols.metadata.localSlotsByFunction = {{
		{2, "value", true, 1, innerCallRange, outerCallRange, inlineCallSites, ranges2468},
	}};
	symbols.metadata.outerBindingsByFunction = {{
		{0, bmsx::Blua32UpvalueRecord{true, 17}, inlineCallSites, ranges24},
		{0, bmsx::Blua32UpvalueRecord{false, 0}, noInlineCalls, ranges08},
		{0, std::nullopt, inlineCallSites, noWordRanges},
		{1, std::nullopt, noInlineCalls, noWordRanges},
	}};
	symbols.metadata.functionDefinitions = {innerCallRange};
	symbols.metadata.lexicalDeclarations = {
		{"module:cart/module", "value", bmsx::LexicalDeclarationKind::Local, true, innerCallRange},
		{"module:cart/module", "unused", bmsx::LexicalDeclarationKind::Local, true, outerCallRange},
	};
	symbols.metadata.upvalueBindingsByFunction = {{0u}};
	symbols.metadata.staticScopes = {
		{
			{"shape", outerCallRange, bmsx::StaticDeclarationKind::Type, std::nullopt},
			{"buffer", innerCallRange, bmsx::StaticDeclarationKind::Bss, 0x00400010u},
			{"buffer", outerCallRange, bmsx::StaticDeclarationKind::Data, 0x00400020u},
			{"frozen", innerCallRange, bmsx::StaticDeclarationKind::Rodata, 0x1fc00100u},
		},
		{0, 2},
		{{{1, 2, std::make_shared<const std::vector<bmsx::ProgramWordRange>>(*ranges2468)}, {3, 0, ranges08}}},
	};

	const std::vector<bmsx::u8> encodedSymbols = bmsx::encodeBlua32SymbolsImage(symbols);
	const bmsx::BinValue symbolsPayload = bmsx::decodeBinary(encodedSymbols.data(), encodedSymbols.size());
	if (symbolsPayload.asObject().contains("version")) {
		throw std::runtime_error("BLua32 symbols must not carry a schema version");
	}
	const bmsx::Blua32SymbolsImage decodedSymbols = bmsx::decodeBlua32SymbolsImage(encodedSymbols);
	const auto& metadata = decodedSymbols.metadata;
	if (metadata.compiledModulePaths != symbols.metadata.compiledModulePaths) {
		throw std::runtime_error("BLua32 symbols lost complete compilation input membership");
	}
	if (metadata.statementPointsByFunction[0][0].range != metadata.functionDefinitions[0]
		|| metadata.localSlotsByFunction[0][0].definition != metadata.functionDefinitions[0]
		|| metadata.statementPointsByFunction[0][0].inlineCallSites != metadata.debugInlineCallSiteChains[1]
		|| metadata.resumePointsByFunction[0][0].inlineCallSites != metadata.debugInlineCallSiteChains[1]
		|| metadata.localSlotsByFunction[0][0].liveWordRanges != metadata.staticScopes.bindingsByFunction[0][0].visibleWordRanges
		|| metadata.resumePointsByFunction[0][0].uses != metadata.resumePointsByFunction[0][1].liveRegisters) {
		throw std::runtime_error("BLua32 symbols expanded shared nodes during decoding");
	}
	bmsx::Blua32SourceRange retainedRange;
	bmsx::Blua32InlineCallSites retainedChain;
	{
		const auto temporary = bmsx::decodeBlua32SymbolsImage(encodedSymbols);
		retainedRange = temporary.metadata.functionDefinitions[0];
		retainedChain = temporary.metadata.statementPointsByFunction[0][0].inlineCallSites;
	}
	if (retainedRange->start.line != 11 || (*retainedChain)[1].callRange != retainedRange) {
		throw std::runtime_error("BLua32 shared nodes lost ownership when their decoded image was released");
	}
	const auto& statics = decodedSymbols.metadata.staticScopes;
	if (statics.declarations.size() != 4 || statics.declarations[0].name != "shape"
		|| statics.declarations[0].kind != bmsx::StaticDeclarationKind::Type
		|| statics.declarations[0].address.has_value()
		|| statics.declarations[1].kind != bmsx::StaticDeclarationKind::Bss || statics.declarations[1].address != 0x00400010u
		|| statics.declarations[2].kind != bmsx::StaticDeclarationKind::Data || statics.declarations[2].address != 0x00400020u
		|| statics.declarations[3].kind != bmsx::StaticDeclarationKind::Rodata || statics.declarations[3].address != 0x1fc00100u
		|| statics.declarations[1].definition->start.line != 11 || statics.globals != std::vector<bmsx::u32>{0, 2}
		|| statics.bindingsByFunction.size() != 1 || statics.bindingsByFunction[0].size() != 2
		|| statics.bindingsByFunction[0][0].declarationIndex != 1 || statics.bindingsByFunction[0][0].inlineDepth != 2
		|| statics.bindingsByFunction[0][0].visibleWordRanges->size() != 2
		|| (*statics.bindingsByFunction[0][0].visibleWordRanges)[0].start != 2
		|| (*statics.bindingsByFunction[0][0].visibleWordRanges)[1].end != 8) {
		throw std::runtime_error("BLua32 static declarations, linked addresses and inline visibility did not round-trip");
	}
	if (decodedSymbols.metadata.resumePointsByFunction[0][0].resumeId.has_value()
		|| decodedSymbols.metadata.resumePointsByFunction[0][1].resumeId != "startup.entry.return") {
		throw std::runtime_error("BLua32 generated continuation identity did not round-trip");
	}
	if (decodedSymbols.metadata.optLevel != 2
		|| decodedSymbols.metadata.traceStatements != symbols.metadata.traceStatements
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
		|| captures[0].inlineCallSites->size() != 2 || (*captures[0].inlineCallSites)[1].calleeFunctionId != "inner"
		|| captures[0].liveWordRanges->size() != 1 || (*captures[0].liveWordRanges)[0].start != 2 || (*captures[0].liveWordRanges)[0].end != 4
		|| captures[1].location->inStack || captures[1].location->index != 0 || !captures[1].inlineCallSites->empty()
		|| (*captures[1].liveWordRanges)[0].end != 8
		|| captures[2].location.has_value() || !captures[2].liveWordRanges->empty()) {
		throw std::runtime_error("BLua32 capture origins, inline chains and physical locations did not round-trip");
	}
	if (captures[3].declarationIndex != 1 || captures[3].location.has_value() || !captures[3].liveWordRanges->empty()
		|| decodedSymbols.metadata.lexicalDeclarations[1].name != "unused") {
		throw std::runtime_error("BLua32 uncaptured lexical declaration did not round-trip");
	}
	for (bmsx::u32 word = 0; word <= 9; ++word) {
		if (bmsx::blua32SlotLiveAtPc(*captures[0].liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES) != (word >= 2 && word < 4)
			|| bmsx::blua32SlotLiveAtPc(*captures[2].liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES)) {
			throw std::runtime_error("BLua32 capture locations use the same half-open ranges as locals");
		}
	}
	const auto& slot = decodedSymbols.metadata.localSlotsByFunction[0][0];
	if (slot.argumentIndex != 2) throw std::runtime_error("BLua32 formal argument identity did not round-trip");
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
	if (slot.liveWordRanges->size() != 2 || (*slot.liveWordRanges)[0].start != 2 || (*slot.liveWordRanges)[1].end != 8) {
		throw std::runtime_error("BLua32 local word locations did not round-trip");
	}
	for (bmsx::u32 word = 0; word <= 9; ++word) {
		const bool expected = (word >= 2 && word < 4) || (word >= 6 && word < 8);
		if (bmsx::blua32SlotLiveAtPc(*slot.liveWordRanges, 0x2000, 0x2000 + word * bmsx::INSTRUCTION_BYTES) != expected) {
			throw std::runtime_error("BLua32 local word locations must be half-open with explicit gaps");
		}
	}
	bmsx::Blua32LocalSlotDebug foldedSlot{};
	foldedSlot.liveWordRanges = noWordRanges;
	if (bmsx::blua32SlotLiveAtPc(*foldedSlot.liveWordRanges, 0x2000, 0x2000)) {
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
		|| !decodedSymbols.metadata.debugInlineCallSiteChains[0]->empty()
		|| decodedSymbols.metadata.debugInlineCallSiteChains[1]->size() != 2u
		|| (*decodedSymbols.metadata.debugInlineCallSiteChains[1])[0].calleeFunctionId != "outer"
		|| (*decodedSymbols.metadata.debugInlineCallSiteChains[1])[0].callRange->start.column != 2
		|| (*decodedSymbols.metadata.debugInlineCallSiteChains[1])[1].calleeFunctionId != "inner"
		|| (*decodedSymbols.metadata.debugInlineCallSiteChains[1])[1].callRange->end.column != 18
		|| decodedSymbols.metadata.debugInlineCallSiteChainIds
			!= std::vector<bmsx::u32>{1u, 0u}
		|| (*decodedSymbols.metadata.statementPointsByFunction[0][0].inlineCallSites)[1].calleeFunctionId
			!= "inner"
		|| (*decodedSymbols.metadata.resumePointsByFunction[0][0].inlineCallSites)[0].calleeFunctionId
			!= "outer"
		|| (*decodedSymbols.metadata.localSlotsByFunction[0][0].inlineCallSites)[1].callRange->path
			!= "cart.lua") {
		throw std::runtime_error("BLua32 inline call-site symbols did not round-trip");
	}

	symbols.metadata.functionDefinitions[0].reset();
	symbols.metadata.lexicalDeclarations[0].definition.reset();
	symbols.metadata.lexicalDeclarations[0].kind = bmsx::LexicalDeclarationKind::Receiver;
	const auto removedSymbols = bmsx::decodeBlua32SymbolsImage(bmsx::encodeBlua32SymbolsImage(symbols));
	if (removedSymbols.metadata.functionDefinitions[0]
		|| removedSymbols.metadata.lexicalDeclarations[0].definition
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
