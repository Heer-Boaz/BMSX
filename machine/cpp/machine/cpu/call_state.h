#pragma once

#include <cstdint>
#include <array>

#include "common/primitives.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

struct Blua32ExecutionImage;
struct DecodedInstructionPage;
struct Closure;
struct Thread;
class Memory;

enum class ProtectedCallKind : uint8_t {
	PCall,
	XPCallBody,
	XPCallHandler,
};

enum class ProtectedField : u32 { Flags = 0, Caller = 4, Base = 8, Wanted = 12, Handler = 16 };
constexpr u32 PROTECTED_CALL_BYTES = 20;
constexpr u32 PROTECTED_CALL_KIND_MASK = 0xffu;
constexpr u32 PROTECTED_CALL_PARENT = 1u << 8;

enum class FrameField : u32 { Function = 0, CallSite = 4, OpenHead = 8, Protected = 12, Flags = 16 };
constexpr u32 FRAME_CONTROL_BYTES = 20;
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
	u32 readControl(FrameField field) const;
	void writeControl(FrameField field, u32 word);
	void initializeControl(u32 function, u32 callSite, bool completion);
	bool hasControlFlag(u32 mask) const;
	void addControlFlags(u32 flags);
	Blua32ExecutionImage* executionImage = nullptr;
	DecodedInstructionPage* decodedPage = nullptr;
	u32 decodedPageAddress = 0;
	MappedBusSignals decodedPageBusSignals = MAPPED_BUS_MASTER_CPU;
	// Host translation admission for the next PC; not architectural state.
	bool compilationEntry = true;
	u32 pc = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Host translation binding for the suspended caller. Not guest/saved state.
	std::array<void* const*, 2> nativeContinuationCells{};
#endif
	int varargBase = 0;
	int varargCount = 0;
	ValueSpan registers;
	int stackBase = 0;
	int stackCapacity = 0;
	Closure* closure = nullptr;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
};

} // namespace bmsx
