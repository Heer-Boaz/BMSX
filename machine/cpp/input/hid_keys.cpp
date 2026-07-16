#include "input/hid_keys.h"

namespace bmsx {

namespace {

struct HidKeyUsage {
	std::string_view code;
	u8 usage;
};

constexpr HidKeyUsage kHidKeyUsages[] = {
	{"KeyA", 4}, {"KeyB", 5}, {"KeyC", HID_USAGE_KEY_C}, {"KeyD", 7}, {"KeyE", 8}, {"KeyF", 9},
	{"KeyG", 10}, {"KeyH", 11}, {"KeyI", 12}, {"KeyJ", 13}, {"KeyK", 14}, {"KeyL", 15},
	{"KeyM", 16}, {"KeyN", 17}, {"KeyO", 18}, {"KeyP", 19}, {"KeyQ", 20}, {"KeyR", 21},
	{"KeyS", 22}, {"KeyT", 23}, {"KeyU", 24}, {"KeyV", 25}, {"KeyW", 26}, {"KeyX", HID_USAGE_KEY_X},
	{"KeyY", 28}, {"KeyZ", 29},
	{"Digit1", 30}, {"Digit2", 31}, {"Digit3", 32}, {"Digit4", 33}, {"Digit5", 34},
	{"Digit6", 35}, {"Digit7", 36}, {"Digit8", 37}, {"Digit9", 38}, {"Digit0", 39},
	{"Enter", HID_USAGE_ENTER}, {"Escape", 41}, {"Backspace", HID_USAGE_BACKSPACE}, {"Tab", 43}, {"Space", 44},
	{"Minus", 45}, {"Equal", 46}, {"BracketLeft", 47}, {"BracketRight", 48}, {"Backslash", 49},
	{"Semicolon", 51}, {"Quote", 52}, {"Backquote", 53}, {"Comma", 54}, {"Period", 55}, {"Slash", 56},
	{"CapsLock", 57},
	{"F1", 58}, {"F2", HID_USAGE_F2}, {"F3", 60}, {"F4", 61}, {"F5", 62}, {"F6", 63},
	{"F7", 64}, {"F8", 65}, {"F9", 66}, {"F10", 67}, {"F11", 68}, {"F12", 69},
	{"PrintScreen", 70}, {"ScrollLock", 71}, {"Pause", 72},
	{"Insert", 73}, {"Home", 74}, {"PageUp", 75}, {"Delete", 76}, {"End", 77}, {"PageDown", 78},
	{"ArrowRight", HID_USAGE_ARROW_RIGHT}, {"ArrowLeft", HID_USAGE_ARROW_LEFT}, {"ArrowDown", HID_USAGE_ARROW_DOWN}, {"ArrowUp", HID_USAGE_ARROW_UP},
	{"NumLock", 83}, {"NumpadDivide", 84}, {"NumpadMultiply", 85}, {"NumpadSubtract", 86},
	{"NumpadAdd", 87}, {"NumpadEnter", 88},
	{"Numpad1", 89}, {"Numpad2", 90}, {"Numpad3", 91}, {"Numpad4", 92}, {"Numpad5", 93},
	{"Numpad6", 94}, {"Numpad7", 95}, {"Numpad8", 96}, {"Numpad9", 97}, {"Numpad0", 98},
	{"NumpadDecimal", 99},
	{"IntlBackslash", 100}, {"ContextMenu", 101}, {"Power", 102}, {"NumpadEqual", 103},
	{"F13", 104}, {"F14", 105}, {"F15", 106}, {"F16", 107}, {"F17", 108}, {"F18", 109},
	{"F19", 110}, {"F20", 111}, {"F21", 112}, {"F22", 113}, {"F23", 114}, {"F24", 115},
	{"IntlRo", 135}, {"IntlYen", 137},
	{"Lang1", 144}, {"Lang2", 145},
	{"ControlLeft", 224}, {"ShiftLeft", HID_USAGE_SHIFT_LEFT}, {"AltLeft", 226}, {"MetaLeft", 227},
	{"ControlRight", 228}, {"ShiftRight", HID_USAGE_SHIFT_RIGHT}, {"AltRight", 230}, {"MetaRight", 231},
};

} // namespace

i32 hidKeyUsageForCode(std::string_view code) {
	for (const HidKeyUsage& key : kHidKeyUsages) {
		if (key.code == code) {
			return key.usage;
		}
	}
	return -1;
}

} // namespace bmsx
