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
	CoroutineIsYieldable = 18,
	GetGlobal = 19,
	SetGlobal = 20,
	FrameCount = 21,
	GetFrameRegister = 22,
	SetFrameRegister = 23,
	GetFrameUpvalue = 24,
	SetFrameUpvalue = 25,
	FrameHeader = 26,
	NumberType = 27,
	StringSlice = 28,
	StringFromBytes = 29,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 30u;

} // namespace bmsx
