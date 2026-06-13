#pragma once

#include "common/types.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/input/contracts.h"

#include <array>

namespace bmsx {

class Memory;

struct InputControllerRegisterState {
	u32 ctrl = 0;
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> keyWords{};
	u32 pointerButtons = 0;
	u32 pointerXQ16 = 0;
	u32 pointerYQ16 = 0;
	u32 pointerWheelQ16 = 0;
	std::array<u32, INPUT_CONTROLLER_PAD_COUNT> padButtons{};
	std::array<u32, INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT> padAxesQ16{};
	u32 outputPort = 0;
	u32 outputIntensityQ16 = 0;
	u32 outputDurationMs = 0;
	u32 outputStatus = 0; // bit per pad: rumble supported
};

class InputControllerRegisterFile {
public:
	InputControllerRegisterState state;

	static void writeThunk(void* context, uint32_t addr, Value value);

	void reset();
	InputControllerRegisterState captureState() const;
	void restoreState(const InputControllerRegisterState& restoredState);
	i32 selectedPadIndex() const;
	void latchSnapshot(const InputControllerSnapshot& snapshot);
	void write(uint32_t addr, Value value);
	void mirror(Memory& memory) const;
};

} // namespace bmsx
