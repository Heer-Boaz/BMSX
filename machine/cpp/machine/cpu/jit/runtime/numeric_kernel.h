#pragma once

#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

// Kernels run inside generated code; return the status through the native
// ABI instead of unwinding through frames with no C++ unwind information.
using NativeNumericKernel = u32 (*)(const Value* arguments, Value* result) noexcept;
NativeNumericKernel nativeNumericKernel(OpCode);
u32 nativeWordOperandKernel(const Value*, u32* result) noexcept;

} // namespace bmsx
