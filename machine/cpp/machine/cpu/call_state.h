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

enum class ProtectedCallKind : uint8_t {
	PCall,
	XPCallBody,
	XPCallHandler,
};

struct CallFrame {
	Thread* thread = nullptr;
	CallFrame* previous = nullptr;
	CallFrame* next = nullptr;
	u32 functionAddress = 0;
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
	// Only the activation invoked as a protected target owns its completion.
	i32 protectedContinuationIndex = -1;
	int top = 0;
	bool returnToCompletionLatch = false;
	u32 callSitePc = 0;
	bool isExceptionFrame = false;
	bool isNonMaskableExceptionFrame = false;
	u32 openUpvalueHead = 0;
};

struct ProtectedCallContinuation {
	ProtectedCallKind kind = ProtectedCallKind::PCall;
	CallFrame* caller = nullptr;
	bool returnsToProtectedParent = false;
	int callBase = 0;
	int returnCount = 0;
	int handlerRegister = -1;
};

} // namespace bmsx
