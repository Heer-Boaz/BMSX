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
	FrameCount = 8,
	GetFrameRegister = 9,
	SetFrameRegister = 10,
	GetFrameUpvalue = 11,
	FrameHeader = 12,
};

constexpr size_t BUILTIN_FUNCTION_COUNT = 13u;

} // namespace bmsx
