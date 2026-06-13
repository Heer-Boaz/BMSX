#pragma once
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"

namespace bmsx {
struct InputControllerState : InputControllerSampleLatchState {
	InputControllerRegisterState registers;
};
} // namespace bmsx
