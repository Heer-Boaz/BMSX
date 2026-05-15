#pragma once

#include "common/types.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/registers.h"

#include <array>
#include <vector>

namespace bmsx {

struct InputControllerState {
	bool sampleArmed = false;
	u32 sampleSequence = 0;
	u32 lastSampleCycle = 0;
	InputControllerRegisterState registers;
	std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> players;
	std::vector<InputControllerEventState> eventFifoEvents;
	bool eventFifoOverflow = false;
};

} // namespace bmsx
