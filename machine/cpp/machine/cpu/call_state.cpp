#include "machine/cpu/call_state.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/thread.h"

#include <algorithm>

namespace bmsx {

void CallFrame::bindControl(Memory& memory, u32 offset) {
	controlMemory = &memory;
	controlOffset = offset & RAM_RECORD_WORD_MASK;
	nativeControl = memory.ramData() + controlOffset;
}

bool CallFrame::hasControlFlag(u32 mask) const {
	return (readControl(FrameField::Flags) & mask) != 0;
}

void CallFrame::addControlFlags(u32 flags) {
	writeControl(FrameField::Flags, readControl(FrameField::Flags) | flags);
}

void CallFrame::initializeControl(u32 function, u32 pc, u32 callSite, u32 flags,
	i32 varargBase, i32 varargCount, i32 returnBase, i32 returnCount, i32 top, u32 closure, i32 base, i32 capacity) {
	auto* ram = controlMemory->ramData();
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Function)) & RAM_RECORD_WORD_MASK), function);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::CallSite)) & RAM_RECORD_WORD_MASK), callSite);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::OpenHead)) & RAM_RECORD_WORD_MASK), 0);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Protected)) & RAM_RECORD_WORD_MASK), static_cast<u32>(-1));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Flags)) & RAM_RECORD_WORD_MASK), flags);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Pc)) & RAM_RECORD_WORD_MASK), pc);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::VarargBase)) & RAM_RECORD_WORD_MASK), static_cast<u32>(varargBase));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::VarargCount)) & RAM_RECORD_WORD_MASK), static_cast<u32>(varargCount));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::ReturnBase)) & RAM_RECORD_WORD_MASK), static_cast<u32>(returnBase));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::ReturnCount)) & RAM_RECORD_WORD_MASK), static_cast<u32>(returnCount));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Top)) & RAM_RECORD_WORD_MASK), static_cast<u32>(top));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Closure)) & RAM_RECORD_WORD_MASK), closure);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::StackBase)) & RAM_RECORD_WORD_MASK), static_cast<u32>(base));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::StackCapacity)) & RAM_RECORD_WORD_MASK), static_cast<u32>(capacity));
	registers = thread->stack.subspan(base, capacity);
	const u32 first = std::min(FRAME_CONTROL_BYTES, MAIN_RAM_SIZE - controlOffset);
	controlMemory->invalidateRamWrite(controlOffset, first, false);
	if (first != FRAME_CONTROL_BYTES) controlMemory->invalidateRamWrite(0, FRAME_CONTROL_BYTES - first, false);
}

void CallFrame::growRegisterWindow(i32 capacity) {
	const u32 address = (controlOffset + static_cast<u32>(FrameField::StackCapacity)) & RAM_RECORD_WORD_MASK;
	writeLE32(controlMemory->ramData() + address, (readControl(FrameField::StackCapacity) & ~FRAME_WINDOW_MASK) | static_cast<u32>(capacity));
	const int base = stackBase();
	registers = thread->stack.subspan(base, capacity);
	if (this == thread->currentFrame) thread->setStackTop(base + capacity);
	controlMemory->invalidateRamWrite(address, sizeof(u32), false);
}

} // namespace bmsx
