/*
 * input.h - Main input system singleton for BMSX
 *
 * Manages player inputs, device bindings, and gamepad assignments.
 */

#ifndef BMSX_INPUT_H
#define BMSX_INPUT_H

#include "models.h"
#include "common/subscription.h"
#include "machine/runtime/input.h"
#include <array>
#include <deque>
#include <memory>
#include <unordered_map>

namespace bmsx {

// Forward declarations
class KeyboardInput;
class GamepadInput;
class PointerInput;
class PlayerInput;

class InputStateManager {
public:
	InputStateManager();
	~InputStateManager() = default;

	void beginFrame(f64 currentTimeMs);
	void update(f64 currentTimeMs);
	void addInputEvent(InputEvent evt);
	void recordAxis1Sample(const std::string& button, f32 value, f64 timestamp);
	void recordAxis2Sample(const std::string& button, f32 x, f32 y, f64 timestamp);
	void latchButtonState(const std::string& button, const ButtonState& rawState, f64 currentTimeMs);
	void consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId);
	auto getButtonState(const std::string& button, std::optional<i32> windowFrames = std::nullopt) const -> ButtonState;
	auto getLatestUnconsumedEdgeId(const std::string& button, InputEvent::Type eventType) const -> std::optional<i32>;
	auto hasTrackedButton(const std::string& button) const -> bool;
	auto frame() const -> i64 { return m_currentFrame; }
	void resetEdgeState();
	void clear();

private:
	struct BufferedInputEvent {
		InputEvent event;
		i64 frame = -1;
	};

	struct BufferedEdgeRecord {
		i32 edgeId = -1;
		i64 frame = -1;
		bool consumed = false;
	};

	std::deque<BufferedInputEvent> m_inputBuffer;
	std::unordered_map<std::string, ButtonState> m_buttonStates;
	std::unordered_map<std::string, ButtonState> m_pendingFrameStates;
	std::unordered_map<std::string, BufferedEdgeRecord> m_bufferedPressEdges;
	std::unordered_map<std::string, BufferedEdgeRecord> m_bufferedReleaseEdges;
	i64 m_currentFrame = 0;
	f64 m_currentTimeMs = 0.0;

	static constexpr i32 BUFFER_FRAME_RETENTION = 150;
	static constexpr i32 RECENT_BUFFERED_EDGE_FRAMES = 2;

	auto getBufferedEdgeRecord(const std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const std::string& button, i32 windowFrames) const -> std::optional<BufferedEdgeRecord>;
	auto isBufferedFrameInWindow(i64 frame, i32 windowFrames) const -> bool;
	void bufferEdge(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const BufferedInputEvent& event);
	void consumeBufferedEdge(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const std::string& identifier, std::optional<i32> pressId);
	void pruneOldEvents();
	void pruneBufferedEdges(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap);
};

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

/* ============================================================================
 * Input
 *
 * Singleton managing all input for the game.
 * ============================================================================ */

class Input : public RuntimeInputSource {
public:
	// ─────────────────────────────────────────────────────────────────────────
	// Constants
	// ─────────────────────────────────────────────────────────────────────────
	
	static constexpr i32 DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
	
	// Keyboard key to gamepad button mapping
	static const std::unordered_map<std::string, std::string> KEYBOARD_TO_GAMEPAD;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Singleton access
	// ─────────────────────────────────────────────────────────────────────────
	
	static auto instance() -> Input&;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────
	
	void initialize();
	void shutdown();
	
	// ─────────────────────────────────────────────────────────────────────────
	// Player input access
	// ─────────────────────────────────────────────────────────────────────────
	
	// Get player input for a specific player index
	auto getPlayerInput(i32 playerIndex) -> PlayerInput*;
	void applyInputControllerVibrationEffect(i32 padIndex, f64 durationMs, f32 intensity) override;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Device management
	// ─────────────────────────────────────────────────────────────────────────

	void registerDeviceBinding(const std::string& deviceId, InputHandler* handler, InputSource source, std::optional<i32> assignedPlayer);
	
	// Unregister a device
	void unregisterDevice(const std::string& deviceId);
	
	// ─────────────────────────────────────────────────────────────────────────
	// Gamepad assignment
	// ─────────────────────────────────────────────────────────────────────────
	
	// Assign a gamepad to a player
	void assignGamepadToPlayer(InputHandler* gamepad, i32 playerIndex);
	
	// Get first available player index for gamepad
	auto getFirstAvailablePlayerIndexForGamepadAssignment(i32 from = 1, bool reverse = false) -> std::optional<i32>;
	
	// Check if player index is available for gamepad assignment
	auto isPlayerIndexAvailableForGamepadAssignment(i32 playerIndex) -> bool;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Input mapping
	// ─────────────────────────────────────────────────────────────────────────
	static const InputMap DEFAULT_INPUT_MAPPING;
	void setRuntimeInputFrameDurationMs(f64 frameDurationMs) override;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Frame update
	// ─────────────────────────────────────────────────────────────────────────
	
	// Poll all inputs (call once per frame)
	void pollInput();

	// Latch the raw input snapshot for one cart-visible simulation frame
	void sampleInputControllerSnapshot(f64 currentTimeMs, InputControllerSnapshot& snapshot) override;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Button event handling (from platform)
	// ─────────────────────────────────────────────────────────────────────────
	
	// Handle keyboard event
	void handleKeyboardEvent(const std::string& deviceId, const std::string& keyCode, bool down);
	
	// Handle gamepad button event
	void handleGamepadButtonEvent(const std::string& deviceId, const std::string& button, 
									bool down, f32 value = 1.0F);
	
	// Handle gamepad axis event
	void handleGamepadAxisEvent(const std::string& deviceId, const std::string& axis, 
									f32 x, f32 y = 0.0F);
	
	// Handle pointer button event
	void handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down);
	
	// Handle pointer move event
	void handlePointerMoveEvent(const std::string& deviceId, f32 x, f32 y);

	// Handle pointer wheel event
	void handlePointerWheelEvent(const std::string& deviceId, f32 value);
	
private:
	// ─────────────────────────────────────────────────────────────────────────
	// Singleton
	// ─────────────────────────────────────────────────────────────────────────
	
	Input();
	~Input();
	
	Input(const Input&) = delete;
	auto operator=(const Input&) -> Input& = delete;
	
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
	f64 m_frameDurationMs = 1000.0 / 60.0;

	i32 m_nextPressId = 1;
	std::unordered_map<std::string, i32> m_activePressIds;
	SubscriptionHandle m_focusChangeSub;
	
	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────
	
	void handleFocusChange(bool focused);
	void enqueueButtonEvent(i32 playerIndex, InputSource source, const std::string& code,
							InputEvent::Type type, f64 timestamp,
							std::optional<i32> pressId);
	auto resolvePlatformPressId(const std::string& deviceId, const std::string& code, bool down) -> i32;
	void samplePadSnapshot(i32 pad, InputControllerSnapshot& snapshot);
};

/* ============================================================================
 * Helper functions
 * ============================================================================ */

// Create a default button state
auto makeButtonState() -> ButtonState;
auto makeButtonState(const ButtonState& init) -> ButtonState;

// Create a default action state
auto makeActionState(const std::string& action) -> ActionState;
auto makeActionState(const std::string& action, const ButtonState& state) -> ActionState;

// Reset an object map, optionally excluding certain keys
template<typename MapType>
void resetObject(MapType& map, const std::vector<std::string>* except = nullptr) {
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
auto getPressedState(const std::unordered_map<std::string, ButtonState>& states,
							const std::string& button) -> ButtonState;

} // namespace bmsx

#endif // BMSX_INPUT_H
