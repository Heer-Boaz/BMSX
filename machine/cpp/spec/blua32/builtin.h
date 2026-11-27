#pragma once

#include <cstddef>
#include <cstdint>

namespace bmsx {

enum class BuiltinFunctionId : uint8_t {
	// Returning native leaves are a dense prefix, before allocating and
	// observing services.
	GetMetatable = 0,
	StringByte = 1,
	ToInteger = 2,
	Next = 3,
	RawGet = 4,
	RawSet = 5,
	Select = 6,
	Type = 7,
	StringChar = 8,
	Error = 9,
	PCall = 10,
	XPCall = 11,
	SetStringIndex = 12,
	CoroutineCreate = 13,
	CoroutineResume = 14,
	CoroutineYield = 15,
	CoroutineStatus = 16,
	CoroutineRunning = 17,
	CoroutineClose = 18,
	CoroutineIsYieldable = 19,
	GetGlobal = 20,
	SetGlobal = 21,
	FrameCount = 22,
	GetFrameRegister = 23,
	SetFrameRegister = 24,
	GetFrameUpvalue = 25,
	SetFrameUpvalue = 26,
	FrameHeader = 27,
	NumberType = 28,
	SetMetatable = 29,
	StringSlice = 30,
	StringFromBytes = 31,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 32u;

} // namespace bmsx
