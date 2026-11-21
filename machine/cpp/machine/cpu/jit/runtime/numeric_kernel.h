#pragma once

#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

// Kernels run inside generated code; return the status through the native
// ABI instead of unwinding through frames with no C++ unwind information.
enum class NativeNumericCompletion : u32 { Completed, InvalidOperand, ProfileReady };
using NativeNumericKernel = NativeNumericCompletion (*)(const Value* arguments, Value* result) noexcept;
struct DecodedInstruction;
using NativeSamplingKernel = NativeNumericCompletion (*)(const Value*, Value*, DecodedInstruction*) noexcept;
NativeNumericKernel nativeNumericKernel(OpCode);
NativeSamplingKernel nativeSamplingKernel(OpCode);
u32 nativeWordOperandKernel(const Value*, u32* result) noexcept;

} // namespace bmsx
