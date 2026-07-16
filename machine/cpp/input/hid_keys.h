#pragma once

#include "common/primitives.h"

#include <string_view>

namespace bmsx {

constexpr u8 HID_USAGE_KEY_C = 6u;
constexpr u8 HID_USAGE_KEY_X = 27u;
constexpr u8 HID_USAGE_ENTER = 40u;
constexpr u8 HID_USAGE_BACKSPACE = 42u;
constexpr u8 HID_USAGE_F2 = 59u;
constexpr u8 HID_USAGE_ARROW_RIGHT = 79u;
constexpr u8 HID_USAGE_ARROW_LEFT = 80u;
constexpr u8 HID_USAGE_ARROW_DOWN = 81u;
constexpr u8 HID_USAGE_ARROW_UP = 82u;
constexpr u8 HID_USAGE_SHIFT_LEFT = 225u;
constexpr u8 HID_USAGE_SHIFT_RIGHT = 229u;

// KeyboardEvent.code -> USB HID usage ID (usage page 0x07, Keyboard/Keypad).
// The ICU keyboard bitmap is indexed by these usage IDs; this table is the
// host-side translation from W3C UI Events codes to that hardware bit index.
// Mirrors machine/ts/input/hid_keys.ts and cartlib/input/keys.lua.
i32 hidKeyUsageForCode(std::string_view code);

} // namespace bmsx
