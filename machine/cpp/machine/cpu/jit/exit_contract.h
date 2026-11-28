#pragma once

#include <optional>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

enum class NativeBlockExit : u8 {
	Continue,
	ScalarBoundary,
	Halt,
	Call,
	CompletedCall,
	Return,
	ReadField,
	WriteField,
	ReadMemory,
	WriteMemory,
	SkipInstruction,
	WriteUpvalue,
	Vararg,
	InvalidConstant,
	InvalidOperand,
	ReadIndex,
	WriteIndex,
	ReadInteger,
	WriteInteger,
	Length,
	ControlFault,
	ExceptionReturn,
	CreateClosure,
	WriteWords,
	WriteControl,
	WriteGlobal,
	WriteSystemGlobal,
	ReadUpvalue,
	IterateTable,
	SupervisorCall,
	RegisterJump,
	Count,
};

// The stable operand pair used by an ADD, SUB or MUL specialization.
struct NativeArithmeticFeedback {
	ValueTag left, right;
	bool operator==(const NativeArithmeticFeedback&) const = default;
};

// Runtime operands accompany the exit kind. Counts for activation transfers
// are actual counts; -1 selects the open window. Guest frame words retain
// the instruction encoding at the frame-control boundary.
union NativeExitOperands {
	struct Replay {
		bool hasCompletedInstruction;
		std::optional<NativeArithmeticFeedback> arithmetic{};
	} replay;
	struct Call { u16 callee; i16 supplied, requested; } call;
	struct Return { u16 first; i16 produced; } returned;
	struct Vararg { u16 first; i16 requested; } vararg;
	struct Table {
		i16 value, receiver, key;
		std::optional<ValueTag> resultProof{};
		std::optional<u16> reusePeerWord{};
		union {
			u32 sourcePc = 0; // read feedback
			u8 extraHashSlots; // write operand
		};
	} table;
	struct Length { u16 result, source; } length;
	struct Iterator { u16 base, first, count; } iterator;
	struct Memory {
		u32 displacement;
		u16 slot;
		i16 address;
		MemoryAccessKind format;
		u16 wordCount;
	} memory;
	struct Control { u16 slot, field; } control;
	struct SupervisorCall { u16 source, width; } supervisorCall;
	struct RegisterJump { u16 target; i16 link; } registerJump;
	struct Upvalue { u16 slot, capture; } upvalue;
	struct Global { u32 index; u16 slot; } global;
	struct Closure { u32 address; u16 result, flags; } closure;
};

} // namespace bmsx
