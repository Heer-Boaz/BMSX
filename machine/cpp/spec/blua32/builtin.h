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
	SetGlobal = 18,
	FrameCount = 19,
	GetFrameRegister = 20,
	SetFrameRegister = 21,
	GetFrameUpvalue = 22,
	SetFrameUpvalue = 23,
	FrameHeader = 24,
	NumberType = 25,
	StringFromBytes = 26,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 27u;

} // namespace bmsx
