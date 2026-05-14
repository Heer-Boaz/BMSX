#pragma once

#include "common/types.h"
#include "machine/cpu/string_pool.h"
#include "machine/devices/input/contracts.h"

#include <array>
#include <vector>

namespace bmsx {

struct InputControllerActionState {
	StringId actionStringId = 0;
	StringId bindStringId = 0;
	u32 statusWord = 0;
	u32 valueQ16 = 0;
	f64 pressTime = 0.0;
	u32 repeatCount = 0;
};

struct InputControllerPlayerState {
	std::vector<InputControllerActionState> actions;
};

struct InputControllerEventState {
	u32 player = 0;
	StringId actionStringId = 0;
	u32 statusWord = 0;
	u32 valueQ16 = 0;
	u32 repeatCount = 0;
};

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
