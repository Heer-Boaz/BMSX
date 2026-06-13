/*
 * models.h - Input system type definitions for BMSX
 */

#ifndef BMSX_INPUTTYPES_H
#define BMSX_INPUTTYPES_H

#include "common/primitives.h"
#include "machine/devices/input/contracts.h"
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#include <optional>
#include <variant>
#include <functional>
#include <memory>

namespace bmsx {

/* ============================================================================
 * Host-owned input vocabulary
 * The machine ICU only sees raw snapshot words; key names, button names, and
 * rich button state live at the host layer. Mirrors machine/ts/input/models.ts.
 * ============================================================================ */

enum class InputSource {
	Keyboard,
	Gamepad,
	Pointer
};

inline const InputSource INPUT_SOURCES[] = {
	InputSource::Keyboard,
	InputSource::Gamepad,
	InputSource::Pointer
};

constexpr size_t INPUT_SOURCE_COUNT = 3;

using ButtonId = std::string;

struct ButtonState {
	bool pressed = false;
	bool justpressed = false;
	bool justreleased = false;
	bool waspressed = false;
	bool wasreleased = false;
	bool repeatpressed = false;
	i32 repeatcount = 0;
	bool consumed = false;

	std::optional<f64> presstime;
	std::optional<f64> timestamp;
	std::optional<f64> pressedAtMs;
	std::optional<f64> releasedAtMs;
	std::optional<i32> pressId;

	f32 value = 0.0F;
	std::optional<Vec2> value2d;

	ButtonState() = default;

	void reset() {
		pressed = false;
		justpressed = false;
		justreleased = false;
		waspressed = false;
		wasreleased = false;
		repeatpressed = false;
		repeatcount = 0;
		consumed = false;
		presstime.reset();
		timestamp.reset();
		pressedAtMs.reset();
		releasedAtMs.reset();
		pressId.reset();
		value = 0.0F;
		value2d.reset();
	}
};

/* ============================================================================
 * Constants
 * ============================================================================ */

constexpr i32 PLAYERS_MAX = 4;
constexpr i32 DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
constexpr i32 INITIAL_REPEAT_DELAY_FRAMES = 15;
constexpr i32 REPEAT_INTERVAL_FRAMES = 4;
constexpr f64 INITIAL_REPEAT_DELAY_MS = INITIAL_REPEAT_DELAY_FRAMES * (1000.0 / 60.0);  // ~250ms
constexpr f64 REPEAT_INTERVAL_MS = REPEAT_INTERVAL_FRAMES * (1000.0 / 60.0);             // ~66ms

/* ============================================================================
 * Key modifier flags
 * ============================================================================ */

enum class KeyModifier : u8 {
	None  = 0,
	Shift = 1 << 0,
	Ctrl  = 1 << 1,
	Alt   = 1 << 2,
	Meta  = 1 << 3
};

inline auto operator|(KeyModifier a, KeyModifier b) -> KeyModifier {
	return static_cast<KeyModifier>(static_cast<u8>(a) | static_cast<u8>(b));
}

inline auto operator&(KeyModifier a, KeyModifier b) -> KeyModifier {
	return static_cast<KeyModifier>(static_cast<u8>(a) & static_cast<u8>(b));
}

inline auto operator|=(KeyModifier& a, KeyModifier b) -> KeyModifier& {
	return a = a | b;
}

inline auto hasModifier(KeyModifier mask, KeyModifier flag) -> bool {
	return (static_cast<u8>(mask) & static_cast<u8>(flag)) != 0;
}

/* ============================================================================
 * Button identifiers
 * ============================================================================ */

// Keyboard button IDs (matching DOM KeyboardEvent.code)
using KeyboardButtonId = std::string;

// Gamepad button IDs
enum class GamepadButton : u8 {
	A,           // Face button (A/Cross)
	B,           // Face button (B/Circle)
	X,           // Face button (X/Square)
	Y,           // Face button (Y/Triangle)
	L1,          // Left bumper
	R1,          // Right bumper
	L2,          // Left trigger
	R2,          // Right trigger
	Select,      // Select/Back
	Start,       // Start/Options
	L3,          // Left stick button
	R3,          // Right stick button
	Up,          // D-pad up
	Down,        // D-pad down
	Left,        // D-pad left
	Right,       // D-pad right
	Home,        // Home/Guide button
	Touchpad,    // Touchpad button (PS4/PS5)
	
	// Analog sticks (represented as buttons for state tracking)
	LeftStickX,
	LeftStickY,
	RightStickX,
	RightStickY,
	
	COUNT
};

// Convert GamepadButton enum to string ID
inline auto gamepadButtonToString(GamepadButton btn) -> std::string {
	static const char* const names[] = {
		"a", "b", "x", "y",
		"lb", "rb", "lt", "rt",
		"select", "start", "ls", "rs",
		"up", "down", "left", "right",
		"home", "touch",
		"leftstick_x", "leftstick_y",
		"rightstick_x", "rightstick_y"
	};
	return names[static_cast<size_t>(btn)];
}

/* ============================================================================
 * Vibration parameters
 * ============================================================================ */

struct VibrationParams {
	f32 intensity = 0.0F;  // 0-1
	f64 duration = 0.0;    // milliseconds
};

/* ============================================================================
 * Input handler interface
 *
 * Implemented by keyboard, gamepad, pointer input handlers.
 * ============================================================================ */

class InputHandler {
public:
	virtual ~InputHandler() = default;
	
	// Poll for new input events
	virtual void pollInput() = 0;
	
	// Get state of a specific button
	virtual auto getButtonState(const ButtonId& button) -> ButtonState = 0;

	virtual void writeInputControllerKeyWords(std::array<u32, INPUT_CONTROLLER_KEY_WORD_COUNT>& keyWords) const = 0;
	virtual void writeInputControllerPointerSnapshot(InputControllerSnapshot& snapshot) const = 0;
	virtual void writeInputControllerPadSnapshot(InputControllerPadSnapshot& snapshot) const = 0;
	
	// Mark a button as consumed
	virtual void consumeButton(const ButtonId& button) = 0;
	
	// Reset all or specific buttons
	virtual void reset(const std::vector<std::string>* except = nullptr) = 0;
	
	// Gamepad index (0 for keyboard, 0-3 for gamepads)
	[[nodiscard]] virtual auto gamepadIndex() const -> i32 = 0;
	
	// Vibration support
	[[nodiscard]] virtual auto supportsVibrationEffect() const -> bool = 0;
	virtual void applyVibrationEffect(const VibrationParams& params) = 0;
};

/* ============================================================================
 * Input bindings
 * ============================================================================ */

struct KeyboardBinding {
	std::string id;                          // Key code (e.g., "KeyW", "Space")
	std::optional<KeyModifier> modifiers;    // Required modifier keys
};

struct GamepadBinding {
	std::string id;                          // Button ID (e.g., "a", "start")
	std::optional<f32> threshold;            // Activation threshold for analog
};

struct PointerBinding {
	std::string id;                          // Pointer action ID
};

// Variants for polymorphic binding storage
using InputBinding = std::variant<KeyboardBinding, GamepadBinding, PointerBinding>;

inline auto inputBindingId(const InputBinding& binding) -> const std::string& {
	return std::visit([](const auto& typedBinding) -> const std::string& {
		return typedBinding.id;
	}, binding);
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

using KeyboardInputMapping = std::unordered_map<std::string, std::vector<KeyboardBinding>>;
using GamepadInputMapping = std::unordered_map<std::string, std::vector<GamepadBinding>>;
using PointerInputMapping = std::unordered_map<std::string, std::vector<PointerBinding>>;

struct InputMap {
	KeyboardInputMapping keyboard;
	GamepadInputMapping gamepad;
	PointerInputMapping pointer;
};

/* ============================================================================
 * Input event for buffering
 * ============================================================================ */

struct InputEvent {
	enum class Type { Press, Release };
	
	Type eventType = Type::Press;
	std::string identifier;    // Button/key identifier
	f64 timestamp = 0.0;
	bool consumed = false;
	std::optional<i32> pressId;
};

/* ============================================================================
 * Raw button repeat record (for repeat pulse)
 * ============================================================================ */

struct RawActionRepeatRecord {
	bool active = false;
	i32 repeatCount = 0;
	f64 pressStartMs = -1.0;
	i64 lastFrameEvaluated = -1;
	bool lastResult = false;
	f64 lastRepeatAtMs = -1.0;
};

/* ============================================================================
 * Button state helpers (input subsystem internal use)
 * ============================================================================ */

inline auto buttonTimestampOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.timestamp.has_value()) {
		return state.timestamp.value();
	}
	return fallback;
}

inline auto buttonPressedAtOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.pressedAtMs.has_value()) {
		return state.pressedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline auto buttonReleasedAtOr(const ButtonState& state, f64 fallback) -> f64 {
	if (state.releasedAtMs.has_value()) {
		return state.releasedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline auto buttonPressIdOr(const ButtonState& state, i32 fallback) -> i32 {
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return fallback;
}

inline auto resolveButtonPressId(const std::optional<i32>& incoming, const ButtonState& state, i32& nextPressId) -> i32 {
	if (incoming.has_value()) {
		return incoming.value();
	}
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return nextPressId++;
}

inline auto buttonPressTimeOrZero(const ButtonState& state) -> f64 {
	if (state.presstime.has_value()) {
		return state.presstime.value();
	}
	return 0.0;
}

/* ============================================================================
 * ActionState (input subsystem internal)
 * ============================================================================ */

struct ActionState : ButtonState {
	std::string action;
	bool alljustpressed = false;
	bool allwaspressed = false;
	bool alljustreleased = false;
	std::optional<bool> guardedjustpressed;
	std::optional<bool> repeatpressed;
	std::optional<i32> repeatcount;

	ActionState() = default;

	explicit ActionState(std::string actionName)
		: action(std::move(actionName)) {}

	ActionState(std::string actionName, const ButtonState& state)
		: ButtonState(state), action(std::move(actionName)) {}
};

inline auto actionFlag(const std::optional<bool>& flag) -> bool {
	return flag.has_value() && flag.value();
}

inline auto actionRepeatCount(const ActionState& state) -> i32 {
	if (state.repeatcount.has_value()) {
		return state.repeatcount.value();
	}
	return 0;
}

/* ============================================================================
 * Action state getter function type
 * ============================================================================ */

using ActionStateGetter = std::function<ActionState(const std::string& actionName, std::optional<f64> windowMs)>;

} // namespace bmsx

#endif // BMSX_INPUTTYPES_H
