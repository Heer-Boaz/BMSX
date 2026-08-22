#include "input.h"

#include "machine/common/numeric.h"

#include <algorithm>
#include <array>

namespace bmsx {
namespace {

constexpr unsigned kLibretroButtonCount = 16u;

#if defined(BMSX_LIBRETRO_SNESMINI_LAYOUT)
constexpr InputControllerGamepadButtonBit kLibretroButtonA =
	InputControllerGamepadButtonBit::B;
constexpr InputControllerGamepadButtonBit kLibretroButtonB =
	InputControllerGamepadButtonBit::A;
constexpr InputControllerGamepadButtonBit kLibretroButtonX =
	InputControllerGamepadButtonBit::Y;
constexpr InputControllerGamepadButtonBit kLibretroButtonY =
	InputControllerGamepadButtonBit::X;
#else
constexpr InputControllerGamepadButtonBit kLibretroButtonA =
	InputControllerGamepadButtonBit::A;
constexpr InputControllerGamepadButtonBit kLibretroButtonB =
	InputControllerGamepadButtonBit::B;
constexpr InputControllerGamepadButtonBit kLibretroButtonX =
	InputControllerGamepadButtonBit::X;
constexpr InputControllerGamepadButtonBit kLibretroButtonY =
	InputControllerGamepadButtonBit::Y;
#endif

constexpr std::array<InputControllerGamepadButtonBit, kLibretroButtonCount> kLibretroButtons = {
	kLibretroButtonB,
	kLibretroButtonY,
	InputControllerGamepadButtonBit::Select,
	InputControllerGamepadButtonBit::Start,
	InputControllerGamepadButtonBit::Up,
	InputControllerGamepadButtonBit::Down,
	InputControllerGamepadButtonBit::Left,
	InputControllerGamepadButtonBit::Right,
	kLibretroButtonA,
	kLibretroButtonX,
	InputControllerGamepadButtonBit::LeftBumper,
	InputControllerGamepadButtonBit::RightBumper,
	InputControllerGamepadButtonBit::LeftTrigger,
	InputControllerGamepadButtonBit::RightTrigger,
	InputControllerGamepadButtonBit::LeftStick,
	InputControllerGamepadButtonBit::RightStick,
};

constexpr u32 kTerminalShortcutMask =
	1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper);
constexpr u32 kMenuShortcutMask =
	1u << static_cast<u32>(InputControllerGamepadButtonBit::Start);
constexpr u32 kHostShortcutModifier =
	1u << static_cast<u32>(InputControllerGamepadButtonBit::Select);
constexpr u32 kHostShortcutTargets = kTerminalShortcutMask | kMenuShortcutMask;

constexpr unsigned kRetroMouseIdX = 0u;
constexpr unsigned kRetroMouseIdY = 1u;
constexpr unsigned kRetroMouseIdLeft = 2u;
constexpr unsigned kRetroMouseIdRight = 3u;
constexpr unsigned kRetroMouseIdWheelUp = 4u;
constexpr unsigned kRetroMouseIdWheelDown = 5u;
constexpr unsigned kRetroMouseIdMiddle = 6u;
constexpr unsigned kRetroMouseIdButton4 = 9u;
constexpr unsigned kRetroMouseIdButton5 = 10u;

constexpr unsigned kRetroPointerIdX = 0u;
constexpr unsigned kRetroPointerIdY = 1u;
constexpr unsigned kRetroPointerIdPressed = 2u;

constexpr std::array<i16, RETROK_LAST> makeRetroKeyHidUsages() {
	std::array<i16, RETROK_LAST> usages{};
	usages.fill(-1);
	for (unsigned key = RETROK_a; key <= RETROK_z; key += 1u) {
		usages[key] = static_cast<i16>(4u + key - RETROK_a);
	}
	for (unsigned key = RETROK_1; key <= RETROK_9; key += 1u) {
		usages[key] = static_cast<i16>(30u + key - RETROK_1);
	}
	usages[RETROK_0] = 39;
	usages[RETROK_RETURN] = HID_USAGE_ENTER;
	usages[RETROK_ESCAPE] = 41;
	usages[RETROK_BACKSPACE] = HID_USAGE_BACKSPACE;
	usages[RETROK_TAB] = 43;
	usages[RETROK_SPACE] = 44;
	usages[RETROK_MINUS] = 45;
	usages[RETROK_EQUALS] = 46;
	usages[RETROK_LEFTBRACKET] = 47;
	usages[RETROK_RIGHTBRACKET] = 48;
	usages[RETROK_BACKSLASH] = 49;
	usages[RETROK_SEMICOLON] = 51;
	usages[RETROK_QUOTE] = 52;
	usages[RETROK_BACKQUOTE] = 53;
	usages[RETROK_COMMA] = 54;
	usages[RETROK_PERIOD] = 55;
	usages[RETROK_SLASH] = 56;
	usages[RETROK_CAPSLOCK] = 57;
	for (unsigned key = RETROK_F1; key <= RETROK_F12; key += 1u) {
		usages[key] = static_cast<i16>(58u + key - RETROK_F1);
	}
	usages[RETROK_PRINT] = 70;
	usages[RETROK_SCROLLOCK] = 71;
	usages[RETROK_PAUSE] = 72;
	usages[RETROK_INSERT] = 73;
	usages[RETROK_HOME] = 74;
	usages[RETROK_PAGEUP] = 75;
	usages[RETROK_DELETE] = 76;
	usages[RETROK_END] = 77;
	usages[RETROK_PAGEDOWN] = 78;
	usages[RETROK_RIGHT] = HID_USAGE_ARROW_RIGHT;
	usages[RETROK_LEFT] = HID_USAGE_ARROW_LEFT;
	usages[RETROK_DOWN] = HID_USAGE_ARROW_DOWN;
	usages[RETROK_UP] = HID_USAGE_ARROW_UP;
	usages[RETROK_NUMLOCK] = 83;
	usages[RETROK_KP_DIVIDE] = 84;
	usages[RETROK_KP_MULTIPLY] = 85;
	usages[RETROK_KP_MINUS] = 86;
	usages[RETROK_KP_PLUS] = 87;
	usages[RETROK_KP_ENTER] = 88;
	for (unsigned key = RETROK_KP1; key <= RETROK_KP9; key += 1u) {
		usages[key] = static_cast<i16>(89u + key - RETROK_KP1);
	}
	usages[RETROK_KP0] = 98;
	usages[RETROK_KP_PERIOD] = 99;
	usages[RETROK_OEM_102] = 100;
	usages[RETROK_MENU] = 101;
	usages[RETROK_POWER] = 102;
	usages[RETROK_KP_EQUALS] = 103;
	for (unsigned key = RETROK_F13; key <= RETROK_F15; key += 1u) {
		usages[key] = static_cast<i16>(104u + key - RETROK_F13);
	}
	usages[RETROK_LCTRL] = 224;
	usages[RETROK_LSHIFT] = HID_USAGE_SHIFT_LEFT;
	usages[RETROK_LALT] = 226;
	usages[RETROK_LMETA] = 227;
	usages[RETROK_LSUPER] = 227;
	usages[RETROK_RCTRL] = 228;
	usages[RETROK_RSHIFT] = HID_USAGE_SHIFT_RIGHT;
	usages[RETROK_RALT] = 230;
	usages[RETROK_RMETA] = 231;
	usages[RETROK_RSUPER] = 231;
	return usages;
}

constexpr std::array<i16, RETROK_LAST> kRetroKeyHidUsages =
	makeRetroKeyHidUsages();

f32 normalizeAxis(i16 value) {
	// Libretro exposes the complete signed 16-bit range. Preserve both endpoints.
	return static_cast<f32>(value)
		/ (value < 0 ? 32768.0F : 32767.0F);
}

i32 pointerAxisToViewport(i16 value, i32 extent) {
	const i32 clamped = std::clamp(static_cast<i32>(value), -32767, 32767);
	return static_cast<i32>(
		(static_cast<i64>(clamped + 32767) * static_cast<i64>(extent - 1)
			+ 32767)
		/ 65534);
}

bool keyUsagePressed(
		const std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT>& words,
		u8 usage) {
	const size_t word = static_cast<size_t>(usage) >> 5u;
	return (words[word] & (1u << (static_cast<u32>(usage) & 31u))) != 0u;
}

void clearKeyUsage(
		std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT>& words,
		u8 usage) {
	const size_t word = static_cast<size_t>(usage) >> 5u;
	words[word] &= ~(1u << (static_cast<u32>(usage) & 31u));
}

} // namespace

LibretroInput::LibretroInput(
		bmsx_supervisor_request_line_t supervisorRequestLine)
	: m_supervisor_request_line(supervisorRequestLine) {
	m_controller_devices.fill(RETRO_DEVICE_JOYPAD);
}

void LibretroInput::poll(
		i32 viewportWidth,
		i32 viewportHeight,
		f64 currentTimeMs) {
	m_current_time_ms = currentTimeMs;
	for (unsigned port = 0u; port < m_rumble_deadlines_ms.size(); port += 1u) {
		const u32 portMask = 1u << port;
		if ((m_active_rumble_mask & portMask) != 0u
			&& currentTimeMs >= m_rumble_deadlines_ms[port]) {
			setRumbleStrength(port, 0u);
			m_active_rumble_mask &= ~portMask;
		}
	}

	m_input_poll_callback();
	m_host_supervisor_request_high = m_supervisor_request_line();
	m_routed_keyboard_usage_words = m_keyboard_usage_words;
	u32 keyboardButtons = 0u;
	if (keyUsagePressed(m_keyboard_usage_words, HID_USAGE_CONTROL_RIGHT)) {
		keyboardButtons |= kHostShortcutModifier;
	}
	if (keyUsagePressed(m_keyboard_usage_words, HID_USAGE_SHIFT_LEFT)) {
		keyboardButtons |= kTerminalShortcutMask;
	}
	if (keyUsagePressed(m_keyboard_usage_words, HID_USAGE_ALT_RIGHT)) {
		keyboardButtons |= kMenuShortcutMask;
	}
	const BmsxHostShortcutResult keyboardShortcuts =
		bmsx_host_shortcuts_update(
			&m_keyboard_shortcuts,
			keyboardButtons,
			kHostShortcutModifier,
			kHostShortcutTargets);
	if ((keyboardShortcuts.routed_buttons & kHostShortcutModifier) == 0u) {
		clearKeyUsage(m_routed_keyboard_usage_words, HID_USAGE_CONTROL_RIGHT);
	}
	if ((keyboardShortcuts.routed_buttons & kTerminalShortcutMask) == 0u) {
		clearKeyUsage(m_routed_keyboard_usage_words, HID_USAGE_SHIFT_LEFT);
	}
	if ((keyboardShortcuts.routed_buttons & kMenuShortcutMask) == 0u) {
		clearKeyUsage(m_routed_keyboard_usage_words, HID_USAGE_ALT_RIGHT);
	}
	u32 activeHostShortcuts = keyboardShortcuts.active_targets;
	m_just_pressed_host_shortcuts = keyboardShortcuts.just_pressed_targets;

	for (u8 player = 0u; player < INPUT_CONTROLLER_PAD_COUNT; player += 1u) {
		InputControllerPadSnapshot& gamepad = m_gamepads[player];
		u32 buttons = 0u;
		for (u8 button = 0u; button < kLibretroButtonCount; button += 1u) {
			if (m_input_state_callback(
				player,
				RETRO_DEVICE_JOYPAD,
				0u,
				button
			)) {
				buttons |= 1u << static_cast<u32>(kLibretroButtons[button]);
			}
		}
		if (player == 0u) {
			const BmsxHostShortcutResult shortcuts =
				bmsx_host_shortcuts_update(
				&m_gamepad_shortcuts,
				buttons,
				kHostShortcutModifier,
				kHostShortcutTargets);
			buttons = shortcuts.routed_buttons;
			activeHostShortcuts |= shortcuts.active_targets;
			m_just_pressed_host_shortcuts |= shortcuts.just_pressed_targets;
		}
		gamepad.buttons = buttons;
		gamepad.axesQ16[0] = encodeSignedFix16(normalizeAxis(m_input_state_callback(
			player,
			RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT,
			RETRO_DEVICE_ID_ANALOG_X)));
		gamepad.axesQ16[1] = encodeSignedFix16(normalizeAxis(m_input_state_callback(
			player,
			RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_LEFT,
			RETRO_DEVICE_ID_ANALOG_Y)));
		gamepad.axesQ16[2] = encodeSignedFix16(normalizeAxis(m_input_state_callback(
			player,
			RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT,
			RETRO_DEVICE_ID_ANALOG_X)));
		gamepad.axesQ16[3] = encodeSignedFix16(normalizeAxis(m_input_state_callback(
			player,
			RETRO_DEVICE_ANALOG,
			RETRO_DEVICE_INDEX_ANALOG_RIGHT,
			RETRO_DEVICE_ID_ANALOG_Y)));
		gamepad.axesQ16[4] =
			(buttons & (1u << static_cast<u32>(
				InputControllerGamepadButtonBit::LeftTrigger)))
			? static_cast<u32>(FIX16_ONE)
			: 0u;
		gamepad.axesQ16[5] =
			(buttons & (1u << static_cast<u32>(
				InputControllerGamepadButtonBit::RightTrigger)))
			? static_cast<u32>(FIX16_ONE)
			: 0u;
	}
	m_host_supervisor_request_high =
		m_host_supervisor_request_high ||
		(activeHostShortcuts & kTerminalShortcutMask) != 0u;

	const i16 mouseDeltaX =
		m_input_state_callback(0u, RETRO_DEVICE_MOUSE, 0u, kRetroMouseIdX);
	const i16 mouseDeltaY =
		m_input_state_callback(0u, RETRO_DEVICE_MOUSE, 0u, kRetroMouseIdY);
	const i16 mouseWheelUp =
		m_input_state_callback(0u, RETRO_DEVICE_MOUSE, 0u, kRetroMouseIdWheelUp);
	const i16 mouseWheelDown =
		m_input_state_callback(0u, RETRO_DEVICE_MOUSE, 0u, kRetroMouseIdWheelDown);
	const i16 pointerRawX =
		m_input_state_callback(0u, RETRO_DEVICE_POINTER, 0u, kRetroPointerIdX);
	const i16 pointerRawY =
		m_input_state_callback(0u, RETRO_DEVICE_POINTER, 0u, kRetroPointerIdY);
	const bool pointerPressed =
		m_input_state_callback(
			0u,
			RETRO_DEVICE_POINTER,
			0u,
			kRetroPointerIdPressed) != 0;

	m_pointer_buttons =
		(m_input_state_callback(
			0u,
			RETRO_DEVICE_MOUSE,
			0u,
			kRetroMouseIdLeft) != 0
			|| pointerPressed
			? 1u << INP_POINTER_BUTTON_PRIMARY
			: 0u)
		| (m_input_state_callback(
			0u,
			RETRO_DEVICE_MOUSE,
			0u,
			kRetroMouseIdMiddle) != 0
			? 1u << INP_POINTER_BUTTON_AUX
			: 0u)
		| (m_input_state_callback(
			0u,
			RETRO_DEVICE_MOUSE,
			0u,
			kRetroMouseIdRight) != 0
			? 1u << INP_POINTER_BUTTON_SECONDARY
			: 0u)
		| (m_input_state_callback(
			0u,
			RETRO_DEVICE_MOUSE,
			0u,
			kRetroMouseIdButton4) != 0
			? 1u << INP_POINTER_BUTTON_BACK
			: 0u)
		| (m_input_state_callback(
			0u,
			RETRO_DEVICE_MOUSE,
			0u,
			kRetroMouseIdButton5) != 0
			? 1u << INP_POINTER_BUTTON_FORWARD
			: 0u);

	const bool hasAbsolutePointer =
		pointerRawX != 0 || pointerRawY != 0 || pointerPressed;
	if (hasAbsolutePointer) {
		m_pointer_x = pointerAxisToViewport(pointerRawX, viewportWidth);
		m_pointer_y = pointerAxisToViewport(pointerRawY, viewportHeight);
		m_pointer_position_valid = true;
	} else if (mouseDeltaX != 0 || mouseDeltaY != 0) {
		if (!m_pointer_position_valid) {
			m_pointer_x = 0;
			m_pointer_y = 0;
			m_pointer_position_valid = true;
		}
		m_pointer_x = std::clamp(
			m_pointer_x + static_cast<i32>(mouseDeltaX),
			0,
			viewportWidth - 1);
		m_pointer_y = std::clamp(
			m_pointer_y + static_cast<i32>(mouseDeltaY),
			0,
			viewportHeight - 1);
	}

	m_pointer_x_q16 = encodeSignedFix16(static_cast<f32>(m_pointer_x));
	m_pointer_y_q16 = encodeSignedFix16(static_cast<f32>(m_pointer_y));
	m_pointer_wheel_q16 = encodeSignedFix16(static_cast<f32>(
		static_cast<i32>(mouseWheelDown)
		- static_cast<i32>(mouseWheelUp)));
}

bool LibretroInput::keyboardUsagePressed(u8 usage) const {
	return keyUsagePressed(m_routed_keyboard_usage_words, usage);
}

bool LibretroInput::gamepadButtonPressed(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button) const {
	return (m_gamepads[deviceSlot].buttons
		& (1u << static_cast<u32>(button))) != 0u;
}

bool LibretroInput::hostShortcutJustPressed(
		InputControllerGamepadButtonBit button) const {
	return (m_just_pressed_host_shortcuts & (1u << static_cast<u32>(button))) != 0u;
}

void LibretroInput::sampleInputControllerSnapshot(
		InputControllerSnapshot& snapshot) {
	snapshot.keyWords = m_routed_keyboard_usage_words;
	snapshot.pointerButtons = m_pointer_buttons;
	snapshot.pointerXQ16 = m_pointer_x_q16;
	snapshot.pointerYQ16 = m_pointer_y_q16;
	snapshot.pointerWheelQ16 = m_pointer_wheel_q16;
	snapshot.rumbleSupportMask = m_rumble_support_mask;
	snapshot.pads = m_gamepads;
}

void LibretroInput::installRumbleInterface(
		retro_rumble_interface rumbleInterface) {
	if (m_active_rumble_mask != 0u) {
		for (unsigned port = 0u; port < m_rumble_deadlines_ms.size(); port += 1u) {
			if ((m_active_rumble_mask & (1u << port)) != 0u) {
				setRumbleStrength(port, 0u);
			}
		}
		m_active_rumble_mask = 0u;
	}
	m_rumble_interface = rumbleInterface;
	m_rumble_support_mask = 0u;
	if (!m_rumble_interface.set_rumble_state) {
		return;
	}
	for (unsigned port = 0u; port < m_controller_devices.size(); port += 1u) {
		if (m_controller_devices[port] == RETRO_DEVICE_JOYPAD) {
			m_rumble_support_mask |= 1u << port;
		}
	}
}

void LibretroInput::setControllerDevice(unsigned port, unsigned device) {
	if (port >= m_controller_devices.size()) {
		return;
	}
	const u32 portMask = 1u << port;
	if ((m_active_rumble_mask & portMask) != 0u) {
		setRumbleStrength(port, 0u);
		m_active_rumble_mask &= ~portMask;
	}
	m_controller_devices[port] = device;
	if (m_rumble_interface.set_rumble_state
		&& device == RETRO_DEVICE_JOYPAD) {
		m_rumble_support_mask |= portMask;
	} else {
		m_rumble_support_mask &= ~portMask;
	}
}

bool LibretroInput::setRumbleStrength(unsigned port, u16 strength) {
	const bool strongApplied = m_rumble_interface.set_rumble_state(
		port,
		RETRO_RUMBLE_STRONG,
		strength);
	const bool weakApplied = m_rumble_interface.set_rumble_state(
		port,
		RETRO_RUMBLE_WEAK,
		strength);
	return strongApplied || weakApplied;
}

void LibretroInput::applyInputControllerVibrationEffect(
		i32 padIndex,
		f64 durationMs,
		f32 intensity) {
	const unsigned port = static_cast<unsigned>(padIndex);
	const u32 portMask = 1u << port;
	if ((m_rumble_support_mask & portMask) == 0u) {
		return;
	}
	const f32 boundedIntensity = std::clamp(intensity, 0.0F, 1.0F);
	const u16 strength = durationMs > 0.0
		? static_cast<u16>(boundedIntensity * 65535.0F)
		: 0u;
	if (!setRumbleStrength(port, strength)) {
		m_rumble_support_mask &= ~portMask;
		m_active_rumble_mask &= ~portMask;
		return;
	}
	if (strength == 0u) {
		m_active_rumble_mask &= ~portMask;
		return;
	}
	m_rumble_deadlines_ms[port] = m_current_time_ms + durationMs;
	m_active_rumble_mask |= portMask;
}

void LibretroInput::postKeyboardEvent(unsigned keycode, bool down) {
	if (keycode >= kRetroKeyHidUsages.size()) {
		return;
	}
	const i16 usage = kRetroKeyHidUsages[keycode];
	if (usage < 0) {
		return;
	}
	const size_t word = static_cast<size_t>(usage) >> 5u;
	const u32 mask = 1u << (static_cast<u32>(usage) & 31u);
	m_keyboard_usage_words[word] = down
		? m_keyboard_usage_words[word] | mask
		: m_keyboard_usage_words[word] & ~mask;
}

void LibretroInput::reset() {
	for (unsigned port = 0u; port < m_rumble_deadlines_ms.size(); port += 1u) {
		if ((m_active_rumble_mask & (1u << port)) != 0u) {
			setRumbleStrength(port, 0u);
		}
	}
	m_active_rumble_mask = 0u;
	m_keyboard_usage_words.fill(0u);
	m_routed_keyboard_usage_words.fill(0u);
	m_gamepads.fill({});
	m_pointer_buttons = 0u;
	m_pointer_x = 0;
	m_pointer_y = 0;
	m_pointer_x_q16 = 0u;
	m_pointer_y_q16 = 0u;
	m_pointer_wheel_q16 = 0u;
	m_pointer_position_valid = false;
	m_host_supervisor_request_high = false;
	m_gamepad_shortcuts = {};
	m_keyboard_shortcuts = {};
	m_just_pressed_host_shortcuts = 0u;
}

} // namespace bmsx
