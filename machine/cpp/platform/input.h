#pragma once

#include "common/primitives.h"

namespace bmsx {

// Frontends normalize their own device ABI before publishing these records.
// Keyboard controls are USB HID usages; pad and pointer controls use the
// BMSX-owned ordinals declared by the corresponding input owner headers.
enum class InputSource : u8 {
	Keyboard,
	Gamepad,
	Pointer,
};

struct InputControl {
	InputSource source = InputSource::Keyboard;
	u8 deviceSlot = 0u;
	u8 control = 0u;
};

enum class InputEvtType : u8 {
	ButtonDown,
	ButtonUp,
	Axis1,
	Axis2,
	SupervisorRequestDown,
	SupervisorRequestUp,
};

struct InputEvt {
	InputEvtType type = InputEvtType::ButtonDown;
	InputControl input;
	f32 value = 0.0F;
	f32 x = 0.0F;
	f32 y = 0.0F;
};

} // namespace bmsx
