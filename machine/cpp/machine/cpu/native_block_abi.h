#pragma once

#include <algorithm>

#include "machine/cpu/native_block.h"
#include "machine/cpu/table.h"
#include "sljitLir.h"

namespace bmsx {

// The stable CALL gate owns these admission temporaries. They reuse the same
// host frame as register spills, and are never guest activation storage.
struct NativeCallScratch {
	const NativeBlockExitSite* exit;
	CallFrame* caller;
	CallFrame* callee;
	Closure* closure;
	const Value* args;
	u32 functionAddress, codeAddress, numParams, maxStack, flags;
	int argCount, varargBase, varargCount, stackBase, stackTop;
};

// One native frame spans every linked body, including bodies compiled later.
// Keep its register banks, helper spill space and host save area identical.
struct NativeBlockAbi {
	static constexpr int registerCacheCapacity = NATIVE_BLOCK_REGISTER_CACHE_CAPACITY;
	static constexpr int scratchFloats = 3 + std::min(registerCacheCapacity,
		SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	static constexpr int savedFloats = std::min(registerCacheCapacity, SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS);
	static constexpr int scratches = 4 | SLJIT_ENTER_FLOAT(scratchFloats);
	static constexpr int saveds = 6 | SLJIT_ENTER_FLOAT(savedFloats);
	static constexpr int stackBytes = std::max(registerCacheCapacity * sizeof(Value), sizeof(NativeCallScratch));
	static constexpr int helperResultOffset = registerCacheCapacity * sizeof(Value);
	static_assert(helperResultOffset + sizeof(TableLookupResult) <= stackBytes);
	static_assert(helperResultOffset + sizeof(NativeBuiltinCallState) <= stackBytes);
	static constexpr int signature = SLJIT_ARGS2(P, P, P);
};

class NativeBlockGate {
public:
	NativeBlockGate();
	~NativeBlockGate();
	NativeBlockGate(const NativeBlockGate&) = delete;
	NativeBlockGate& operator=(const NativeBlockGate&) = delete;

	void* entry;
	void* exit;
	void* dispatch;
	// Both entries consume R0=exit descriptor and retain the native frame.
	// An internal deadline exit has already charged its segment.
	std::array<void*, 2> finishSegment;
	std::array<void*, 2> publishSegment;
	// Already materialized/charged edges arrive here when unlinked or expired.
	void* leaveSegment;
	// Pure raw-Value equality: FR0/FR1 inputs, R0 boolean result. The fast
	// call preserves every cached FPR and saved GPR; R1/R2/R3 are scratch.
	void* equalValues;

private:
	sljit_label* emitCallGate(sljit_compiler* compiler, sljit_label* coldDispatch, sljit_label* returnToCpp);
	sljit_label* emitReturnGate(sljit_compiler* compiler, sljit_label* coldDispatch);
	sljit_label* emitEqualityGate(sljit_compiler* compiler);
};

const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
