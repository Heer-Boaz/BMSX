#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#include "common/primitives.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_block.h"
#include "machine/cpu/native_code_lookup.h"
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

struct NativeNumericTypes {
	ValueTag left, right;
	bool stable;
};

struct DecodedInstruction {
	// Each opcode consumes exactly one of these payloads. Decode initializes
	// that member; field instructions and arithmetic may update their hints.
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

	// ADD/SUB/MUL do not encode a Bx operand. Their decoded word holds
	// the type pair instead; it is initialized by decode before warm-up.
	NativeNumericTypes nativeNumericTypes() const {
		return {static_cast<ValueTag>(bx & 0xffu), static_cast<ValueTag>((bx >> 8u) & 0xffu),
			(bx >> 16u) >= NUMERIC_STABLE_SCORE};
	}
	void observeNativeNumericTypes(Value lhs, Value rhs) {
		const u32 pair = static_cast<u32>(valueTag(lhs)) | (static_cast<u32>(valueTag(rhs)) << 8u);
		const u32 score = bx >> 16u;
		if ((bx & 0xffffu) == pair) {
			if (score < NUMERIC_SCORE_LIMIT) bx += 1u << 16u;
		} else if (score > 2u) {
			// Contradictory samples age the candidate. A short startup type
			// change can recover; an alternating pair never becomes stable.
			bx = (bx & 0xffffu) | ((score >> 1u) << 16u);
		} else {
			bx = pair | (1u << 16u);
		}
	}

private:
	static constexpr u32 NUMERIC_STABLE_SCORE = 4u;
	static constexpr u32 NUMERIC_SCORE_LIMIT = 16u;
};

static_assert(MAX_EXT_REGISTER_BC <= INT16_MAX);
static_assert(sizeof(DecodedInstruction) == 16u);

struct Blua32ExecutionImage;

struct Blua32FunctionRecordLatch {
	Blua32ExecutionImage* image = nullptr;
	MappedBusSignals busSignals = MAPPED_BUS_MASTER_CPU;
	bool romBacked = false; // True when the function data is backed by immutable ROM.
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
// ROM prototype words and image-owned dispatch cell addresses, never a closure or code pointer.
struct NativeRomCallBinding {
	static constexpr u32 slotCount = 64u;
	u32 functionAddress = ~0u;
	u32 codeAddress = 0u;
	u32 numParams = 0u;
	u32 maxStack = 0u;
	u32 flags = 0u;
	std::array<void* const*, CARTRIDGE_SLOT_COUNT> entryCells{};
};

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
	// Borrowed image-lifetime dispatch cells. Retiring regions zeros entries,
	// but leaves the cells available to suspended native continuations.
	void** nativeCode = nullptr;
	std::unique_ptr<NativeBlockPage> nativeBlocks;

	void retireNativeRegion(const NativeCodeRegion* region) {
		for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
			auto& block = nativeBlocks->entries[entry];
			if (!block || block->region.get() != region) continue;
			nativeCode[entry] = nullptr;
			block.reset();
			--nativeBlocks->count;
			auto& instruction = words[entry];
			instruction.dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeWarm);
			instruction.dispatchCycles = instruction.baseCycles;
			nativeVisits[entry] = 0;
		}
		if (nativeBlocks->count == 0u) {
			nativeBlocks.reset();
		}
	}

	void retireNativeBlocks(u32 firstWord = 0, u32 endWord = DECODED_PAGE_WORDS + 1u) {
		if (!nativeBlocks) return;
		const u32 firstEntry = firstWord > 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u)
			? firstWord - 2u * (NATIVE_BLOCK_MAX_INSTRUCTIONS + 1u) : 0u;
		const u32 endEntry = endWord < DECODED_PAGE_WORDS ? endWord : DECODED_PAGE_WORDS;
		for (u32 word = firstEntry; word < endEntry; ++word) {
			const auto& block = nativeBlocks->entries[word];
			if (!block || word + block->sourceWords <= firstWord) continue;
			retireNativeRegion(block->region.get());
			if (!nativeBlocks) return;
		}
	}

#endif
};

struct Blua32ExecutionImage {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	static size_t nativeExecutionDomainOffset();
	static size_t nativeRomCallBindingsOffset();
#endif
	ExecutionDomainId executionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 irqFunctionAddress = 0;
	u32 staticEnd = 0;
	u32 constantBase = 0;
	ConstValueSpan constPool;
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	// Immutable during a job. Refresh only after a write to the guest bank
	// and when the previous job no longer reads this compilation input.
	ValueSlots workerConstants;
	bool workerConstantsCurrent = false;
#endif
	u32 globalMapBase = 0;
	u32 globalNameCount = 0, systemNameCount = 0;
	u32 globalMapBytes() const { return 4u * (globalNameCount + systemNameCount); }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Dispatch storage outlives the decoded descriptors which borrow its cells.
	std::unique_ptr<NativeCodeLookup> nativeCodeLookup;
	std::array<NativeRomCallBinding, NativeRomCallBinding::slotCount> nativeRomCallBindings{};
#endif
	std::unordered_map<u64, DecodedInstructionPage> decodedPages;
};

} // namespace bmsx
