#pragma once

#include "rompack/tooling/declaration_kind.h"
#include "rompack/tooling/blua32_image.h"

#include "common/primitives.h"
#include "rompack/tooling/source_range.h"
#include "rompack/tooling/trace_statement.h"
#include "rompack/tooling/word_range.h"
#include "spec/blua32/opcode.h"

#include <optional>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

constexpr const char* BLUA32_SYMBOLS_IMAGE_ID = "__blua32_symbols__";

struct Blua32InlineCallSite {
	std::string calleeFunctionId;
	SourceRange callRange;
};

struct Blua32LocalSlotDebug {
	std::string name;
	bool isConst;
	i32 registerIndex = 0;
	SourceRange definition;
	SourceRange scope;
	std::vector<Blua32InlineCallSite> inlineCallSites;
	std::vector<ProgramWordRange> liveWordRanges;
};

struct Blua32OuterBindingDebug {
	u32 declarationIndex;
	std::optional<Blua32UpvalueRecord> location;
	std::vector<Blua32InlineCallSite> inlineCallSites;
	std::vector<ProgramWordRange> liveWordRanges;
};

struct Blua32LexicalDeclarationDebug {
	std::string functionId;
	std::string name;
	LexicalDeclarationKind kind;
	bool isConst;
	std::optional<SourceRange> definition;
};

struct Blua32ResumePoint {
	i32 wordOffset = 0;
	SourceRange range;
	OpCode op = OpCode::WIDE;
	std::vector<i32> liveRegisters;
	std::vector<i32> uses;
	std::vector<i32> defs;
	std::vector<Blua32InlineCallSite> inlineCallSites;
	std::optional<std::string> resumeId;
};

struct Blua32StatementPoint {
	i32 wordOffset = 0;
	SourceRange range;
	std::vector<Blua32InlineCallSite> inlineCallSites;
};

struct Blua32DebugMetadata {
	TraceStatementSelection traceStatements = std::string("erase");
	std::vector<std::string> preloadModules;
	std::vector<std::string> functionIds;
	std::vector<std::string> functionDisplayNames;
	std::vector<std::optional<SourceRange>> functionDefinitions;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
	std::unordered_map<std::string, std::string> staticFunctionIdBySlot;
	std::vector<std::optional<SourceRange>> debugRanges;
	std::vector<std::vector<Blua32InlineCallSite>> debugInlineCallSiteChains;
	std::vector<u32> debugInlineCallSiteChainIds;
	std::vector<std::vector<Blua32StatementPoint>> statementPointsByFunction;
	std::vector<std::vector<Blua32ResumePoint>> resumePointsByFunction;
	std::vector<std::vector<Blua32LocalSlotDebug>> localSlotsByFunction;
	std::vector<std::vector<Blua32OuterBindingDebug>> outerBindingsByFunction;
	std::vector<Blua32LexicalDeclarationDebug> lexicalDeclarations;
	std::vector<std::vector<u32>> upvalueBindingsByFunction;
};

struct Blua32StaticLayoutToken {
	u32 lo = 0;
	u32 hi = 0;
};

struct Blua32ModuleFunction {
	std::string path;
	u32 address = 0;
};

struct Blua32InitParticipant {
	std::string functionId;
	std::string slotName;
	bool system = false;
};

struct Blua32SymbolsImage {
	u32 imageAddress = 0;
	std::vector<u32> functionAddresses;
	std::vector<Blua32ModuleFunction> moduleFunctions;
	u32 initFunctionAddress = 0;
	std::vector<Blua32InitParticipant> initParticipants;
	Blua32StaticLayoutToken staticLayoutToken;
	Blua32DebugMetadata metadata;
};

auto decodeBlua32SymbolsImage(std::span<const u8> bytes) -> Blua32SymbolsImage;
auto encodeBlua32SymbolsImage(const Blua32SymbolsImage& symbols) -> std::vector<u8>;
auto blua32SlotLiveAtPc(std::span<const ProgramWordRange> ranges, u32 codeAddress, u32 pc) -> bool;
auto blua32SourceRangeAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> const std::optional<SourceRange>&;
auto blua32InlineCallSitesAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> std::span<const Blua32InlineCallSite>;
auto blua32FunctionDisplayNameById(
	const Blua32SymbolsImage& symbols,
	const std::string& functionId
) -> const std::string&;

} // namespace bmsx
