#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_block.h"
#endif

namespace bmsx {

enum class DecodedDispatchOp : uint8_t {
	FusedShlBxor = OPCODE_COUNT,
	FusedAddShl,
	FusedShrBxor,
	Observe,
	ReservedMemory,
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	NativeWarm,
	NativeBlock,
#endif
};

inline constexpr size_t DECODED_DISPATCH_OP_COUNT = OPCODE_COUNT + 5u
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	+ 2u
#endif
	;
extern const std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> DECODED_DISPATCH_BASE_CYCLES;

inline constexpr bool decodedDispatchCanFuse(uint8_t op) {
	return op == static_cast<uint8_t>(OpCode::SHL)
		|| op == static_cast<uint8_t>(OpCode::ADD)
		|| op == static_cast<uint8_t>(OpCode::SHR);
}

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
	// Each opcode consumes exactly one of these payloads. Decode initializes
	// that member; field instructions may then update their cache prediction.
	union {
		uint32_t bx = 0;
		int32_t sbx;
		int32_t tableCacheSlot;
	};
	uint16_t a = 0;
	// Raw fields are nonnegative; RK consumers receive sign-extended selectors.
	int16_t b = 0;
	int16_t c = 0;
	uint8_t op = 0;
	uint8_t dispatchOp = 0;
	uint8_t width = 0;
	uint8_t disp = 0;
	uint8_t baseCycles = 0;
	uint8_t dispatchCycles = 0;
};

static_assert(MAX_EXT_REGISTER_BC <= INT16_MAX);
static_assert(sizeof(DecodedInstruction) == 16u);

struct Blua32ExecutionImage;

struct Blua32FunctionRecordLatch {
	Blua32ExecutionImage* image = nullptr;
	MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU;
	bool cacheableRead = false; // Host-only: all record reads stay on one cacheable page.
	u32 address = 0;
	u32 codeAddress = 0;
	u32 numParams = 0;
	u32 maxStack = 0;
	u32 flags = 0;
	u32 upvalueTableAddress = 0;
	u32 upvalueCount = 0;
};

constexpr size_t DECODED_PAGE_SHIFT = MAPPED_PAGE_BYTE_SHIFT - 2u;
constexpr size_t DECODED_PAGE_WORDS = 1u << DECODED_PAGE_SHIFT;
inline constexpr u8 DECODED_REFRESH_DECODE = 1u;
inline constexpr u8 DECODED_REFRESH_FUSION = 2u;
// A fused dispatch can inspect two instructions, each with one WIDE prefix.
inline constexpr u32 DECODED_DEPENDENCY_PREDECESSOR_WORDS = 3u;

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
struct NativeBlockPage {
	std::array<std::unique_ptr<NativeBlock>, DECODED_PAGE_WORDS> entries{};
	u32 count = 0;
};
#endif

struct DecodedInstructionPage {
	explicit DecodedInstructionPage(bool isCacheable, MappedPageWriteWatch pageWriteWatch)
		: cacheable(isCacheable)
		, writeWatch(pageWriteWatch) {
		refreshState.fill(DECODED_REFRESH_DECODE);
	}

	std::array<DecodedInstruction, DECODED_PAGE_WORDS> words{};
	std::array<uint8_t, DECODED_PAGE_WORDS> refreshState{};
	std::array<uint32_t, DECODED_PAGE_WORDS> sourceWords{};
	std::array<uint32_t, DECODED_PAGE_WORDS> bodyWords{};
	bool cacheable;
	MappedPageWriteWatch writeWatch;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	std::array<u8, DECODED_PAGE_WORDS> nativeVisits{};
	std::unique_ptr<NativeBlockPage> nativeBlocks;

	void retireNativeBlocks(u32 firstWord = 0, u32 endWord = DECODED_PAGE_WORDS + 1u) {
		if (!nativeBlocks) return;
		const u32 firstEntry = firstWord > 2u * NATIVE_BLOCK_MAX_INSTRUCTIONS
			? firstWord - 2u * NATIVE_BLOCK_MAX_INSTRUCTIONS : 0u;
		const u32 endEntry = endWord < DECODED_PAGE_WORDS ? endWord : DECODED_PAGE_WORDS;
		for (u32 word = firstEntry; word < endEntry; ++word) {
			auto& block = nativeBlocks->entries[word];
			if (!block || word + block->sourceWords <= firstWord) continue;
			block.reset();
			--nativeBlocks->count;
			auto& instruction = words[word];
			instruction.dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeWarm);
			instruction.dispatchCycles = instruction.baseCycles;
			nativeVisits[word] = 0;
		}
		if (nativeBlocks->count == 0u) nativeBlocks.reset();
	}
#endif
};

struct Blua32ExecutionImage {
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	std::vector<Value> constPool;
	std::vector<u32> globalSlots;
	std::vector<u32> systemGlobalSlots;
	std::unordered_map<u64, DecodedInstructionPage> decodedPages;
};

} // namespace bmsx
