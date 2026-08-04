#pragma once

#include "common/primitives.h"
#include "rompack/tooling/source_range.h"
#include "spec/blua32/opcode.h"

#include <optional>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

constexpr const char* BLUA32_SYMBOLS_IMAGE_ID = "__blua32_symbols__";
constexpr u32 BLUA32_SYMBOLS_VERSION = 3u;

struct Blua32InlineCallSite {
	std::string calleeFunctionId;
	SourceRange callRange;
};

struct Blua32LocalSlotDebug {
	std::string name;
	i32 registerIndex = 0;
	SourceRange definition;
	SourceRange scope;
	std::vector<Blua32InlineCallSite> inlineCallSites;
};

struct Blua32ResumePoint {
	i32 wordOffset = 0;
	SourceRange range;
	OpCode op = OpCode::WIDE;
	std::vector<i32> liveRegisters;
	std::vector<i32> uses;
	std::vector<i32> defs;
	std::vector<Blua32InlineCallSite> inlineCallSites;
};

struct Blua32StatementPoint {
	i32 wordOffset = 0;
	SourceRange range;
	std::vector<Blua32InlineCallSite> inlineCallSites;
};

struct Blua32DebugMetadata {
	std::vector<std::string> functionIds;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
	std::unordered_map<std::string, std::string> staticFunctionIdBySlot;
	std::vector<std::optional<SourceRange>> debugRanges;
	std::vector<std::vector<Blua32InlineCallSite>> debugInlineCallSiteChains;
	std::vector<u32> debugInlineCallSiteChainIds;
	std::vector<std::vector<Blua32StatementPoint>> statementPointsByFunction;
	std::vector<std::vector<Blua32ResumePoint>> resumePointsByFunction;
	std::vector<std::vector<Blua32LocalSlotDebug>> localSlotsByFunction;
	std::vector<std::vector<std::string>> upvalueNamesByFunction;
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
	u32 version = 0;
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
auto blua32SourceRangeAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> std::optional<SourceRange>;
auto blua32InlineCallSitesAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> std::span<const Blua32InlineCallSite>;

} // namespace bmsx
