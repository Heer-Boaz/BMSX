#include "machine/cpu/closure.h"

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
namespace bmsx {
// As with Table's native field map, the host ABI defines the complete object
// layout including its GCObject base. GCC/Clang support these offsets directly.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
Upvalue::NativeOffsets Upvalue::nativeOffsets() {
	return {offsetof(Upvalue, open), offsetof(Upvalue, index), offsetof(Upvalue, frame), offsetof(Upvalue, value)};
}

Closure::NativeFunctionOffsets Closure::nativeFunctionOffsets() {
	return {offsetof(Closure, functionAddress), offsetof(Closure, codeAddress), offsetof(Closure, numParams),
		offsetof(Closure, maxStack), offsetof(Closure, flags), offsetof(Closure, executionDomainId)};
}

size_t Closure::nativeUpvaluesOffset() { return offsetof(Closure, upvalues); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
} // namespace bmsx
#endif
