/*
 * input.cpp - Main input system implementation
 *
 * Mirrors TypeScript input/manager.ts
 */

#include "manager.h"
#include "gamepad.h"
#include "keyboard.h"
#include "pointer.h"
#include "core/engine.h"

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
	static const std::unordered_map<std::string, std::string> mapping = []() {
		const auto defaultMapping = getDefaultInputMapping();
		std::unordered_map<std::string, std::string> inverse;
		for (const auto& [action, bindings] : defaultMapping.keyboard) {
			for (const auto& binding : bindings) {
				inverse[binding.id] = action;
			}
		}
		return inverse;
	}();
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
	m_focusChangeSub = EngineCore::instance().platform()->gameviewHost()->onFocusChange([this](bool focused) {
		handleFocusChange(focused);
	});
	
	m_initialized = true;
}

void Input::shutdown() {
	if (!m_initialized) return;

	if (m_focusChangeSub.active) {
		m_focusChangeSub.unsubscribe();
	}
	
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

void Input::handleFocusChange(bool /*focused*/) {
	m_activePressIds.clear();

	for (auto& player : m_playerInputs) {
		if (player) {
			player->reset();
		}
	}

	for (auto& [deviceId, binding] : m_deviceBindings) {
		(void)deviceId;
		if (!binding.assignedPlayer.has_value()) {
			binding.handler->reset();
		}
	}
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
	map.pointer["pointer_primary"] = {PointerBinding{"pointer_primary"}};
	map.pointer["pointer_secondary"] = {PointerBinding{"pointer_secondary"}};
	map.pointer["pointer_aux"] = {PointerBinding{"pointer_aux"}};
	map.pointer["pointer_back"] = {PointerBinding{"pointer_back"}};
	map.pointer["pointer_forward"] = {PointerBinding{"pointer_forward"}};
	map.pointer["pointer_delta"] = {PointerBinding{"pointer_delta"}};
	map.pointer["pointer_position"] = {PointerBinding{"pointer_position"}};
	map.pointer["pointer_wheel"] = {PointerBinding{"pointer_wheel"}};

	map.keyboard["a"] = {KeyboardBinding{"KeyX", std::nullopt}};
	map.keyboard["b"] = {KeyboardBinding{"KeyC", std::nullopt}};
	map.keyboard["x"] = {KeyboardBinding{"KeyZ", std::nullopt}};
	map.keyboard["y"] = {KeyboardBinding{"KeyS", std::nullopt}};
	map.keyboard["lb"] = {KeyboardBinding{"ShiftLeft", std::nullopt}};
	map.keyboard["rb"] = {KeyboardBinding{"ShiftRight", std::nullopt}};
	map.keyboard["lt"] = {KeyboardBinding{"CtrlLeft", std::nullopt}};
	map.keyboard["rt"] = {KeyboardBinding{"CtrlRight", std::nullopt}};
	map.keyboard["select"] = {KeyboardBinding{"Backspace", std::nullopt}};
	map.keyboard["start"] = {KeyboardBinding{"Enter", std::nullopt}};
	map.keyboard["ls"] = {KeyboardBinding{"KeyQ", std::nullopt}};
	map.keyboard["rs"] = {KeyboardBinding{"KeyE", std::nullopt}};
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
	// 1. Process events from hub
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
			case InputEvtType::PointerWheel:
				handlePointerWheelEvent(input.deviceId, input.value);
				break;
		}
		evt = hub->nextEvt();
	}
	
	// 2. Poll handlers - they read updated keyStates set by events above
	for (auto& player : m_playerInputs) {
		if (player) {
			player->pollInput(m_currentTimeMs);
		}
	}
	
	// 3. Finally, update player input buffers
	for (auto& player : m_playerInputs) {
		if (player) {
			player->update(m_currentTimeMs);
		}
	}
}

void Input::beginFrame() {
	// Called exactly when the runtime reaches a new cart-visible simulation frame boundary.
	// Do not call this from host polls, idle host frames, or budget refills inside the same
	// unfinished gameplay frame.
	for (auto& player : m_playerInputs) {
		if (player) {
			player->beginFrame(m_currentTimeMs);
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
	enqueueButtonEvent(binding->assignedPlayer.value(), InputSource::Keyboard, keyCode,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadButtonEvent(const std::string& deviceId, const std::string& button,
										bool down, f32 value) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<GamepadInput*>(binding->handler);
	i32 pressId = assignPressId(deviceId, button, down);
	handler->ingestButton(button, down, value, m_currentTimeMs, pressId);
	enqueueButtonEvent(binding->assignedPlayer.value(), InputSource::Gamepad, button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadAxisEvent(const std::string& deviceId, const std::string& axis,
									f32 x, f32 y) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<GamepadInput*>(binding->handler);
	handler->ingestAxis2(axis, x, y, m_currentTimeMs);
	if (binding->assignedPlayer.has_value()) {
		getPlayerInput(binding->assignedPlayer.value())->recordAxis2Input(InputSource::Gamepad, axis, x, y, m_currentTimeMs);
	}
}

void Input::handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<PointerInput*>(binding->handler);
	i32 pressId = assignPressId(deviceId, button, down);
	handler->ingestButton(button, down, down ? 1.0f : 0.0f, m_currentTimeMs, pressId);
	enqueueButtonEvent(binding->assignedPlayer.value(), InputSource::Pointer, button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handlePointerMoveEvent(const std::string& deviceId, f32 x, f32 y) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<PointerInput*>(binding->handler);
	handler->ingestAxis2("pointer_position", x, y, m_currentTimeMs);
	if (binding->assignedPlayer.has_value()) {
		auto* player = getPlayerInput(binding->assignedPlayer.value());
		player->recordAxis2Input(InputSource::Pointer, "pointer_position", x, y, m_currentTimeMs);
		const ButtonState delta = handler->getButtonState("pointer_delta");
		const Vec2 value = delta.value2d.value_or(Vec2(0.0f, 0.0f));
		player->recordAxis2Input(InputSource::Pointer, "pointer_delta", value.x, value.y, m_currentTimeMs);
	}
}

void Input::handlePointerWheelEvent(const std::string& deviceId, f32 value) {
	auto* binding = getDeviceBinding(deviceId);
	auto* handler = static_cast<PointerInput*>(binding->handler);
	handler->ingestAxis1("pointer_wheel", value, m_currentTimeMs);
	if (binding->assignedPlayer.has_value()) {
		getPlayerInput(binding->assignedPlayer.value())->recordAxis1Input(InputSource::Pointer, "pointer_wheel", value, m_currentTimeMs);
	}
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

void Input::enqueueButtonEvent(i32 playerIndex, InputSource source, const std::string& code,
								InputEvent::Type type, f64 timestamp,
								std::optional<i32> pressId) {
	auto* player = getPlayerInput(playerIndex);
	
	InputEvent evt;
	evt.eventType = type;
	evt.identifier = code;
	evt.timestamp = timestamp;
	evt.consumed = false;
	evt.pressId = pressId;
	player->recordButtonEvent(source, code, std::move(evt));
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
