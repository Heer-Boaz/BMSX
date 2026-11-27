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

	CoroutineStatus = 7,
	CoroutineRunning = 8,
	GetGlobal = 9,
	FrameCount = 10,
	GetFrameRegister = 11,
	SetFrameRegister = 12,
	GetFrameUpvalue = 13,
	FrameHeader = 14,
	NumberType = 15,
	StringFromBytes = 16,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 17u;

} // namespace bmsx
