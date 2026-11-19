#include "machine/cpu/closure.h"

#include "machine/memory/memory.h"

namespace bmsx {
Value Upvalue::load(const Memory& memory, u32 address) {
	address &= MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;
	return valueFromTag(static_cast<ValueTag>(memory.readRamRecordByte(address + UPVALUE_VALUE_TAG)),
		memory.readRamRecordWord(address + UPVALUE_VALUE_WORD));
}

void Upvalue::store(Memory& memory, u32 address, Value value) {
	address &= MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, valuePayload(value));
	memory.writeRamRecordByte(address + UPVALUE_VALUE_TAG, static_cast<u8>(valueTag(value)));
}

void Closure::initializeRecord() {
	const u32 flags = static_cast<u32>(prototype->executionDomainId + 1) | (canonical ? 4u : 0u);
	memory.writeRamRecordWord(address, static_cast<u32>(ValueTag::Closure) | (flags << 16));
	memory.writeRamRecordWord(address + 4u, 0u);
	memory.writeRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS, prototype->functionAddress);
}

u32 Closure::captureAddress(u32 index) const {
	return memory.readRamRecordWord(address + CLOSURE_CAPTURE_WORDS + index * sizeof(u32));
}

void Closure::setCaptureAddress(u32 index, u32 reference) {
	memory.writeRamRecordWord(address + CLOSURE_CAPTURE_WORDS + index * sizeof(u32), reference);
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// As with Table's native field map, the host ABI defines the complete object
// layout including its GCObject base. GCC/Clang support these offsets directly.
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
Upvalue::NativeOffsets Upvalue::nativeOffsets() {
	return {offsetof(Upvalue, open), offsetof(Upvalue, index), offsetof(Upvalue, frame)};
}

size_t Closure::nativePrototypeOffset() { return offsetof(Closure, prototype); }
size_t Closure::nativeAddressOffset() { return offsetof(Closure, address); }
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif
} // namespace bmsx
