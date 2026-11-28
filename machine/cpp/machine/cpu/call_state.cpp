#include "machine/cpu/call_state.h"
#include "machine/cpu/thread.h"

namespace bmsx {
namespace {

template<typename Write>
void writeFrameControl(CallFrame& frame, Write&& write) {
	const auto offset = frame.controlOffset;
	auto& memory = *frame.controlMemory;
	if (offset <= MAIN_RAM_SIZE - FRAME_CONTROL_BYTES) {
		write([&frame](FrameField field, u32 word) {
			writeLE32(frame.nativeControl + static_cast<u32>(field), word);
		});
		memory.invalidateRamWrite(offset, FRAME_CONTROL_BYTES);
	} else {
		auto* ram = memory.ramData();
		write([&](FrameField field, u32 word) {
			writeLE32(ram + ((offset + static_cast<u32>(field)) & RAM_RECORD_WORD_MASK), word);
		});
		const u32 first = MAIN_RAM_SIZE - offset;
		memory.invalidateRamWrite(offset, first);
		memory.invalidateRamWrite(0, FRAME_CONTROL_BYTES - first);
	}
}

} // namespace

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
	m_registerBase = 0;
	registers = thread->stack.subspan(entry.stackBase, entry.capacity);
	writeFrameControl(*this, [&](auto&& write) { entry.writeWords(write); });
}

void CallFrame::setRegisterBase(i32 base, i32 width) {
	writeControl(FrameField::RegisterBase, static_cast<u32>(base));
	m_registerBase = base;
	registers = thread->stack.subspan(stackBase(), width - base);
}

void CallFrame::rebindRegisters() {
	m_registerBase = readWindow(FrameField::RegisterBase);
	registers = thread->stack.subspan(stackBase(), stackCapacity());
}

void CallFrame::growRegisterWindow(i32 capacity) {
	const u32 address = (controlOffset + static_cast<u32>(FrameField::StackCapacity)) & RAM_RECORD_WORD_MASK;
	writeLE32(controlMemory->ramData() + address,
		(readControl(FrameField::StackCapacity) & ~FRAME_WINDOW_MASK) | static_cast<u32>(capacity + registerBase()));
	const int base = stackBase();
	registers = thread->stack.subspan(base, capacity);
	if (this == thread->currentFrame) thread->setStackTop(base + capacity);
	controlMemory->invalidateRamWrite(address, sizeof(u32));
}

} // namespace bmsx
