#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "machine/common/numeric.h"
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
	InvalidImageOperand,
};

inline constexpr size_t DECODED_DISPATCH_OP_COUNT = OPCODE_COUNT + 6u
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
	u16 confidence;

	constexpr bool observed() const { return confidence != 0; }
	constexpr bool stable() const { return confidence >= STABLE_CONFIDENCE; }
	bool operator==(const NativeNumericTypes&) const = default;

private:
	friend struct DecodedInstruction;
	static constexpr u16 STABLE_CONFIDENCE = 4u;
	static constexpr u16 MAX_CONFIDENCE = 16u;
};

struct DecodedInstruction {
	// One active word for every opcode. Its signed storage also lends an
	// address to the mutable table-slot hint; Bx and feedback use its bits.
	class Payload {
	public:
		constexpr Payload() = default;
		static constexpr Payload bx(u32 value) { return Payload(toSignedWord(value)); }
		static constexpr Payload sbx(i32 value) { return Payload(value); }
		static constexpr Payload tableSlot(i32 slot) { return Payload(slot); }

	private:
		friend struct DecodedInstruction;
		constexpr explicit Payload(i32 word) : m_word(word) {}
		i32 m_word = 0;
	};
	Payload payload{};
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

	constexpr u32 bx() const { return static_cast<u32>(payload.m_word); }
	constexpr void setBx(u32 value) { payload = Payload::bx(value); }
	constexpr i32 sbx() const { return payload.m_word; }
	constexpr void setSbx(i32 value) { payload = Payload::sbx(value); }
	constexpr i32 tableCacheSlot() const { return payload.m_word; }
	constexpr i32& tableCacheSlot() { return payload.m_word; }

	// ADD/SUB/MUL do not encode a Bx operand. A fresh decode leaves their
	// type pair unseen (zero confidence), independently of either tag.
	NativeNumericTypes nativeNumericTypes() const {
		const u32 bits = static_cast<u32>(payload.m_word);
		return {static_cast<ValueTag>(bits & NUMERIC_TAG_MASK),
			static_cast<ValueTag>((bits >> NUMERIC_RIGHT_TAG_SHIFT) & NUMERIC_TAG_MASK),
			static_cast<u16>(bits >> NUMERIC_CONFIDENCE_SHIFT)};
	}

	// Only a completed arithmetic instruction contributes a sample.
	// Report whether this sample confirms the stable candidate, including
	// when the executing code was compiled before the site became stable.
	bool observeNativeNumericTypes(Value lhs, Value rhs) {
		const u32 bits = static_cast<u32>(payload.m_word);
		const u32 pair = bits & NUMERIC_PAIR_MASK;
		const u32 sample = static_cast<u32>(valueTag(lhs)) | (static_cast<u32>(valueTag(rhs)) << NUMERIC_RIGHT_TAG_SHIFT);
		const u32 confidence = bits >> NUMERIC_CONFIDENCE_SHIFT;
		if (pair == sample) {
			if (confidence < NativeNumericTypes::MAX_CONFIDENCE)
				payload.m_word = toSignedWord(bits + (1u << NUMERIC_CONFIDENCE_SHIFT));
			return confidence + 1u >= NativeNumericTypes::STABLE_CONFIDENCE;
		}
		// Contradictory samples age the candidate. A short startup type
		// change can recover; an alternating pair never becomes stable.
		const u32 next = confidence > 2u ? pair | ((confidence >> 1u) << NUMERIC_CONFIDENCE_SHIFT)
			: sample | (1u << NUMERIC_CONFIDENCE_SHIFT);
		payload.m_word = toSignedWord(next);
		return false;
	}

private:
	static constexpr u32 NUMERIC_TAG_MASK = 0xffu;
	static constexpr u32 NUMERIC_RIGHT_TAG_SHIFT = 8u;
	static constexpr u32 NUMERIC_CONFIDENCE_SHIFT = 16u;
	static constexpr u32 NUMERIC_PAIR_MASK = 0xffffu;
};

static_assert(MAX_EXT_REGISTER_BC <= INT16_MAX);
static_assert(sizeof(DecodedInstruction) == 16u);

} // namespace bmsx
