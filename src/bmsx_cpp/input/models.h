/*
 * models.h - Input system type definitions for BMSX
 */

#ifndef BMSX_INPUTTYPES_H
#define BMSX_INPUTTYPES_H

#include "common/primitives.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <optional>
#include <variant>
#include <functional>
#include <memory>

namespace bmsx {

/* ============================================================================
 * Constants
 * ============================================================================ */

constexpr i32 PLAYERS_MAX = 4;
constexpr i32 DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
constexpr f64 ACTION_GUARD_MIN_MS = 24.0;
constexpr f64 ACTION_GUARD_MAX_MS = 120.0;
constexpr i32 INITIAL_REPEAT_DELAY_FRAMES = 15;
constexpr i32 REPEAT_INTERVAL_FRAMES = 4;
constexpr f64 INITIAL_REPEAT_DELAY_MS = INITIAL_REPEAT_DELAY_FRAMES * (1000.0 / 60.0);  // ~250ms
constexpr f64 REPEAT_INTERVAL_MS = REPEAT_INTERVAL_FRAMES * (1000.0 / 60.0);             // ~66ms

/* ============================================================================
 * Input source types
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

inline KeyModifier operator|(KeyModifier a, KeyModifier b) {
	return static_cast<KeyModifier>(static_cast<u8>(a) | static_cast<u8>(b));
}

inline KeyModifier operator&(KeyModifier a, KeyModifier b) {
	return static_cast<KeyModifier>(static_cast<u8>(a) & static_cast<u8>(b));
}

inline KeyModifier& operator|=(KeyModifier& a, KeyModifier b) {
	return a = a | b;
}

inline bool hasModifier(KeyModifier mask, KeyModifier flag) {
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
inline std::string gamepadButtonToString(GamepadButton btn) {
	static const char* names[] = {
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

// Generic button identifier
using ButtonId = std::string;

/* ============================================================================
 * Button state
 *
 * Represents the current state of a button/key.
 * ============================================================================ */

struct ButtonState {
	bool pressed = false;           // Currently pressed
	bool justpressed = false;       // Pressed this frame
	bool justreleased = false;      // Released this frame
	bool waspressed = false;        // Was pressed in recent window
	bool wasreleased = false;       // Was released in recent window
	bool consumed = false;          // Event has been consumed
	
	std::optional<f64> presstime;   // How long pressed (frames or ms)
	std::optional<f64> timestamp;   // When state changed
	std::optional<f64> pressedAtMs; // Timestamp when pressed
	std::optional<f64> releasedAtMs;// Timestamp when released
	std::optional<i32> pressId;     // Unique press identifier
	
	f32 value = 0.0f;               // Analog value (0-1 for buttons, full range for axes)
	std::optional<Vec2> value2d;    // 2D value for sticks
	
	// Default constructor
	ButtonState() = default;
	
	// Reset to default state
	void reset() {
		pressed = false;
		justpressed = false;
		justreleased = false;
		waspressed = false;
		wasreleased = false;
		consumed = false;
		presstime.reset();
		timestamp.reset();
		pressedAtMs.reset();
		releasedAtMs.reset();
		pressId.reset();
		value = 0.0f;
		value2d.reset();
	}
};

inline f64 buttonTimestampOr(const ButtonState& state, f64 fallback) {
	if (state.timestamp.has_value()) {
		return state.timestamp.value();
	}
	return fallback;
}

inline f64 buttonPressedAtOr(const ButtonState& state, f64 fallback) {
	if (state.pressedAtMs.has_value()) {
		return state.pressedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline f64 buttonReleasedAtOr(const ButtonState& state, f64 fallback) {
	if (state.releasedAtMs.has_value()) {
		return state.releasedAtMs.value();
	}
	return buttonTimestampOr(state, fallback);
}

inline i32 buttonPressIdOr(const ButtonState& state, i32 fallback) {
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return fallback;
}

inline i32 resolveButtonPressId(const std::optional<i32>& incoming, const ButtonState& state, i32& nextPressId) {
	if (incoming.has_value()) {
		return incoming.value();
	}
	if (state.pressId.has_value()) {
		return state.pressId.value();
	}
	return nextPressId++;
}

inline f64 buttonPressTimeOrZero(const ButtonState& state) {
	if (state.presstime.has_value()) {
		return state.presstime.value();
	}
	return 0.0;
}

/* ============================================================================
 * Action state
 *
 * Extended button state for logical actions.
 * ============================================================================ */

struct ActionState : ButtonState {
	std::string action;                     // Action name
	bool alljustpressed = false;            // All bindings just pressed
	bool allwaspressed = false;             // All bindings were pressed in window
	bool alljustreleased = false;           // All bindings just released
	std::optional<bool> guardedjustpressed; // Guarded press (debounced)
	std::optional<bool> repeatpressed;      // Repeat pulse
	std::optional<i32> repeatcount;         // Repeat count
	
	ActionState() = default;
	
	explicit ActionState(const std::string& actionName)
		: action(actionName) {}
	
	ActionState(const std::string& actionName, const ButtonState& state)
		: ButtonState(state), action(actionName) {}
};

inline bool actionFlag(const std::optional<bool>& flag) {
	return flag.has_value() && flag.value();
}

inline i32 actionRepeatCount(const ActionState& state) {
	if (state.repeatcount.has_value()) {
		return state.repeatcount.value();
	}
	return 0;
}

/* ============================================================================
 * Vibration parameters
 * ============================================================================ */

struct VibrationParams {
	f32 intensity = 0.0f;  // 0-1
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
	virtual ButtonState getButtonState(const ButtonId& button) = 0;
	
	// Mark a button as consumed
	virtual void consumeButton(const ButtonId& button) = 0;
	
	// Reset all or specific buttons
	virtual void reset(const std::vector<std::string>* except = nullptr) = 0;
	
	// Gamepad index (0 for keyboard, 0-3 for gamepads)
	virtual i32 gamepadIndex() const = 0;
	
	// Vibration support
	virtual bool supportsVibrationEffect() const = 0;
	virtual void applyVibrationEffect(const VibrationParams& params) = 0;
	
	// Cleanup
	virtual void dispose() = 0;
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
 * Action guard record (for debouncing)
 * ============================================================================ */

struct ActionGuardRecord {
	i64 lastAcceptedFrame = -1;
	i64 lastObservedFrame = -1;
	bool lastResultAccepted = false;
	i64 lastWindowFrames = 0;
	std::optional<i32> lastPressId;
};

/* ============================================================================
 * Action repeat record (for repeat pulse)
 * ============================================================================ */

struct SimActionRepeatRecord {
	bool active = false;
	i32 repeatCount = 0;
	i64 pressStartFrame = -1;
	i64 lastFrameEvaluated = -1;
	bool lastResult = false;
	i64 lastRepeatFrame = -1;
};

struct RawActionRepeatRecord {
	bool active = false;
	i32 repeatCount = 0;
	f64 pressStartMs = -1.0;
	i64 lastFrameEvaluated = -1;
	bool lastResult = false;
	f64 lastRepeatAtMs = -1.0;
};

/* ============================================================================
 * Pressed actions query
 * ============================================================================ */

struct PressedActionsQuery {
	std::vector<std::string> actionsByPriority;
};

/* ============================================================================
 * Action state getter function type
 * ============================================================================ */

using ActionStateGetter = std::function<ActionState(const std::string& actionName, std::optional<f64> windowMs)>;

} // namespace bmsx

#endif // BMSX_INPUTTYPES_H
