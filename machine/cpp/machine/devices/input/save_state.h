#pragma once
#include "machine/devices/input/registers.h"

namespace bmsx {
struct InputControllerState {
	bool sampleArmed = false;
	u32 sampleSequence = 0;
	u32 lastSampleCycle = 0;
	bool systemNmiLineHigh = false;
	InputControllerRegisterState registers;
};
} // namespace bmsx
