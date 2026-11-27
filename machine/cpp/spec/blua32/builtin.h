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

	CoroutineResume = 7,
	CoroutineYield = 8,
	CoroutineStatus = 9,
	CoroutineRunning = 10,
	GetGlobal = 11,
	FrameCount = 12,
	GetFrameRegister = 13,
	SetFrameRegister = 14,
	GetFrameUpvalue = 15,
	FrameHeader = 16,
	NumberType = 17,
	StringFromBytes = 18,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 19u;

} // namespace bmsx
