#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "machine/cpu/value.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

constexpr size_t DECODED_PAGE_WORDS = MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES;
inline constexpr u8 DECODED_REFRESH_DECODE = 1u;
inline constexpr u8 DECODED_REFRESH_FUSION = 2u;
// A fused dispatch can inspect two instructions, each with one WIDE prefix.
inline constexpr u32 DECODED_DEPENDENCY_PREDECESSOR_WORDS = 3u;

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

} // namespace bmsx
