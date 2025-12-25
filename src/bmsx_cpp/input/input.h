/*
 * input.h - Main input system singleton for BMSX
 *
 * Manages player inputs, device bindings, and gamepad assignments.
 *
 * Mirrors TypeScript input/input.ts
 */

#ifndef BMSX_INPUT_H
#define BMSX_INPUT_H

#include "inputtypes.h"
#include "playerinput.h"
#include <array>
#include <memory>
#include <unordered_map>

namespace bmsx {

// Forward declarations
class KeyboardInput;
class GamepadInput;
class PointerInput;

/* ============================================================================
 * Device binding information
 * ============================================================================ */

struct DeviceBinding {
	InputHandler* handler = nullptr;
	InputSource source;
	std::optional<i32> assignedPlayer;
	std::string deviceId;
};

/* ============================================================================
 * Default input mappings
 *
 * Maps keyboard keys to gamepad-style buttons for consistent handling.
 * ============================================================================ */

struct KeyboardToGamepadMapping {
	// Movement keys
	static constexpr const char* UP = "ArrowUp";
	static constexpr const char* DOWN = "ArrowDown";
	static constexpr const char* LEFT = "ArrowLeft";
	static constexpr const char* RIGHT = "ArrowRight";
	
	// Alternative movement (WASD)
	static constexpr const char* UP_ALT = "KeyW";
	static constexpr const char* DOWN_ALT = "KeyS";
	static constexpr const char* LEFT_ALT = "KeyA";
	static constexpr const char* RIGHT_ALT = "KeyD";
	
	// Face buttons
	static constexpr const char* A = "KeyZ";
	static constexpr const char* B = "KeyX";
	static constexpr const char* X = "KeyC";
	static constexpr const char* Y = "KeyV";
	
	// Shoulder buttons
	static constexpr const char* L1 = "KeyQ";
	static constexpr const char* R1 = "KeyE";
	
	// Start/Select
	static constexpr const char* START = "Enter";
	static constexpr const char* SELECT = "Escape";
};

/* ============================================================================
 * Input
 *
 * Singleton managing all input for the game.
 * ============================================================================ */

class Input {
public:
	// ─────────────────────────────────────────────────────────────────────────
	// Constants
	// ─────────────────────────────────────────────────────────────────────────
	
	static constexpr i32 DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
	
	// Standard gamepad button IDs
	static const std::vector<std::string>& BUTTON_IDS();
	
	// Keyboard key to gamepad button mapping
	static const std::unordered_map<std::string, std::string>& KEYBOARD_TO_GAMEPAD();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Singleton access
	// ─────────────────────────────────────────────────────────────────────────
	
	static Input& instance();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	
	void initialize();
	void shutdown();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Player input access
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get player input for a specific player index
	PlayerInput* getPlayerInput(i32 playerIndex);
	
	// Get all player inputs
	const std::array<std::unique_ptr<PlayerInput>, PLAYERS_MAX>& playerInputs() const {
		return m_playerInputs;
	}
	
	// ─────────────────────────────────────────────────────────────────────────
	// Device management
	// ─────────────────────────────────────────────────────────────────────────
	
	// Register a keyboard handler
	void registerKeyboard(const std::string& deviceId, InputHandler* handler);
	
	// Register a gamepad handler
	void registerGamepad(const std::string& deviceId, InputHandler* handler);
	
	// Register a pointer handler
	void registerPointer(const std::string& deviceId, InputHandler* handler);
	
	// Unregister a device
	void unregisterDevice(const std::string& deviceId);
	
	// Get binding for device
	DeviceBinding* getDeviceBinding(const std::string& deviceId);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Gamepad assignment
	// ─────────────────────────────────────────────────────────────────────────
	
	// Assign a gamepad to a player
	void assignGamepadToPlayer(InputHandler* gamepad, i32 playerIndex);
	
	// Get first available player index for gamepad
	std::optional<i32> getFirstAvailablePlayerIndexForGamepad(i32 from = 1, bool reverse = false);
	
	// Check if player index is available for gamepad assignment
	bool isPlayerIndexAvailableForGamepad(i32 playerIndex);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Input mapping
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get default input mapping
	static InputMap getDefaultInputMapping();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Frame update
	// ─────────────────────────────────────────────────────────────────────────
	
	// Poll all inputs (call once per frame)
	void pollInput();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Button event handling (from platform)
	// ─────────────────────────────────────────────────────────────────────────
	
	// Handle keyboard event
	void handleKeyboardEvent(const std::string& deviceId, const std::string& keyCode, bool down);
	
	// Handle gamepad button event
	void handleGamepadButtonEvent(const std::string& deviceId, const std::string& button, 
								   bool down, f32 value = 1.0f);
	
	// Handle gamepad axis event
	void handleGamepadAxisEvent(const std::string& deviceId, const std::string& axis, 
								 f32 x, f32 y = 0.0f);
	
	// Handle pointer button event
	void handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down);
	
	// Handle pointer move event
	void handlePointerMoveEvent(const std::string& deviceId, f32 x, f32 y);
	
private:
	// ─────────────────────────────────────────────────────────────────────────
	// Singleton
	// ─────────────────────────────────────────────────────────────────────────
	
	Input();
	~Input();
	
	Input(const Input&) = delete;
	Input& operator=(const Input&) = delete;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Data members
	// ─────────────────────────────────────────────────────────────────────────
	
	// Player inputs (0 = keyboard player, 1-3 = gamepad players)
	std::array<std::unique_ptr<PlayerInput>, PLAYERS_MAX> m_playerInputs;
	
	// Device bindings by device ID
	std::unordered_map<std::string, DeviceBinding> m_deviceBindings;
	
	// Initialization state
	bool m_initialized = false;
	
	// Current time (updated each poll)
	f64 m_currentTimeMs = 0.0;

	i32 m_nextPressId = 1;
	std::unordered_map<std::string, i32> m_activePressIds;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────
	
	void enqueueButtonEvent(i32 playerIndex, const std::string& code, 
							InputEvent::Type type, f64 timestamp, 
							std::optional<i32> pressId);
	i32 assignPressId(const std::string& deviceId, const std::string& code, bool down);
	i32 toInternalPlayerIndex(i32 playerIndex) const { return playerIndex - 1; }
};

/* ============================================================================
 * Helper functions
 * ============================================================================ */

// Create a default button state
ButtonState makeButtonState();
ButtonState makeButtonState(const ButtonState& init);

// Create a default action state
ActionState makeActionState(const std::string& action);
ActionState makeActionState(const std::string& action, const ButtonState& state);

// Reset an object map, optionally excluding certain keys
template<typename MapType>
void resetObjectMap(MapType& map, const std::vector<std::string>* except = nullptr) {
	if (!except) {
		map.clear();
		return;
	}
	
	for (auto it = map.begin(); it != map.end(); ) {
		bool found = false;
		for (const auto& e : *except) {
			if (it->first == e) {
				found = true;
				break;
			}
		}
		if (!found) {
			it = map.erase(it);
		} else {
			++it;
		}
	}
}

// Get pressed state for a button from a state map
ButtonState getPressedState(const std::unordered_map<std::string, ButtonState>& states, 
							const std::string& button);

} // namespace bmsx

#endif // BMSX_INPUT_H
