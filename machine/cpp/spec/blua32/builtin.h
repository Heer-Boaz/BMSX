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
	Select = 5,
	Type = 6,

	Error = 7,
	PCall = 8,
	XPCall = 9,
	CoroutineResume = 10,
	CoroutineYield = 11,
	CoroutineStatus = 12,
	CoroutineRunning = 13,
	CoroutineIsYieldable = 14,
	GetGlobal = 15,
	FrameCount = 16,
	GetFrameRegister = 17,
	SetFrameRegister = 18,
	GetFrameUpvalue = 19,
	FrameHeader = 20,
	NumberType = 21,
	StringFromBytes = 22,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 23u;

} // namespace bmsx
