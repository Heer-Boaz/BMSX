#pragma once

#include "common/primitives.h"
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
	InvalidLength,
	AllocateTable,
	ControlFault,
	ControlBoundary,
	ExceptionReturn,
	Concat,
	ConcatRange,
	CreateClosure,
	WriteWords,
	WriteControl,
	WriteGlobal,
	WriteSystemGlobal,
	Count,
};

// Runtime operands accompany the exit kind. Counts for activation transfers
// are actual counts; -1 selects the open window. Guest frame words retain
// the instruction encoding at the frame-control boundary.
union NativeExitOperands {
	struct Replay { bool hasCompletedInstruction; } replay;
	struct Call { u16 callee; i16 supplied, requested; } call;
	struct Return { u16 first; i16 produced; } returned;
	struct Vararg { u16 first; i16 requested; } vararg;
	struct Table { i16 value, receiver, key; } table;
	struct Memory {
		u32 displacement;
		u16 slot;
		i16 address;
		MemoryAccessKind format;
		u16 wordCount;
	} memory;
	struct Control { u16 slot, field; } control;
	struct Upvalue { u16 slot, capture; } upvalue;
	struct Global { u32 index; u16 slot; } global;
	struct Allocation { u16 result, arraySize, hashSize; } allocation;
	struct Concat { u16 result; i16 left, right; } concat;
	struct ConcatRange { u16 result, first, count; } concatRange;
	struct Closure { u32 address; u16 result, flags; } closure;
};

} // namespace bmsx
