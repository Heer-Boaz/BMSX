#pragma once

#include <algorithm>

#include "machine/cpu/native_block.h"
#include "sljitLir.h"

namespace bmsx {

// One native frame spans every linked body, including bodies compiled later.
// Keep its register banks, helper spill space and host save area identical.
struct NativeBlockAbi {
	static constexpr int registerCacheCapacity = 4;
	static constexpr int scratchFloats = 3 + std::min(registerCacheCapacity,
		SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	static constexpr int savedFloats = std::min(registerCacheCapacity, SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS);
	static constexpr int scratches = 4 | SLJIT_ENTER_FLOAT(scratchFloats);
	static constexpr int saveds = 6 | SLJIT_ENTER_FLOAT(savedFloats);
	static constexpr int stackBytes = registerCacheCapacity * sizeof(Value);
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
};

const NativeBlockGate& nativeBlockGate();

} // namespace bmsx
