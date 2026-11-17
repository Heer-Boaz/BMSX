#pragma once

#include "common/primitives.h"

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
	ExecuteFunction,
	ExceptionReturn,
	Concat,
	ConcatRange,
	CreateClosure,
	WriteWords,
	Count,
};

} // namespace bmsx
