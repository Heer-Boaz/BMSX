#pragma once

#include "bmsx_libretro.h"
#include "host_shortcuts.h"
#include "hid_keys.h"
#include "machine/devices/input/contracts.h"

#include <array>
#include <span>
#include <vector>

namespace bmsx {

inline constexpr f64 HOST_MENU_HOLD_MS = 500.0;

inline constexpr u32 HOST_GAMEPAD_SHORTCUT_TARGETS =
	(1u << static_cast<u32>(InputControllerGamepadButtonBit::X))
	| (1u << static_cast<u32>(InputControllerGamepadButtonBit::Start))
	| (1u << static_cast<u32>(InputControllerGamepadButtonBit::LeftBumper));

enum class HostMenuShortcutAction : u8 {
	None,
	Menu,
	Rewind,
};

struct LibretroPointerContact {
	i32 x;
	i32 y;
};

class LibretroInput final : public InputControllerInputSource {
public:
	explicit LibretroInput(
		bmsx_supervisor_request_line_t supervisorRequestLine);

	void poll(i32 viewportWidth, i32 viewportHeight, f64 currentTimeMs);
	void setInputPollCallback(retro_input_poll_t callback) { m_input_poll_callback = callback; }
	void setInputStateCallback(retro_input_state_t callback) { m_input_state_callback = callback; }
	void installRumbleInterface(retro_rumble_interface rumbleInterface);
	void setControllerDevice(unsigned port, unsigned device);
	void postKeyboardEvent(unsigned keycode, bool down);
	void setVirtualKeyboardKey(u8 usage, bool down);
	void reset();

	size_t physicalOrdinaryHeldCount() const { return m_ordinary_held_count; }
	u64 physicalOrdinaryPressGeneration() const { return m_ordinary_press_generation; }
	u8 routedPhysicalModifierMask() const { return static_cast<u8>(m_routed_physical_keyboard_usage_words[hid_key_usage::ModifierFirstUsage >> 5] & 0xffu); }
	bool physicalKeyboardUsagePressed(u8 usage) const;
	void consumePhysicalKeyboardUsage(u8 usage);
	bool gamepadButtonPressed(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button) const;
	u32 physicalGamepadButtonsWord(u8 deviceSlot) const;
	u32 physicalGamepadAxisWord(
		u8 deviceSlot,
		InputControllerGamepadAxis axis) const;
	void consumeGamepadButton(
		u8 deviceSlot,
		InputControllerGamepadButtonBit button);
	void consumeGamepadButtons(u8 deviceSlot, u32 buttons);
	void consumeGamepadInput(u8 deviceSlot);
	void setGamepadHostShortcutTargets(u32 targets);
	void cancelControlShortcutGestures();
	void cancelKeyboardControlShortcutGesture();
	void cancelGamepadControlShortcutGesture(unsigned port);
	HostMenuShortcutAction hostMenuShortcutAction() const {
		return m_host_menu_shortcut_action;
	}
	f64 pollTimestampMs() const { return m_current_time_ms; }
	bool pointerPosition(i32& x, i32& y) const;
	bool pointerButtonPressed(u32 button) const;
	void consumePointerButton(u32 button);
	// Libretro pointer indexes describe this poll's contacts, not stable identities.
	std::span<const LibretroPointerContact> pointerContacts() const {
		return {m_pointer_contacts.data(), m_pointer_contact_count};
	}
	bool mousePosition(i32& x, i32& y) const;
	bool mouseButtonPressed(u32 button) const;
	bool hostShortcutJustPressed(InputControllerGamepadButtonBit button) const;
	f64 frameDurationMs() const { return m_frame_duration_ms; }
	void setFrameDurationMs(f64 frameDurationMs) {
		m_frame_duration_ms = frameDurationMs;
	}

	void sampleInputControllerSnapshot(
		InputControllerSnapshot& snapshot,
		InputControllerSampleContext context) override;
	bool supervisorRequestLineHigh() const override {
		return m_host_supervisor_request_high;
	}
	void applyInputControllerVibrationEffect(
		i32 padIndex,
		f64 durationMs,
		f64 intensity) override;

private:
	bool setRumbleStrength(unsigned port, u16 strength);

	bmsx_supervisor_request_line_t m_supervisor_request_line;
	retro_input_poll_t m_input_poll_callback = nullptr;
	retro_input_state_t m_input_state_callback = nullptr;
	retro_rumble_interface m_rumble_interface{};
	std::array<unsigned, INPUT_CONTROLLER_PAD_COUNT> m_controller_devices{};
	std::array<f64, INPUT_CONTROLLER_PAD_COUNT> m_rumble_deadlines_ms{};
	size_t m_ordinary_held_count = 0;
	u64 m_ordinary_press_generation = 0;
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_virtual_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_polled_virtual_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT> m_routed_physical_keyboard_usage_words{};
	std::array<u32, INPUT_CONTROLLER_PAD_COUNT> m_physical_gamepad_buttons{};
	std::array<std::array<u32, INPUT_CONTROLLER_PAD_AXIS_COUNT>, INPUT_CONTROLLER_PAD_COUNT>
		m_physical_gamepad_axes_q16{};
	std::array<InputControllerPadSnapshot, INPUT_CONTROLLER_PAD_COUNT> m_gamepads{};
	u32 m_pointer_buttons = 0u;
	u32 m_routed_pointer_buttons = 0u;
	// Keep high-water storage across polls; only the published span is active.
	std::vector<LibretroPointerContact> m_pointer_contacts;
	size_t m_pointer_contact_count = 0;
	u32 m_mouse_buttons = 0u;
	i32 m_mouse_x = 0;
	i32 m_mouse_y = 0;
	bool m_mouse_position_valid = false;
	i32 m_pointer_x = 0;
	i32 m_pointer_y = 0;
	u32 m_pointer_x_q16 = 0u;
	u32 m_pointer_y_q16 = 0u;
	u32 m_pointer_wheel_q16 = 0u;
	u32 m_rumble_support_mask = 0u;
	u32 m_active_rumble_mask = 0u;
	f64 m_current_time_ms = 0.0;
	f64 m_frame_duration_ms = 1000.0 / 60.0;
	bool m_pointer_position_valid = false;
	bool m_host_supervisor_request_high = false;
	std::array<BmsxHostShortcutState, INPUT_CONTROLLER_PAD_COUNT>
		m_gamepad_shortcuts{};
	BmsxHostShortcutState m_keyboard_shortcuts{};
	u32 m_gamepad_host_shortcut_targets = 0u;
	u32 m_just_pressed_host_shortcuts = 0u;
	HostMenuShortcutAction m_host_menu_shortcut_action = HostMenuShortcutAction::None;
};

} // namespace bmsx
