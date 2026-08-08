#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
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
	uint32_t sourceWord = 0;
	uint32_t bodyWord = 0;
	uint32_t bx = 0;
	int32_t sbx = 0;
	int32_t rkB = 0;
	int32_t rkC = 0;
	uint32_t tableCacheIndex = UINT32_MAX;
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
	MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU;
	u32 address = 0;
	u32 codeAddress = 0;
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

constexpr size_t DECODED_PAGE_SHIFT = MAPPED_PAGE_BYTE_SHIFT - 2u;
constexpr size_t DECODED_PAGE_WORDS = 1u << DECODED_PAGE_SHIFT;

struct DecodedInstructionPage {
	explicit DecodedInstructionPage(bool isCacheable, u8* pageWriteWatch)
		: cacheable(isCacheable)
		, writeWatch(pageWriteWatch) {
		decodeRequired.fill(1u);
	}

	std::array<DecodedInstruction, DECODED_PAGE_WORDS> words{};
	std::array<uint8_t, DECODED_PAGE_WORDS> decodeRequired{};
	std::array<uint8_t, DECODED_PAGE_WORDS> fusionRequired{};
	std::vector<TableLoadInlineCache> tableLoadCaches;
	bool cacheable;
	u8* writeWatch;
};

inline bool decodedInstructionNeedsRefresh(
	const DecodedInstructionPage& page,
	size_t pageOffset,
	bool allowFusion
) {
	return page.decodeRequired[pageOffset] != 0u
		|| (allowFusion && page.fusionRequired[pageOffset] != 0u);
}

struct Blua32ExecutionImage {
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	std::vector<Value> constPool;
	std::vector<u32> globalSlots;
	std::vector<u32> systemGlobalSlots;
	std::unordered_map<u64, DecodedInstructionPage> decodedPages;
};

} // namespace bmsx
