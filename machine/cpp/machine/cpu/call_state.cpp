#include "machine/cpu/call_state.h"
#include "machine/memory/memory.h"

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

void CallFrame::initializeControl(u32 function, u32 pc, u32 callSite, bool completion) {
	auto* ram = controlMemory->ramData();
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Function)) & RAM_RECORD_WORD_MASK), function);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::CallSite)) & RAM_RECORD_WORD_MASK), callSite);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::OpenHead)) & RAM_RECORD_WORD_MASK), 0);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Protected)) & RAM_RECORD_WORD_MASK), static_cast<u32>(-1));
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Flags)) & RAM_RECORD_WORD_MASK), completion ? FRAME_COMPLETION : 0);
	writeLE32(ram + ((controlOffset + static_cast<u32>(FrameField::Pc)) & RAM_RECORD_WORD_MASK), pc);
	const u32 first = std::min(FRAME_CONTROL_BYTES, MAIN_RAM_SIZE - controlOffset);
	controlMemory->invalidateRamWrite(controlOffset, first);
	if (first != FRAME_CONTROL_BYTES) controlMemory->invalidateRamWrite(0, FRAME_CONTROL_BYTES - first);
}

} // namespace bmsx
