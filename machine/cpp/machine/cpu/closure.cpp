#include "machine/cpu/closure.h"

#include "machine/memory/memory.h"

namespace bmsx {
Value Upvalue::value() const {
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(address + UPVALUE_VALUE_TAG)),
		memory.readRamRecordWord(address + UPVALUE_VALUE_WORD));
}

void Upvalue::setValue(Value value) {
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, valuePayload(value));
	memory.writeRamRecordByte(address + UPVALUE_VALUE_TAG, static_cast<u8>(valueTag(value)));
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// As with Table's native field map, the host ABI defines the complete object
// layout including its GCObject base. GCC/Clang support these offsets directly.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
Upvalue::NativeOffsets Upvalue::nativeOffsets() {
	return {offsetof(Upvalue, open), offsetof(Upvalue, index), offsetof(Upvalue, frame), offsetof(Upvalue, address)};
}

size_t Closure::nativePrototypeOffset() { return offsetof(Closure, prototype); }
size_t Closure::nativeUpvaluesOffset() { return offsetof(Closure, upvalues); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif
} // namespace bmsx
