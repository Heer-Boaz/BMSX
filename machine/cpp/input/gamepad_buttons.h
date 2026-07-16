#pragma once

#include "common/primitives.h"

namespace bmsx {

// Button ordinals before Count are the raw ICU pad-button bit positions.
enum class GamepadButton : u8 {
	A,
	B,
	X,
	Y,
	LeftBumper,
	RightBumper,
	LeftTrigger,
	RightTrigger,
	Select,
	Start,
	LeftStick,
	RightStick,
	Up,
	Down,
	Left,
	Right,
	Home,
	Touchpad,
	Count,
};

enum class GamepadStick : u8 {
	Left,
	Right,
};

} // namespace bmsx
