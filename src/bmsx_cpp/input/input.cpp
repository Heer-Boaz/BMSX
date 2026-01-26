/*
 * input.cpp - Main input system implementation
 *
 * Mirrors TypeScript input/input.ts
 */

#include "input.h"
#include "gamepadinput.h"
#include "keyboardinput.h"
#include "../core/engine_core.h"

namespace bmsx {

/* ============================================================================
 * Static data
 * ============================================================================ */

const std::vector<std::string>& Input::BUTTON_IDS() {
	static const std::vector<std::string> ids = {
		"a", "b", "x", "y",
		"lb", "rb", "lt", "rt",
		"select", "start", "ls", "rs",
		"up", "down", "left", "right",
		"home", "touch"
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
		
		// Face buttons
		{"KeyX", "b"},
		{"KeyA", "x"},
		{"KeyZ", "a"},
		{"ShiftLeft", "y"},
		
		// Shoulder buttons
		{"KeyQ", "lb"},
		{"KeyW", "rb"},
		
		// Start/Select
		{"ShiftRight", "select"},
		{"Enter", "start"},
		
		// Triggers
		{"Digit1", "lt"},
		{"Digit3", "rt"},
		
		// Sticks
		{"KeyF", "ls"},
		{"KeyG", "rs"},
		
		// Home/Touch
		{"KeyH", "home"},
		{"KeyT", "touch"}
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
		m_playerInputs[i] = std::make_unique<PlayerInput>(i + 1);
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
	m_playerInputs[toInternalPlayerIndex(DEFAULT_KEYBOARD_PLAYER_INDEX)]->setInputMap(defaultMapping);
	
	m_initialized = true;
}

void Input::shutdown() {
	if (!m_initialized) return;
	
	// Clear device bindings
	m_deviceBindings.clear();
	m_activePressIds.clear();
	m_nextPressId = 1;
	
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
	return m_playerInputs[toInternalPlayerIndex(playerIndex)].get();
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
	m_playerInputs[toInternalPlayerIndex(DEFAULT_KEYBOARD_PLAYER_INDEX)]->setHandler(InputSource::Keyboard, handler);
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
	m_playerInputs[toInternalPlayerIndex(DEFAULT_KEYBOARD_PLAYER_INDEX)]->setHandler(InputSource::Pointer, handler);
}

void Input::unregisterDevice(const std::string& deviceId) {
	auto it = m_deviceBindings.find(deviceId);
	if (it == m_deviceBindings.end()) return;
	
	auto& binding = it->second;
	
	// Clear from assigned player
	if (binding.assignedPlayer.has_value()) {
		auto* player = m_playerInputs[toInternalPlayerIndex(binding.assignedPlayer.value())].get();
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
	auto* player = m_playerInputs[toInternalPlayerIndex(playerIndex)].get();
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
		for (i32 i = from; i <= PLAYERS_MAX; i++) {
			if (isPlayerIndexAvailableForGamepad(i)) {
				return i;
			}
		}
	}
	return std::nullopt;
}

bool Input::isPlayerIndexAvailableForGamepad(i32 playerIndex) {
	auto* player = m_playerInputs[toInternalPlayerIndex(playerIndex)].get();
	return player->getHandler(InputSource::Gamepad) == nullptr;
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

InputMap Input::getDefaultInputMapping() {
	InputMap map;
	
	// Keyboard mappings
	map.keyboard["a"] = {KeyboardBinding{"KeyZ", std::nullopt}};
	map.keyboard["b"] = {KeyboardBinding{"KeyX", std::nullopt}};
	map.keyboard["x"] = {KeyboardBinding{"KeyA", std::nullopt}};
	map.keyboard["y"] = {KeyboardBinding{"KeyS", std::nullopt}};
	map.keyboard["lb"] = {KeyboardBinding{"KeyQ", std::nullopt}};
	map.keyboard["rb"] = {KeyboardBinding{"KeyW", std::nullopt}};
	map.keyboard["lt"] = {KeyboardBinding{"Key1", std::nullopt}};
	map.keyboard["rt"] = {KeyboardBinding{"Key2", std::nullopt}};
	map.keyboard["select"] = {KeyboardBinding{"ShiftRight", std::nullopt}};
	map.keyboard["start"] = {KeyboardBinding{"Enter", std::nullopt}};
	map.keyboard["ls"] = {KeyboardBinding{"KeyC", std::nullopt}};
	map.keyboard["rs"] = {KeyboardBinding{"KeyV", std::nullopt}};
	map.keyboard["up"] = {KeyboardBinding{"ArrowUp", std::nullopt}};
	map.keyboard["down"] = {KeyboardBinding{"ArrowDown", std::nullopt}};
	map.keyboard["left"] = {KeyboardBinding{"ArrowLeft", std::nullopt}};
	map.keyboard["right"] = {KeyboardBinding{"ArrowRight", std::nullopt}};
	map.keyboard["home"] = {KeyboardBinding{"Escape", std::nullopt}};
	map.keyboard["touch"] = {KeyboardBinding{"Space", std::nullopt}};
	
	// Gamepad mappings (direct 1:1)
	map.gamepad["up"] = {GamepadBinding{"up", std::nullopt}};
	map.gamepad["down"] = {GamepadBinding{"down", std::nullopt}};
	map.gamepad["left"] = {GamepadBinding{"left", std::nullopt}};
	map.gamepad["right"] = {GamepadBinding{"right", std::nullopt}};
	map.gamepad["a"] = {GamepadBinding{"a", std::nullopt}};
	map.gamepad["b"] = {GamepadBinding{"b", std::nullopt}};
	map.gamepad["x"] = {GamepadBinding{"x", std::nullopt}};
	map.gamepad["y"] = {GamepadBinding{"y", std::nullopt}};
	map.gamepad["lb"] = {GamepadBinding{"lb", std::nullopt}};
	map.gamepad["rb"] = {GamepadBinding{"rb", std::nullopt}};
	map.gamepad["lt"] = {GamepadBinding{"lt", std::nullopt}};
	map.gamepad["rt"] = {GamepadBinding{"rt", std::nullopt}};
	map.gamepad["start"] = {GamepadBinding{"start", std::nullopt}};
	map.gamepad["select"] = {GamepadBinding{"select", std::nullopt}};
	map.gamepad["ls"] = {GamepadBinding{"ls", std::nullopt}};
	map.gamepad["rs"] = {GamepadBinding{"rs", std::nullopt}};
	map.gamepad["home"] = {GamepadBinding{"home", std::nullopt}};
	map.gamepad["touch"] = {GamepadBinding{"touch", std::nullopt}};
	
	return map;
}

/* ============================================================================
 * Frame update
 * ============================================================================ */

void Input::pollInput() {
	m_currentTimeMs = $().clock()->now();

	// 1. First, process any queued events from platform
	auto* hub = $().platform()->inputHub();
	std::optional<InputEvt> evt = hub->nextEvt();
	while (evt.has_value()) {
		const InputEvt& input = evt.value();
		switch (input.type) {
			case InputEvtType::ButtonDown:
				handleGamepadButtonEvent(input.deviceId, input.code, true, input.value);
				break;
			case InputEvtType::ButtonUp:
				handleGamepadButtonEvent(input.deviceId, input.code, false, input.value);
				break;
			case InputEvtType::AxisMove:
				handleGamepadAxisEvent(input.deviceId, input.code, input.x, input.y);
				break;
			case InputEvtType::KeyDown:
				handleKeyboardEvent(input.deviceId, input.code, true);
				break;
			case InputEvtType::KeyUp:
				handleKeyboardEvent(input.deviceId, input.code, false);
				break;
			case InputEvtType::PointerDown:
				handlePointerButtonEvent(input.deviceId, input.code, true);
				break;
			case InputEvtType::PointerUp:
				handlePointerButtonEvent(input.deviceId, input.code, false);
				break;
			case InputEvtType::PointerMove:
				handlePointerMoveEvent(input.deviceId, input.x, input.y);
				break;
		}
		evt = hub->nextEvt();
	}
	
	// 2. Then poll players (this calls beginFrame() -> handler polling)
	for (auto& player : m_playerInputs) {
		if (player) {
			player->pollInput(m_currentTimeMs);
		}
	}
	
	// 3. Finally, update player input buffers (prune old events)
	for (auto& player : m_playerInputs) {
		if (player) {
			player->update(m_currentTimeMs);
		}
	}
}

/* ============================================================================
 * Button event handling
 * ============================================================================ */

void Input::handleKeyboardEvent(const std::string& deviceId, const std::string& keyCode, bool down) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<KeyboardInput*>(binding->handler);
	i32 pressId = assignPressId(deviceId, keyCode, down);
	if (down) {
		handler->keydown(keyCode, pressId, m_currentTimeMs);
	} else {
		handler->keyup(keyCode, pressId, m_currentTimeMs);
	}
	enqueueButtonEvent(binding->assignedPlayer.value(), keyCode,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadButtonEvent(const std::string& deviceId, const std::string& button,
										bool down, f32 value) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<GamepadInput*>(binding->handler);
	i32 pressId = assignPressId(deviceId, button, down);
	handler->ingestButton(button, down, value, m_currentTimeMs, pressId);
	enqueueButtonEvent(binding->assignedPlayer.value(), button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadAxisEvent(const std::string& deviceId, const std::string& axis,
									f32 x, f32 y) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<GamepadInput*>(binding->handler);
	handler->ingestAxis2(axis, x, y, m_currentTimeMs);
}

void Input::handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down) {
	auto* binding = getDeviceBinding(deviceId);
	i32 pressId = assignPressId(deviceId, button, down);
	enqueueButtonEvent(binding->assignedPlayer.value(), button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
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
	
	InputEvent evt;
	evt.eventType = type;
	evt.identifier = code;
	evt.timestamp = timestamp;
	evt.consumed = false;
	evt.pressId = pressId;
	
	player->stateManager().addInputEvent(evt);
}

i32 Input::assignPressId(const std::string& deviceId, const std::string& code, bool down) {
	std::string key = deviceId + ":" + code;
	if (down) {
		i32 pressId = m_nextPressId++;
		m_activePressIds[key] = pressId;
		return pressId;
	}
	i32 pressId = m_activePressIds.at(key);
	m_activePressIds.erase(key);
	return pressId;
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
