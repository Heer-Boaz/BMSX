/*
 * input.cpp - Main input system implementation
 *
 * Mirrors TypeScript input/input.ts
 */

#include "input.h"

namespace bmsx {

/* ============================================================================
 * Static data
 * ============================================================================ */

const std::vector<std::string>& Input::BUTTON_IDS() {
	static const std::vector<std::string> ids = {
		"a", "b", "x", "y",
		"l1", "r1", "l2", "r2",
		"select", "start", "l3", "r3",
		"up", "down", "left", "right",
		"home", "touchpad",
		"leftstick", "rightstick"
	};
	return ids;
}

const std::unordered_map<std::string, std::string>& Input::KEYBOARD_TO_GAMEPAD() {
	static const std::unordered_map<std::string, std::string> mapping = {
		// Arrow keys
		{"ArrowUp", "up"},
		{"ArrowDown", "down"},
		{"ArrowLeft", "left"},
		{"ArrowRight", "right"},
		
		// WASD alternative
		{"KeyW", "up"},
		{"KeyS", "down"},
		{"KeyA", "left"},
		{"KeyD", "right"},
		
		// Face buttons
		{"KeyZ", "a"},
		{"KeyX", "b"},
		{"KeyC", "x"},
		{"KeyV", "y"},
		{"Space", "a"},
		
		// Shoulder buttons
		{"KeyQ", "l1"},
		{"KeyE", "r1"},
		
		// Start/Select
		{"Enter", "start"},
		{"Escape", "select"}
	};
	return mapping;
}

/* ============================================================================
 * Singleton
 * ============================================================================ */

Input& Input::instance() {
	static Input instance;
	return instance;
}

Input::Input() {
	// Create player inputs
	for (i32 i = 0; i < PLAYERS_MAX; i++) {
		m_playerInputs[i] = std::make_unique<PlayerInput>(i);
	}
}

Input::~Input() {
	shutdown();
}

/* ============================================================================
 * Lifecycle
 * ============================================================================ */

void Input::initialize() {
	if (m_initialized) return;
	
	// Set up default input mapping for keyboard player
	auto defaultMapping = getDefaultInputMapping();
	m_playerInputs[DEFAULT_KEYBOARD_PLAYER_INDEX]->setInputMap(defaultMapping);
	
	m_initialized = true;
}

void Input::shutdown() {
	if (!m_initialized) return;
	
	// Clear device bindings
	m_deviceBindings.clear();
	
	// Reset player inputs
	for (auto& player : m_playerInputs) {
		if (player) {
			player->reset();
		}
	}
	
	m_initialized = false;
}

/* ============================================================================
 * Player input access
 * ============================================================================ */

PlayerInput* Input::getPlayerInput(i32 playerIndex) {
	if (playerIndex < 0 || playerIndex >= PLAYERS_MAX) {
		return nullptr;
	}
	return m_playerInputs[playerIndex].get();
}

/* ============================================================================
 * Device management
 * ============================================================================ */

void Input::registerKeyboard(const std::string& deviceId, InputHandler* handler) {
	DeviceBinding binding;
	binding.handler = handler;
	binding.source = InputSource::Keyboard;
	binding.assignedPlayer = DEFAULT_KEYBOARD_PLAYER_INDEX;
	binding.deviceId = deviceId;
	
	m_deviceBindings[deviceId] = binding;
	
	// Assign to keyboard player
	m_playerInputs[DEFAULT_KEYBOARD_PLAYER_INDEX]->setHandler(InputSource::Keyboard, handler);
}

void Input::registerGamepad(const std::string& deviceId, InputHandler* handler) {
	DeviceBinding binding;
	binding.handler = handler;
	binding.source = InputSource::Gamepad;
	binding.assignedPlayer = std::nullopt;  // Not assigned yet
	binding.deviceId = deviceId;
	
	m_deviceBindings[deviceId] = binding;
}

void Input::registerPointer(const std::string& deviceId, InputHandler* handler) {
	DeviceBinding binding;
	binding.handler = handler;
	binding.source = InputSource::Pointer;
	binding.assignedPlayer = DEFAULT_KEYBOARD_PLAYER_INDEX;
	binding.deviceId = deviceId;
	
	m_deviceBindings[deviceId] = binding;
	
	// Assign to keyboard player
	m_playerInputs[DEFAULT_KEYBOARD_PLAYER_INDEX]->setHandler(InputSource::Pointer, handler);
}

void Input::unregisterDevice(const std::string& deviceId) {
	auto it = m_deviceBindings.find(deviceId);
	if (it == m_deviceBindings.end()) return;
	
	auto& binding = it->second;
	
	// Clear from assigned player
	if (binding.assignedPlayer.has_value()) {
		auto* player = m_playerInputs[binding.assignedPlayer.value()].get();
		if (player) {
			if (binding.source == InputSource::Gamepad) {
				player->clearHandler(InputSource::Gamepad);
			} else if (binding.source == InputSource::Keyboard) {
				player->clearHandler(InputSource::Keyboard);
			} else if (binding.source == InputSource::Pointer) {
				player->clearHandler(InputSource::Pointer);
			}
		}
	}
	
	// Reset handler
	if (binding.handler) {
		binding.handler->reset();
	}
	
	m_deviceBindings.erase(it);
}

DeviceBinding* Input::getDeviceBinding(const std::string& deviceId) {
	auto it = m_deviceBindings.find(deviceId);
	if (it == m_deviceBindings.end()) return nullptr;
	return &it->second;
}

/* ============================================================================
 * Gamepad assignment
 * ============================================================================ */

void Input::assignGamepadToPlayer(InputHandler* gamepad, i32 playerIndex) {
	if (playerIndex < 0 || playerIndex >= PLAYERS_MAX) return;
	
	auto* player = m_playerInputs[playerIndex].get();
	player->assignGamepad(gamepad);
	
	// Update binding
	for (auto& [id, binding] : m_deviceBindings) {
		if (binding.handler == gamepad) {
			binding.assignedPlayer = playerIndex;
			break;
		}
	}
	
	// Set default input mapping if not already set
	auto defaultMapping = getDefaultInputMapping();
	player->setInputMap(defaultMapping);
}

std::optional<i32> Input::getFirstAvailablePlayerIndexForGamepad(i32 from, bool reverse) {
	if (reverse) {
		for (i32 i = from; i >= 1; i--) {
			if (isPlayerIndexAvailableForGamepad(i)) {
				return i;
			}
		}
	} else {
		for (i32 i = from; i < PLAYERS_MAX; i++) {
			if (isPlayerIndexAvailableForGamepad(i)) {
				return i;
			}
		}
	}
	return std::nullopt;
}

bool Input::isPlayerIndexAvailableForGamepad(i32 playerIndex) {
	if (playerIndex < 0 || playerIndex >= PLAYERS_MAX) return false;
	
	auto* player = m_playerInputs[playerIndex].get();
	return player->getHandler(InputSource::Gamepad) == nullptr;
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

InputMap Input::getDefaultInputMapping() {
	InputMap map;
	
	// Keyboard mappings
	map.keyboard["up"] = {{.id = "ArrowUp"}, {.id = "KeyW"}};
	map.keyboard["down"] = {{.id = "ArrowDown"}, {.id = "KeyS"}};
	map.keyboard["left"] = {{.id = "ArrowLeft"}, {.id = "KeyA"}};
	map.keyboard["right"] = {{.id = "ArrowRight"}, {.id = "KeyD"}};
	map.keyboard["a"] = {{.id = "KeyZ"}, {.id = "Space"}};
	map.keyboard["b"] = {{.id = "KeyX"}};
	map.keyboard["x"] = {{.id = "KeyC"}};
	map.keyboard["y"] = {{.id = "KeyV"}};
	map.keyboard["l1"] = {{.id = "KeyQ"}};
	map.keyboard["r1"] = {{.id = "KeyE"}};
	map.keyboard["start"] = {{.id = "Enter"}};
	map.keyboard["select"] = {{.id = "Escape"}};
	
	// Gamepad mappings (direct 1:1)
	map.gamepad["up"] = {{.id = "up"}};
	map.gamepad["down"] = {{.id = "down"}};
	map.gamepad["left"] = {{.id = "left"}};
	map.gamepad["right"] = {{.id = "right"}};
	map.gamepad["a"] = {{.id = "a"}};
	map.gamepad["b"] = {{.id = "b"}};
	map.gamepad["x"] = {{.id = "x"}};
	map.gamepad["y"] = {{.id = "y"}};
	map.gamepad["l1"] = {{.id = "l1"}};
	map.gamepad["r1"] = {{.id = "r1"}};
	map.gamepad["l2"] = {{.id = "l2"}};
	map.gamepad["r2"] = {{.id = "r2"}};
	map.gamepad["start"] = {{.id = "start"}};
	map.gamepad["select"] = {{.id = "select"}};
	
	return map;
}

/* ============================================================================
 * Frame update
 * ============================================================================ */

void Input::pollInput() {
	// Get current time (in a real implementation, this would come from platform)
	// For now, we assume caller provides time via platform integration
	
	// Poll all player inputs
	for (auto& player : m_playerInputs) {
		if (player) {
			player->pollInput(m_currentTimeMs);
			player->update(m_currentTimeMs);
		}
	}
}

/* ============================================================================
 * Button event handling
 * ============================================================================ */

void Input::handleKeyboardEvent(const std::string& deviceId, const std::string& keyCode, bool down) {
	auto* binding = getDeviceBinding(deviceId);
	if (!binding || binding->source != InputSource::Keyboard) return;
	
	// Route to handler
	// In full implementation, this would call KeyboardInput::keydown/keyup
	
	// Enqueue to state manager
	if (binding->assignedPlayer.has_value()) {
		enqueueButtonEvent(binding->assignedPlayer.value(), keyCode,
						   down ? InputEvent::Type::Press : InputEvent::Type::Release,
						   m_currentTimeMs, std::nullopt);
	}
}

void Input::handleGamepadButtonEvent(const std::string& deviceId, const std::string& button,
									  bool down, f32 /*value*/) {
	auto* binding = getDeviceBinding(deviceId);
	if (!binding || binding->source != InputSource::Gamepad) return;
	
	if (binding->assignedPlayer.has_value()) {
		enqueueButtonEvent(binding->assignedPlayer.value(), button,
						   down ? InputEvent::Type::Press : InputEvent::Type::Release,
						   m_currentTimeMs, std::nullopt);
	}
}

void Input::handleGamepadAxisEvent(const std::string& /*deviceId*/, const std::string& /*axis*/,
									f32 /*x*/, f32 /*y*/) {
	// Axis events don't generate press/release events directly
	// They're handled by the gamepad handler internally
}

void Input::handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down) {
	auto* binding = getDeviceBinding(deviceId);
	if (!binding || binding->source != InputSource::Pointer) return;
	
	if (binding->assignedPlayer.has_value()) {
		enqueueButtonEvent(binding->assignedPlayer.value(), button,
						   down ? InputEvent::Type::Press : InputEvent::Type::Release,
						   m_currentTimeMs, std::nullopt);
	}
}

void Input::handlePointerMoveEvent(const std::string& /*deviceId*/, f32 /*x*/, f32 /*y*/) {
	// Pointer move events are handled by the pointer handler internally
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

void Input::enqueueButtonEvent(i32 playerIndex, const std::string& code,
								InputEvent::Type type, f64 timestamp,
								std::optional<i32> pressId) {
	auto* player = getPlayerInput(playerIndex);
	if (!player) return;
	
	InputEvent evt;
	evt.eventType = type;
	evt.identifier = code;
	evt.timestamp = timestamp;
	evt.consumed = false;
	evt.pressId = pressId;
	
	player->stateManager().addInputEvent(evt);
}

/* ============================================================================
 * Helper functions
 * ============================================================================ */

ButtonState makeButtonState() {
	return ButtonState{};
}

ButtonState makeButtonState(const ButtonState& init) {
	return init;
}

ActionState makeActionState(const std::string& action) {
	return ActionState(action);
}

ActionState makeActionState(const std::string& action, const ButtonState& state) {
	return ActionState(action, state);
}

ButtonState getPressedState(const std::unordered_map<std::string, ButtonState>& states,
							const std::string& button) {
	auto it = states.find(button);
	if (it == states.end()) {
		return ButtonState{};
	}
	return it->second;
}

} // namespace bmsx
