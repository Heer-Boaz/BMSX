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

	Error = 5,

	CoroutineStatus = 6,
	CoroutineRunning = 7,
	GetGlobal = 8,
	FrameCount = 9,
	GetFrameRegister = 10,
	SetFrameRegister = 11,
	GetFrameUpvalue = 12,
	FrameHeader = 13,
	StringFromBytes = 14,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 15u;

} // namespace bmsx
