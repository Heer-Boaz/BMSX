#include "machine/cpu/call_state.h"
#include "machine/cpu/thread.h"

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

void CallFrame::initializeControl(const FrameEntryControl& entry) {
	registers = thread->stack.subspan(entry.stackBase, entry.capacity);
	if (controlOffset <= MAIN_RAM_SIZE - FRAME_CONTROL_BYTES) {
		entry.writeWords([this](FrameField field, u32 word) {
			writeLE32(nativeControl + static_cast<u32>(field), word);
		});
		controlMemory->invalidateRamWrite(controlOffset, FRAME_CONTROL_BYTES);
	} else {
		auto* ram = controlMemory->ramData();
		entry.writeWords([&](FrameField field, u32 word) {
			writeLE32(ram + ((controlOffset + static_cast<u32>(field)) & RAM_RECORD_WORD_MASK), word);
		});
		const u32 first = MAIN_RAM_SIZE - controlOffset;
		controlMemory->invalidateRamWrite(controlOffset, first);
		controlMemory->invalidateRamWrite(0, FRAME_CONTROL_BYTES - first);
	}
}

void CallFrame::growRegisterWindow(i32 capacity) {
	const u32 address = (controlOffset + static_cast<u32>(FrameField::StackCapacity)) & RAM_RECORD_WORD_MASK;
	writeLE32(controlMemory->ramData() + address, (readControl(FrameField::StackCapacity) & ~FRAME_WINDOW_MASK) | static_cast<u32>(capacity));
	const int base = stackBase();
	registers = thread->stack.subspan(base, capacity);
	if (this == thread->currentFrame) thread->setStackTop(base + capacity);
	controlMemory->invalidateRamWrite(address, sizeof(u32));
}

} // namespace bmsx
