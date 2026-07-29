#pragma once

#include "common/primitives.h"
#include "spec/blua32/opcode.h"

#include <optional>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

constexpr const char* BLUA32_SYMBOLS_IMAGE_ID = "__blua32_symbols__";
constexpr u32 BLUA32_SYMBOLS_VERSION = 1u;

struct SourcePosition {
	i32 line = 0;
	i32 column = 0;
};

struct SourceRange {
	std::string path;
	SourcePosition start;
	SourcePosition end;
};

struct Blua32LocalSlotDebug {
	std::string name;
	i32 registerIndex = 0;
	SourceRange definition;
	SourceRange scope;
};

struct Blua32ResumePoint {
	i32 wordOffset = 0;
	SourceRange range;
	OpCode op = OpCode::WIDE;
	std::vector<i32> liveRegisters;
	std::vector<i32> uses;
	std::vector<i32> defs;
};

struct Blua32DebugMetadata {
	std::vector<std::string> functionIds;
	std::vector<std::string> globalNames;
	std::vector<std::string> systemGlobalNames;
	std::unordered_map<std::string, std::string> staticFunctionIdBySlot;
	std::vector<std::optional<SourceRange>> debugRanges;
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

struct Blua32SymbolsImage {
	u32 version = 0;
	u32 imageAddress = 0;
	std::vector<u32> functionAddresses;
	std::vector<Blua32ModuleFunction> moduleFunctions;
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

} // namespace bmsx
