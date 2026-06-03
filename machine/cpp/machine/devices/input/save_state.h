#pragma once

#include "common/types.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"

#include <array>
#include <vector>

namespace bmsx {

struct InputControllerState : InputControllerSampleLatchState {
	InputControllerRegisterState registers;
	std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> players;
	std::vector<InputControllerEventState> eventFifoEvents;
	bool eventFifoOverflow = false;
};

} // namespace bmsx
