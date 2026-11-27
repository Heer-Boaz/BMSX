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
	CoroutineResume = 13,
	CoroutineYield = 14,
	CoroutineStatus = 15,
	CoroutineRunning = 16,
	CoroutineIsYieldable = 17,
	GetGlobal = 18,
	SetGlobal = 19,
	FrameCount = 20,
	GetFrameRegister = 21,
	SetFrameRegister = 22,
	GetFrameUpvalue = 23,
	SetFrameUpvalue = 24,
	FrameHeader = 25,
	NumberType = 26,
	StringSlice = 27,
	StringFromBytes = 28,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 29u;

} // namespace bmsx
