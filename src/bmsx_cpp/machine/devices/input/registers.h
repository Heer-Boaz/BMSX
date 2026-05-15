#pragma once

#include "common/types.h"
#include "machine/cpu/cpu.h"
#include "machine/cpu/string_pool.h"

namespace bmsx {

class Memory;

struct InputControllerRegisterState {
	u32 player = 1;
	StringId actionStringId = 0;
	StringId bindStringId = 0;
	u32 ctrl = 0;
	StringId queryStringId = 0;
	u32 status = 0;
	u32 value = 0;
	StringId consumeStringId = 0;
	u32 outputIntensityQ16 = 0;
	u32 outputDurationMs = 0;
};

class InputControllerRegisterFile {
public:
	InputControllerRegisterState state;

	static void writeThunk(void* context, uint32_t addr, Value value);

	void reset();
	InputControllerRegisterState captureState() const;
	void restoreState(const InputControllerRegisterState& restoredState);
	i32 selectedPlayerIndex() const;
	void write(uint32_t addr, Value value);
	void writeResult(Memory& memory, u32 status, u32 value);
	void mirror(Memory& memory) const;
};

} // namespace bmsx
