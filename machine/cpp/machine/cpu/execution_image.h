#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

enum class DecodedDispatchOp : uint8_t {
	FusedShlBxor = OPCODE_COUNT,
	FusedAddShl,
	FusedShrBxor,
};

inline constexpr size_t DECODED_DISPATCH_OP_COUNT = OPCODE_COUNT + 3u;
extern const std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> DECODED_DISPATCH_BASE_CYCLES;

inline constexpr uint8_t decodedDispatchOp(uint8_t first, uint8_t second) {
	switch (static_cast<OpCode>(first)) {
		case OpCode::SHL:
			return second == static_cast<uint8_t>(OpCode::BXOR)
				? static_cast<uint8_t>(DecodedDispatchOp::FusedShlBxor)
				: first;
		case OpCode::ADD:
			return second == static_cast<uint8_t>(OpCode::SHL)
				? static_cast<uint8_t>(DecodedDispatchOp::FusedAddShl)
				: first;
		case OpCode::SHR:
			return second == static_cast<uint8_t>(OpCode::BXOR)
				? static_cast<uint8_t>(DecodedDispatchOp::FusedShrBxor)
				: first;
		default:
			return first;
	}
}

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
	uint8_t dispatchOp = 0;
	uint8_t width = 0;
	uint8_t disp = 0;
};

struct Blua32ExecutionImage;

struct Blua32FunctionRecordLatch {
	Blua32ExecutionImage* image = nullptr;
	u32 address = 0;
	u32 codeAddress = 0;
	u32 codeByteCount = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	u32 flags = 0;
	u32 upvalueTableAddress = 0;
	u32 upvalueCount = 0;
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
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	u32 functionTableAddress = 0;
	u32 functionCount = 0;
	u32 textAddress = 0;
	u32 textByteCount = 0;
	std::vector<Value> constPool;
	std::vector<u32> globalSlots;
	std::vector<u32> systemGlobalSlots;
	std::vector<DecodedInstructionPage> decodedPages;
	size_t decodedWordCount = 0;
	std::vector<TableLoadInlineCache> tableLoadCaches;
};

} // namespace bmsx
