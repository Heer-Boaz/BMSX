#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/blua32_image.h"
#include "machine/cpu/execution_address_space.h"
#include "machine/cpu/value.h"

namespace bmsx {

struct Closure;

struct DecodedInstruction {
	uint32_t word = 0;
	uint32_t bx = 0;
	int32_t sbx = 0;
	int32_t rkB = 0;
	int32_t rkC = 0;
	uint32_t tableCacheIndex = 0;
	uint16_t a = 0;
	uint16_t b = 0;
	uint16_t c = 0;
	uint8_t op = 0;
	uint8_t width = 0;
	uint8_t disp = 0;
};

struct Blua32ExecutionImage;

struct Blua32RuntimeFunction {
	u32 address = 0;
	u32 codeAddress = 0;
	u32 codeByteCount = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	bool isVararg = false;
	bool staticClosure = false;
	std::vector<Blua32UpvalueRecord> upvalues;
	Blua32ExecutionImage* image = nullptr;
	u32 index = 0;
};

struct TableLoadInlineCache {
	Table* table = nullptr;
	uint32_t version = 0;
	Value value = valueNil();
};

constexpr size_t DECODED_PAGE_SHIFT = 8;
constexpr size_t DECODED_PAGE_WORDS = 1u << DECODED_PAGE_SHIFT;
constexpr size_t DECODED_PAGE_MASK = DECODED_PAGE_WORDS - 1u;

struct DecodedInstructionPage {
	std::array<DecodedInstruction, DECODED_PAGE_WORDS> words{};
};

struct Blua32ExecutionImage {
	Blua32ImageLayout layout;
	Blua32BootHeader boot;
	int executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	std::vector<Blua32RuntimeFunction> functions;
	std::vector<Value> constPool;
	std::vector<u32> globalSlots;
	std::vector<u32> systemGlobalSlots;
	std::vector<DecodedInstructionPage> decodedPages;
	size_t decodedWordCount = 0;
	std::vector<TableLoadInlineCache> tableLoadCaches;
	std::vector<Closure*> staticClosures;
};

} // namespace bmsx
