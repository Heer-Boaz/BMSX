#pragma once
#include "common/primitives.h"
#include "hid_keys.h"
#include <array>
#include <span>

namespace bmsx {
// Page indices of NATIVE_KEYBOARD_PAGES; other presentations author their own pages.
enum class KeyboardPage : u8 { Text, Symbols, Functions };
enum class OnScreenKeyboardCommand : u8 { None, Activate, Backspace, Delete, Space, Shift, Left, Right, Home, End, Enter, TogglePage };
enum class OnScreenKeyboardAction : u8 { None, TogglePosition };
inline constexpr i32 kNoModifier = -1;
inline constexpr i32 kModifierShift = 0;
inline constexpr i32 kModifierControl = 1;
inline constexpr i32 kModifierAlt = 2;
inline constexpr size_t MAIN_KEY_COUNT = 60;
inline constexpr std::array<u8, 3> MODIFIER_USAGES{hid_key_usage::ShiftLeft, hid_key_usage::ControlLeft, hid_key_usage::AltLeft};
inline constexpr std::array<u8, 3> MODIFIER_HID_MASKS{hid_key_usage::ModifierMaskShift, hid_key_usage::ModifierMaskControl, hid_key_usage::ModifierMaskAlt};
inline constexpr std::array<i16, 3> MODIFIER_KEY_INDICES{41, 53, 54};
struct OnScreenKeyDefinition { const char* label; u8 usage; i32 modifier; const char* shiftLabel = nullptr; };
inline constexpr std::array<OnScreenKeyDefinition, 75> ON_SCREEN_KEY_DEFINITIONS{{
	{"ESC", hid_key_usage::Escape, kNoModifier},
	{"1", hid_key_usage::Digit1, kNoModifier, "!"},
	{"2", hid_key_usage::Digit2, kNoModifier, "@"},
	{"3", hid_key_usage::Digit3, kNoModifier, "#"},
	{"4", hid_key_usage::Digit4, kNoModifier, "$"},
	{"5", hid_key_usage::Digit5, kNoModifier, "%"},
	{"6", hid_key_usage::Digit6, kNoModifier, "^"},
	{"7", hid_key_usage::Digit7, kNoModifier, "&"},
	{"8", hid_key_usage::Digit8, kNoModifier, "*"},
	{"9", hid_key_usage::Digit9, kNoModifier, "("},
	{"0", hid_key_usage::Digit0, kNoModifier, ")"},
	{"-", hid_key_usage::Minus, kNoModifier, "_"},
	{"=", hid_key_usage::Equal, kNoModifier, "+"},
	{"BKSP", hid_key_usage::Backspace, kNoModifier},

	{"TAB", hid_key_usage::Tab, kNoModifier},
	{"q", hid_key_usage::Q, kNoModifier, "Q"},
	{"w", hid_key_usage::W, kNoModifier, "W"},
	{"e", hid_key_usage::E, kNoModifier, "E"},
	{"r", hid_key_usage::R, kNoModifier, "R"},
	{"t", hid_key_usage::T, kNoModifier, "T"},
	{"y", hid_key_usage::Y, kNoModifier, "Y"},
	{"u", hid_key_usage::U, kNoModifier, "U"},
	{"i", hid_key_usage::I, kNoModifier, "I"},
	{"o", hid_key_usage::O, kNoModifier, "O"},
	{"p", hid_key_usage::P, kNoModifier, "P"},
	{"[", hid_key_usage::BracketLeft, kNoModifier, "{"},
	{"]", hid_key_usage::BracketRight, kNoModifier, "}"},
	{"\\", hid_key_usage::Backslash, kNoModifier, "|"},

	{"CAPS", hid_key_usage::CapsLock, kNoModifier},
	{"a", hid_key_usage::A, kNoModifier, "A"},
	{"s", hid_key_usage::S, kNoModifier, "S"},
	{"d", hid_key_usage::D, kNoModifier, "D"},
	{"f", hid_key_usage::F, kNoModifier, "F"},
	{"g", hid_key_usage::G, kNoModifier, "G"},
	{"h", hid_key_usage::H, kNoModifier, "H"},
	{"j", hid_key_usage::J, kNoModifier, "J"},
	{"k", hid_key_usage::K, kNoModifier, "K"},
	{"l", hid_key_usage::L, kNoModifier, "L"},
	{";", hid_key_usage::Semicolon, kNoModifier, ":"},
	{"'", hid_key_usage::Quote, kNoModifier, "\""},
	{"ENTER", hid_key_usage::Enter, kNoModifier},

	{"SHIFT", hid_key_usage::ShiftLeft, kModifierShift},
	{"z", hid_key_usage::Z, kNoModifier, "Z"},
	{"x", hid_key_usage::X, kNoModifier, "X"},
	{"c", hid_key_usage::C, kNoModifier, "C"},
	{"v", hid_key_usage::V, kNoModifier, "V"},
	{"b", hid_key_usage::B, kNoModifier, "B"},
	{"n", hid_key_usage::N, kNoModifier, "N"},
	{"m", hid_key_usage::M, kNoModifier, "M"},
	{",", hid_key_usage::Comma, kNoModifier, "<"},
	{".", hid_key_usage::Period, kNoModifier, ">"},
	{"/", hid_key_usage::Slash, kNoModifier, "?"},
	{"DEL", hid_key_usage::Delete, kNoModifier},

	{"CTRL", hid_key_usage::ControlLeft, kModifierControl},
	{"ALT", hid_key_usage::AltLeft, kModifierAlt},
	{"SPACE", hid_key_usage::Space, kNoModifier},
	{"<", hid_key_usage::ArrowLeft, kNoModifier},
	{"v", hid_key_usage::ArrowDown, kNoModifier},
	{"^", hid_key_usage::ArrowUp, kNoModifier},
	{">", hid_key_usage::ArrowRight, kNoModifier},
	{"HOME", hid_key_usage::Home, kNoModifier},
	{"END", hid_key_usage::End, kNoModifier},
	{"F1", static_cast<u8>(hid_key_usage::F1 + 0), kNoModifier},
	{"F2", static_cast<u8>(hid_key_usage::F1 + 1), kNoModifier},
	{"F3", static_cast<u8>(hid_key_usage::F1 + 2), kNoModifier},
	{"F4", static_cast<u8>(hid_key_usage::F1 + 3), kNoModifier},
	{"F5", static_cast<u8>(hid_key_usage::F1 + 4), kNoModifier},
	{"F6", static_cast<u8>(hid_key_usage::F1 + 5), kNoModifier},
	{"F7", static_cast<u8>(hid_key_usage::F1 + 6), kNoModifier},
	{"F8", static_cast<u8>(hid_key_usage::F1 + 7), kNoModifier},
	{"F9", static_cast<u8>(hid_key_usage::F1 + 8), kNoModifier},
	{"F10", static_cast<u8>(hid_key_usage::F1 + 9), kNoModifier},
	{"F11", static_cast<u8>(hid_key_usage::F1 + 10), kNoModifier},
	{"F12", static_cast<u8>(hid_key_usage::F1 + 11), kNoModifier},
	{"`", hid_key_usage::Backquote, kNoModifier, "~"},
}};
inline constexpr i16 ON_SCREEN_KEYBOARD_POSITION_TARGET = static_cast<i16>(ON_SCREEN_KEY_DEFINITIONS.size());
inline constexpr size_t ON_SCREEN_KEYBOARD_TARGET_COUNT = ON_SCREEN_KEY_DEFINITIONS.size() + 1;

inline constexpr auto ON_SCREEN_KEY_INDEX_BY_USAGE = [] {
	std::array<i16, 256> keys{};
	keys.fill(-1);
	for (size_t key = 0; key < ON_SCREEN_KEY_DEFINITIONS.size(); ++key) keys[ON_SCREEN_KEY_DEFINITIONS[key].usage] = static_cast<i16>(key);
	return keys;
}();
struct OnScreenKeyboardRow { std::span<const i16> keys; std::span<const f32> starts; std::span<const f32> spans; f32 units; };
struct OnScreenKeyboardPage { std::span<const OnScreenKeyboardRow> rows; i16 initialKey; };
inline constexpr std::array<i16, 14> nativePage0Row0Keys{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
inline constexpr std::array<f32, 14> nativePage0Row0Starts{0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14};
inline constexpr std::array<f32, 14> nativePage0Row0Spans{2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2};
inline constexpr std::array<i16, 14> nativePage0Row1Keys{14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27};
inline constexpr std::array<f32, 14> nativePage0Row1Starts{0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14};
inline constexpr std::array<f32, 14> nativePage0Row1Spans{2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
inline constexpr std::array<i16, 13> nativePage0Row2Keys{28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40};
inline constexpr std::array<f32, 13> nativePage0Row2Starts{0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
inline constexpr std::array<f32, 13> nativePage0Row2Spans{2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2};
inline constexpr std::array<i16, 12> nativePage0Row3Keys{41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52};
inline constexpr std::array<f32, 12> nativePage0Row3Starts{0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
inline constexpr std::array<f32, 12> nativePage0Row3Spans{2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2};
inline constexpr std::array<i16, 8> nativePage0Row4Keys{53, 54, 55, 56, 57, 58, 59, ON_SCREEN_KEYBOARD_POSITION_TARGET};
inline constexpr std::array<f32, 8> nativePage0Row4Starts{0, 2, 4, 10, 11, 12, 13, 14};
inline constexpr std::array<f32, 8> nativePage0Row4Spans{2, 2, 6, 1, 1, 1, 1, 2};
inline constexpr std::array<OnScreenKeyboardRow, 5> nativePage0Rows{{
	{nativePage0Row0Keys, nativePage0Row0Starts, nativePage0Row0Spans, 16},
	{nativePage0Row1Keys, nativePage0Row1Starts, nativePage0Row1Spans, 15},
	{nativePage0Row2Keys, nativePage0Row2Starts, nativePage0Row2Spans, 15},
	{nativePage0Row3Keys, nativePage0Row3Starts, nativePage0Row3Spans, 14},
	{nativePage0Row4Keys, nativePage0Row4Starts, nativePage0Row4Spans, 16},
}};
inline constexpr std::array<i16, 10> nativePage1Row0Keys{1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
inline constexpr std::array<f32, 10> nativePage1Row0Starts{0, 1, 2, 3, 4, 5, 6, 7, 8, 9};
inline constexpr std::array<f32, 10> nativePage1Row0Spans{1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
inline constexpr std::array<i16, 11> nativePage1Row1Keys{74, 11, 12, 25, 26, 27, 38, 39, 49, 50, 51};
inline constexpr std::array<f32, 11> nativePage1Row1Starts{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
inline constexpr std::array<f32, 11> nativePage1Row1Spans{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
inline constexpr std::array<i16, 7> nativePage1Row2Keys{0, 14, 13, 52, 40, 60, 61};
inline constexpr std::array<f32, 7> nativePage1Row2Starts{0, 2, 4, 6, 8, 10, 12};
inline constexpr std::array<f32, 7> nativePage1Row2Spans{2, 2, 2, 2, 2, 2, 2};
inline constexpr std::array<i16, 6> nativePage1Row3Keys{41, 53, 54, 28, 55, ON_SCREEN_KEYBOARD_POSITION_TARGET};
inline constexpr std::array<f32, 6> nativePage1Row3Starts{0, 2, 4, 6, 8, 12};
inline constexpr std::array<f32, 6> nativePage1Row3Spans{2, 2, 2, 2, 4, 2};
inline constexpr std::array<OnScreenKeyboardRow, 4> nativePage1Rows{{
	{nativePage1Row0Keys, nativePage1Row0Starts, nativePage1Row0Spans, 10},
	{nativePage1Row1Keys, nativePage1Row1Starts, nativePage1Row1Spans, 11},
	{nativePage1Row2Keys, nativePage1Row2Starts, nativePage1Row2Spans, 14},
	{nativePage1Row3Keys, nativePage1Row3Starts, nativePage1Row3Spans, 14},
}};
inline constexpr std::array<i16, 6> nativePage2Row0Keys{62, 63, 64, 65, 66, 67};
inline constexpr std::array<f32, 6> nativePage2Row0Starts{0, 2, 4, 6, 8, 10};
inline constexpr std::array<f32, 6> nativePage2Row0Spans{2, 2, 2, 2, 2, 2};
inline constexpr std::array<i16, 6> nativePage2Row1Keys{68, 69, 70, 71, 72, 73};
inline constexpr std::array<f32, 6> nativePage2Row1Starts{0, 2, 4, 6, 8, 10};
inline constexpr std::array<f32, 6> nativePage2Row1Spans{2, 2, 2, 2, 2, 2};
inline constexpr std::array<i16, 6> nativePage2Row2Keys{0, 13, 60, 61, 52, 40};
inline constexpr std::array<f32, 6> nativePage2Row2Starts{0, 2, 4, 6, 8, 10};
inline constexpr std::array<f32, 6> nativePage2Row2Spans{2, 2, 2, 2, 2, 2};
inline constexpr std::array<i16, 6> nativePage2Row3Keys{41, 53, 54, 28, 55, ON_SCREEN_KEYBOARD_POSITION_TARGET};
inline constexpr std::array<f32, 6> nativePage2Row3Starts{0, 2, 4, 6, 8, 12};
inline constexpr std::array<f32, 6> nativePage2Row3Spans{2, 2, 2, 2, 4, 2};
inline constexpr std::array<OnScreenKeyboardRow, 4> nativePage2Rows{{
	{nativePage2Row0Keys, nativePage2Row0Starts, nativePage2Row0Spans, 12},
	{nativePage2Row1Keys, nativePage2Row1Starts, nativePage2Row1Spans, 12},
	{nativePage2Row2Keys, nativePage2Row2Starts, nativePage2Row2Spans, 12},
	{nativePage2Row3Keys, nativePage2Row3Starts, nativePage2Row3Spans, 14},
}};
inline constexpr std::array<OnScreenKeyboardPage, 3> NATIVE_KEYBOARD_PAGES{{
	{nativePage0Rows, 15},
	{nativePage1Rows, 1},
	{nativePage2Rows, 62},
}};
} // namespace bmsx
