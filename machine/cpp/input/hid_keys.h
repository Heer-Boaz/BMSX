#pragma once

#include "common/primitives.h"

#include <string>

namespace bmsx {

// KeyboardEvent.code -> USB HID usage ID (usage page 0x07, Keyboard/Keypad).
// The ICU keyboard bitmap is indexed by these usage IDs; this table is the
// host-side translation from W3C UI Events codes to that hardware bit index.
// Mirrors machine/ts/input/hid_keys.ts and cartlib/input/keys.lua.
i32 hidKeyUsageForCode(const std::string& code);

} // namespace bmsx
