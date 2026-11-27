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
	Type = 5,

	Error = 6,
	PCall = 7,
	XPCall = 8,
	CoroutineResume = 9,
	CoroutineYield = 10,
	CoroutineStatus = 11,
	CoroutineRunning = 12,
	CoroutineIsYieldable = 13,
	GetGlobal = 14,
	FrameCount = 15,
	GetFrameRegister = 16,
	SetFrameRegister = 17,
	GetFrameUpvalue = 18,
	FrameHeader = 19,
	NumberType = 20,
	StringFromBytes = 21,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 22u;

} // namespace bmsx
