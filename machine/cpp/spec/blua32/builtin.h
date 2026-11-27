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
	CoroutineResume = 12,
	CoroutineYield = 13,
	CoroutineStatus = 14,
	CoroutineRunning = 15,
	CoroutineIsYieldable = 16,
	GetGlobal = 17,
	FrameCount = 18,
	GetFrameRegister = 19,
	SetFrameRegister = 20,
	GetFrameUpvalue = 21,
	SetFrameUpvalue = 22,
	FrameHeader = 23,
	NumberType = 24,
	StringFromBytes = 25,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 26u;

} // namespace bmsx
