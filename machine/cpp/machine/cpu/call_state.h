#pragma once

#include <cstdint>
#include <array>

#include "common/primitives.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/memory.h"

namespace bmsx {

struct Blua32ExecutionImage;
struct DecodedInstructionPage;
struct Closure;
struct Thread;

enum class ProtectedCallKind : uint8_t {
	PCall,
	XPCallBody,
	XPCallHandler,
};

enum class ProtectedField : u32 { Flags = 0, Caller = 4, Base = 8, Wanted = 12, Handler = 16 };
constexpr u32 PROTECTED_CALL_BYTES = 20;
constexpr u32 PROTECTED_CALL_KIND_MASK = 0xffu;
constexpr u32 PROTECTED_CALL_PARENT = 1u << 8;

enum class FrameField : u32 { Function = 0, CallSite = 4, OpenHead = 8, Protected = 12, Flags = 16, Pc = 20, VarargBase = 24, VarargCount = 28, ReturnBase = 32, ReturnCount = 36, Top = 40 };
constexpr u32 FRAME_CONTROL_BYTES = 44;
// The stack datapath uses a RAM-word slot index, not a host signed integer.
constexpr u32 FRAME_WINDOW_MASK = (MAIN_RAM_SIZE / sizeof(u32)) - 1;
constexpr u32 FRAME_COMPLETION = 1u;
constexpr u32 FRAME_EXCEPTION = 2u;
constexpr u32 FRAME_NMI = 4u;

struct CallFrame {
	Thread* thread = nullptr;
	CallFrame* previous = nullptr;
	CallFrame* next = nullptr;
	Memory* controlMemory = nullptr;
	u32 controlOffset = 0;
	u8* nativeControl = nullptr;
	void bindControl(Memory& memory, u32 offset);
	u32 readControl(FrameField field) const {
		return controlMemory->readRamRecordWord(controlOffset + static_cast<u32>(field));
	}
	i32 readWindow(FrameField field) const {
		return static_cast<i32>(readControl(field) & FRAME_WINDOW_MASK);
	}
	void writeControl(FrameField field, u32 word) {
		controlMemory->writeRamRecordWord(controlOffset + static_cast<u32>(field), word);
	}
	void setTop(i32 top) {
		writeControl(FrameField::Top, (readControl(FrameField::Top) & ~FRAME_WINDOW_MASK) | static_cast<u32>(top));
	}
	void initializeControl(u32 function, u32 pc, u32 callSite, bool completion,
		i32 varargBase, i32 varargCount, i32 returnBase, i32 returnCount, i32 top);
	bool hasControlFlag(u32 mask) const;
	void addControlFlags(u32 flags);
	Blua32ExecutionImage* executionImage = nullptr;
	DecodedInstructionPage* decodedPage = nullptr;
	u32 decodedPageAddress = 0;
	MappedBusSignals decodedPageBusSignals = MAPPED_BUS_MASTER_CPU;
	// Host translation admission for the next PC; not architectural state.
	bool compilationEntry = true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Host translation binding for the suspended caller. Not guest/saved state.
	std::array<void* const*, 2> nativeContinuationCells{};
	u32 nativeContinuationPc = 0;
#endif
	ValueSpan registers;
	int stackBase = 0;
	int stackCapacity = 0;
	Closure* closure = nullptr;
};

} // namespace bmsx
