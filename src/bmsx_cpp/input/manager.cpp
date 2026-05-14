/*
 * input.cpp - Main input system implementation
 */

#include "manager.h"
#include "player.h"
#include "gamepad.h"
#include "keyboard.h"
#include "pointer.h"
#include "core/console.h"
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Constructor
 * ============================================================================ */

InputStateManager::InputStateManager() = default;

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void InputStateManager::beginFrame(f64 currentTimeMs) {
	m_currentTimeMs = currentTimeMs;
	m_currentFrame += 1;

	for (auto& [id, state] : m_buttonStates) {
		(void)id;
		state.justpressed = false;
		state.justreleased = false;
		if (state.pressed) {
			const f64 pressedAt = buttonPressedAtOr(state, currentTimeMs);
			state.presstime = currentTimeMs - pressedAt;
		} else {
			state.presstime = std::nullopt;
		}
	}
}

void InputStateManager::update(f64 currentTimeMs) {
	m_currentTimeMs = currentTimeMs;
	pruneOldEvents();
	pruneBufferedEdges(m_bufferedPressEdges);
	pruneBufferedEdges(m_bufferedReleaseEdges);
}

/* ============================================================================
 * Event handling
 * ============================================================================ */

void InputStateManager::addInputEvent(InputEvent evt) {
	const i64 bufferedFrame = m_currentFrame + 1;
	BufferedInputEvent bufferedEvent{
		.event = std::move(evt),
		.frame = bufferedFrame,
	};
	const InputEvent& event = bufferedEvent.event;
	if (event.eventType == InputEvent::Type::Press) {
		bufferEdge(m_bufferedPressEdges, bufferedEvent);
	} else {
		bufferEdge(m_bufferedReleaseEdges, bufferedEvent);
	}

	m_inputBuffer.push_back(std::move(bufferedEvent));
}

void InputStateManager::recordAxis1Sample(const std::string& button, f32 value, f64 timestamp) {
	auto& state = m_pendingFrameStates[button];
	if (button == "pointer_wheel") {
		const f32 accumulated = state.value + value;
		state.value = accumulated;
		state.pressed = accumulated != 0.0f;
		state.justpressed = accumulated != 0.0f;
		state.timestamp = timestamp;
		if (!state.pressedAtMs.has_value()) {
			state.pressedAtMs = timestamp;
		}
		state.consumed = false;
		return;
	}
	const f32 magnitude = std::abs(value);
	state.value = value;
	state.pressed = magnitude > 0.0f;
	state.justpressed = state.justpressed || state.pressed;
	state.timestamp = timestamp;
	if (state.pressed && !state.pressedAtMs.has_value()) {
		state.pressedAtMs = timestamp;
	}
	state.consumed = false;
}

void InputStateManager::recordAxis2Sample(const std::string& button, f32 x, f32 y, f64 timestamp) {
	auto& state = m_pendingFrameStates[button];
	if (button == "pointer_delta") {
		const Vec2 previous = state.value2d.has_value()
			? state.value2d.value()
			: Vec2{0.0f, 0.0f};
		const f32 nextX = previous.x + x;
		const f32 nextY = previous.y + y;
		state.value2d = Vec2{nextX, nextY};
		state.value = std::hypot(nextX, nextY);
		state.pressed = state.value > 0.0f;
		state.justpressed = state.justpressed || state.pressed;
		state.timestamp = timestamp;
		if (!state.pressedAtMs.has_value()) {
			state.pressedAtMs = timestamp;
		}
		state.consumed = false;
		return;
	}
	state.value2d = Vec2{x, y};
	state.value = std::hypot(x, y);
	state.timestamp = timestamp;
	if (button == "pointer_position") {
		state.consumed = false;
		return;
	}
	state.pressed = state.value > 0.0f;
	state.justpressed = state.justpressed || state.pressed;
	if (state.pressed && !state.pressedAtMs.has_value()) {
		state.pressedAtMs = timestamp;
	}
	state.consumed = false;
}

void InputStateManager::latchButtonState(const std::string& button, const ButtonState& rawState, f64 currentTimeMs) {
	auto& state = m_buttonStates[button];
	auto pendingIt = m_pendingFrameStates.find(button);
	ButtonState* pending = nullptr;
	if (pendingIt != m_pendingFrameStates.end()) {
		pending = &pendingIt->second;
	}
	const auto bufferedPress = getBufferedEdgeRecord(m_bufferedPressEdges, button, 1);
	const auto bufferedRelease = getBufferedEdgeRecord(m_bufferedReleaseEdges, button, 1);
	const bool previousPressed = state.pressed;
	const bool nextPressed = pending ? pending->pressed : rawState.pressed;
	f64 nextTimestamp = buttonTimestampOr(rawState, buttonTimestampOr(state, currentTimeMs));
	if (pending && pending->timestamp.has_value()) {
		nextTimestamp = pending->timestamp.value();
	}
	std::optional<i32> nextPressId;
	if (rawState.pressId.has_value()) {
		nextPressId = rawState.pressId;
	} else if (state.pressId.has_value()) {
		nextPressId = state.pressId;
	} else if (pending && pending->pressId.has_value()) {
		nextPressId = pending->pressId;
	}
	std::optional<f64> nextPressedAtMs;
	if (nextPressed) {
		if (rawState.pressedAtMs.has_value()) {
			nextPressedAtMs = rawState.pressedAtMs;
		} else if (pending && pending->pressedAtMs.has_value()) {
			nextPressedAtMs = pending->pressedAtMs;
		} else if (state.pressedAtMs.has_value()) {
			nextPressedAtMs = state.pressedAtMs;
		} else {
			nextPressedAtMs = nextTimestamp;
		}
	}
	std::optional<f64> nextReleasedAtMs;
	if (!nextPressed) {
		if (rawState.releasedAtMs.has_value()) {
			nextReleasedAtMs = rawState.releasedAtMs;
		} else if (state.releasedAtMs.has_value()) {
			nextReleasedAtMs = state.releasedAtMs;
		} else if (bufferedRelease.has_value()) {
			nextReleasedAtMs = nextTimestamp;
		}
	}
	state.pressed = nextPressed;
	state.justpressed = bufferedPress.has_value() || (pending && pending->justpressed && !previousPressed);
	state.justreleased = bufferedRelease.has_value() || (pending && pending->justreleased && previousPressed);
	state.consumed = nextPressed && state.consumed;
	state.timestamp = nextTimestamp;
	state.pressedAtMs = nextPressedAtMs;
	state.releasedAtMs = nextReleasedAtMs;
	state.pressId = nextPressId;
	state.value = pending ? pending->value : rawState.value;
	if (!pending) {
		state.value2d = rawState.value2d;
	} else {
		state.value2d = pending->value2d.has_value() ? pending->value2d : rawState.value2d;
	}
	state.presstime = nextPressed
		? std::optional<f64>(currentTimeMs - nextPressedAtMs.value())
		: std::nullopt;
	if (pendingIt != m_pendingFrameStates.end()) {
		m_pendingFrameStates.erase(pendingIt);
	}
}

void InputStateManager::consumeBufferedEvent(const std::string& identifier, std::optional<i32> pressId) {
	for (auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == identifier) {
			if (!pressId.has_value() || bufferedEvent.event.pressId == pressId) {
				bufferedEvent.event.consumed = true;
			}
		}
	}
	consumeBufferedEdge(m_bufferedPressEdges, identifier, pressId);
	consumeBufferedEdge(m_bufferedReleaseEdges, identifier, pressId);
	auto stateIt = m_buttonStates.find(identifier);
	if (stateIt != m_buttonStates.end()) {
		stateIt->second.consumed = true;
	}
}

/* ============================================================================
 * State queries
 * ============================================================================ */

ButtonState InputStateManager::getButtonState(const std::string& button, std::optional<i32> windowFrames) const {
	ButtonState state;
	auto it = m_buttonStates.find(button);
	if (it != m_buttonStates.end()) {
		state = it->second;
	}

	i32 effectiveWindow = BUFFER_FRAME_RETENTION;
	if (windowFrames.has_value()) {
		effectiveWindow = windowFrames.value();
	}
	state.justpressed = state.justpressed || getBufferedEdgeRecord(m_bufferedPressEdges, button, 1).has_value();
	state.justreleased = state.justreleased || getBufferedEdgeRecord(m_bufferedReleaseEdges, button, 1).has_value();
	state.waspressed = state.pressed;
	state.wasreleased = state.justreleased;
	for (const auto& bufferedEvent : m_inputBuffer) {
		if (bufferedEvent.event.identifier == button &&
			bufferedEvent.frame <= m_currentFrame &&
			isBufferedFrameInWindow(bufferedEvent.frame, effectiveWindow)) {
			if (bufferedEvent.event.eventType == InputEvent::Type::Press) {
				state.waspressed = true;
			}
			if (bufferedEvent.event.eventType == InputEvent::Type::Release) {
				state.wasreleased = true;
			}
			if (bufferedEvent.event.consumed &&
				(!state.pressId.has_value() || (bufferedEvent.event.pressId.has_value() && bufferedEvent.event.pressId.value() == state.pressId.value()))) {
				state.consumed = true;
			}
		}
	}

	return state;
}

bool InputStateManager::hasTrackedButton(const std::string& button) const {
	return m_buttonStates.find(button) != m_buttonStates.end();
}

/* ============================================================================
 * State management
 * ============================================================================ */

void InputStateManager::resetEdgeState() {
	for (auto& [id, state] : m_buttonStates) {
		(void)id;
		state.justpressed = false;
		state.justreleased = false;
		state.consumed = false;
		if (!state.pressed) {
			state.presstime = std::nullopt;
			state.pressedAtMs = std::nullopt;
			state.pressId = std::nullopt;
			state.value = 0.0f;
			state.value2d = std::nullopt;
		}
	}
	m_inputBuffer.clear();
	m_bufferedPressEdges.clear();
	m_bufferedReleaseEdges.clear();
	m_pendingFrameStates.clear();
	m_currentFrame = 0;
}

void InputStateManager::clear() {
	m_buttonStates.clear();
	m_pendingFrameStates.clear();
	m_inputBuffer.clear();
	m_bufferedPressEdges.clear();
	m_bufferedReleaseEdges.clear();
	m_currentFrame = 0;
	m_currentTimeMs = 0.0;
}

/* ============================================================================
 * Helpers
 * ============================================================================ */

std::optional<i32> InputStateManager::getLatestUnconsumedEdgeId(const std::string& button, InputEvent::Type eventType) const {
	const auto& edgeMap = eventType == InputEvent::Type::Press
		? m_bufferedPressEdges
		: m_bufferedReleaseEdges;
	auto edge = getBufferedEdgeRecord(edgeMap, button, RECENT_BUFFERED_EDGE_FRAMES);
	if (!edge.has_value()) {
		return std::nullopt;
	}
	return edge->edgeId;
}

std::optional<InputStateManager::BufferedEdgeRecord> InputStateManager::getBufferedEdgeRecord(
	const std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap,
	const std::string& button,
	i32 windowFrames
) const {
	auto it = edgeMap.find(button);
	if (it == edgeMap.end()) {
		return std::nullopt;
	}
	const BufferedEdgeRecord& edge = it->second;
	if (edge.consumed || edge.frame > m_currentFrame || !isBufferedFrameInWindow(edge.frame, windowFrames)) {
		return std::nullopt;
	}
	return edge;
}

bool InputStateManager::isBufferedFrameInWindow(i64 frame, i32 windowFrames) const {
	if (windowFrames <= 0) {
		return false;
	}
	return m_currentFrame - frame < windowFrames;
}

void InputStateManager::bufferEdge(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const BufferedInputEvent& event) {
	if (!event.event.pressId.has_value()) {
		return;
	}
	edgeMap[event.event.identifier] = BufferedEdgeRecord{
		.edgeId = event.event.pressId.value(),
		.frame = event.frame,
		.consumed = event.event.consumed,
	};
}

void InputStateManager::consumeBufferedEdge(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap, const std::string& identifier, std::optional<i32> pressId) {
	auto it = edgeMap.find(identifier);
	if (it == edgeMap.end()) {
		return;
	}
	if (!pressId.has_value() || it->second.edgeId == pressId.value()) {
		it->second.consumed = true;
	}
}

void InputStateManager::pruneOldEvents() {
	while (!m_inputBuffer.empty() && !isBufferedFrameInWindow(m_inputBuffer.front().frame, BUFFER_FRAME_RETENTION)) {
		m_inputBuffer.pop_front();
	}
}

void InputStateManager::pruneBufferedEdges(std::unordered_map<std::string, BufferedEdgeRecord>& edgeMap) {
	for (auto it = edgeMap.begin(); it != edgeMap.end();) {
		if (!isBufferedFrameInWindow(it->second.frame, BUFFER_FRAME_RETENTION)) {
			it = edgeMap.erase(it);
			continue;
		}
		++it;
	}
}


/* ============================================================================
 * Static data
 * ============================================================================ */

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
		m_playerInputs[i]->setFrameDurationMs(m_frameDurationMs);
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

	m_playerInputs[DEFAULT_KEYBOARD_PLAYER_INDEX - 1]->pushContext(
		"base",
		DEFAULT_INPUT_MAPPING.keyboard,
		DEFAULT_INPUT_MAPPING.gamepad,
		DEFAULT_INPUT_MAPPING.pointer,
		0
	);
	m_focusChangeSub = ConsoleCore::instance().platform()->gameviewHost()->onFocusChange([this](bool focused) {
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
	return m_playerInputs[playerIndex - 1].get();
}

void Input::setFrameDurationMs(f64 frameDurationMs) {
	m_frameDurationMs = frameDurationMs;
	for (auto& player : m_playerInputs) {
		if (player) {
			player->setFrameDurationMs(frameDurationMs);
		}
	}
}

/* ============================================================================
 * Device management
 * ============================================================================ */

void Input::unregisterDevice(const std::string& deviceId) {
	auto it = m_deviceBindings.find(deviceId);
	if (it == m_deviceBindings.end()) return;

	auto& binding = it->second;

	// Clear from assigned player
	if (binding.assignedPlayer.has_value()) {
		auto* player = m_playerInputs[binding.assignedPlayer.value() - 1].get();
		if (player) {
			if (binding.source == InputSource::Gamepad) {
				player->inputHandlers[static_cast<size_t>(InputSource::Gamepad)] = nullptr;
			} else if (binding.source == InputSource::Keyboard) {
				player->inputHandlers[static_cast<size_t>(InputSource::Keyboard)] = nullptr;
			} else if (binding.source == InputSource::Pointer) {
				player->inputHandlers[static_cast<size_t>(InputSource::Pointer)] = nullptr;
			}
		}
	}

	// Reset handler
	if (binding.handler) {
		binding.handler->reset();
	}

	m_deviceBindings.erase(it);
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

void Input::registerDeviceBinding(const std::string& deviceId, InputHandler* handler, InputSource source, std::optional<i32> assignedPlayer) {
	m_deviceBindings[deviceId] = DeviceBinding{
		.handler = handler,
		.source = source,
		.assignedPlayer = assignedPlayer,
		.deviceId = deviceId,
	};
	if (!assignedPlayer.has_value()) {
		return;
	}
	m_playerInputs[assignedPlayer.value() - 1]->inputHandlers[static_cast<size_t>(source)] = handler;
}

/* ============================================================================
 * Gamepad assignment
 * ============================================================================ */

void Input::assignGamepadToPlayer(InputHandler* gamepad, i32 playerIndex) {
	auto* player = m_playerInputs[playerIndex - 1].get();
	player->assignGamepadToPlayer(gamepad);

	// Update binding
	for (auto& [id, binding] : m_deviceBindings) {
		if (binding.handler == gamepad) {
			binding.assignedPlayer = playerIndex;
			break;
		}
	}
}

std::optional<i32> Input::getFirstAvailablePlayerIndexForGamepadAssignment(i32 from, bool reverse) {
	if (reverse) {
		for (i32 i = from; i >= 1; i--) {
			if (isPlayerIndexAvailableForGamepadAssignment(i)) {
				return i;
			}
		}
	} else {
		for (i32 i = from; i <= PLAYERS_MAX; i++) {
			if (isPlayerIndexAvailableForGamepadAssignment(i)) {
				return i;
			}
		}
	}
	return std::nullopt;
}

bool Input::isPlayerIndexAvailableForGamepadAssignment(i32 playerIndex) {
	auto* player = m_playerInputs[playerIndex - 1].get();
	return player->inputHandlers[static_cast<size_t>(InputSource::Gamepad)] == nullptr;
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

static InputMap createDefaultInputMapping() {
	InputMap map;
	auto& pointer = map.pointer;
	auto& keyboard = map.keyboard;
	auto& gamepad = map.gamepad;

	// Keyboard mappings
	pointer["pointer_primary"] = {PointerBinding{"pointer_primary"}};
	pointer["pointer_secondary"] = {PointerBinding{"pointer_secondary"}};
	pointer["pointer_aux"] = {PointerBinding{"pointer_aux"}};
	pointer["pointer_back"] = {PointerBinding{"pointer_back"}};
	pointer["pointer_forward"] = {PointerBinding{"pointer_forward"}};
	pointer["pointer_delta"] = {PointerBinding{"pointer_delta"}};
	pointer["pointer_position"] = {PointerBinding{"pointer_position"}};
	pointer["pointer_wheel"] = {PointerBinding{"pointer_wheel"}};

	keyboard["a"] = {KeyboardBinding{"KeyX", std::nullopt}};
	keyboard["b"] = {KeyboardBinding{"KeyC", std::nullopt}};
	keyboard["x"] = {KeyboardBinding{"KeyZ", std::nullopt}};
	keyboard["y"] = {KeyboardBinding{"KeyS", std::nullopt}};
	keyboard["lb"] = {KeyboardBinding{"ShiftLeft", std::nullopt}};
	keyboard["rb"] = {KeyboardBinding{"ShiftRight", std::nullopt}};
	keyboard["lt"] = {KeyboardBinding{"CtrlLeft", std::nullopt}};
	keyboard["rt"] = {KeyboardBinding{"CtrlRight", std::nullopt}};
	keyboard["select"] = {KeyboardBinding{"Backspace", std::nullopt}};
	keyboard["start"] = {KeyboardBinding{"Enter", std::nullopt}};
	keyboard["ls"] = {KeyboardBinding{"KeyQ", std::nullopt}};
	keyboard["rs"] = {KeyboardBinding{"KeyE", std::nullopt}};
	keyboard["up"] = {KeyboardBinding{"ArrowUp", std::nullopt}};
	keyboard["down"] = {KeyboardBinding{"ArrowDown", std::nullopt}};
	keyboard["left"] = {KeyboardBinding{"ArrowLeft", std::nullopt}};
	keyboard["right"] = {KeyboardBinding{"ArrowRight", std::nullopt}};
	keyboard["home"] = {KeyboardBinding{"Escape", std::nullopt}};
	keyboard["touch"] = {KeyboardBinding{"Space", std::nullopt}};

	// Gamepad mappings (direct 1:1)
	gamepad["up"] = {GamepadBinding{"up", std::nullopt}};
	gamepad["down"] = {GamepadBinding{"down", std::nullopt}};
	gamepad["left"] = {GamepadBinding{"left", std::nullopt}};
	gamepad["right"] = {GamepadBinding{"right", std::nullopt}};
	gamepad["a"] = {GamepadBinding{"a", std::nullopt}};
	gamepad["b"] = {GamepadBinding{"b", std::nullopt}};
	gamepad["x"] = {GamepadBinding{"x", std::nullopt}};
	gamepad["y"] = {GamepadBinding{"y", std::nullopt}};
	gamepad["lb"] = {GamepadBinding{"lb", std::nullopt}};
	gamepad["rb"] = {GamepadBinding{"rb", std::nullopt}};
	gamepad["lt"] = {GamepadBinding{"lt", std::nullopt}};
	gamepad["rt"] = {GamepadBinding{"rt", std::nullopt}};
	gamepad["start"] = {GamepadBinding{"start", std::nullopt}};
	gamepad["select"] = {GamepadBinding{"select", std::nullopt}};
	gamepad["ls"] = {GamepadBinding{"ls", std::nullopt}};
	gamepad["rs"] = {GamepadBinding{"rs", std::nullopt}};
	gamepad["home"] = {GamepadBinding{"home", std::nullopt}};
	gamepad["touch"] = {GamepadBinding{"touch", std::nullopt}};

	return map;
}

const InputMap Input::DEFAULT_INPUT_MAPPING = createDefaultInputMapping();

const std::unordered_map<std::string, std::string> Input::KEYBOARD_TO_GAMEPAD = []() {
	std::unordered_map<std::string, std::string> inverse;
	for (const auto& [action, bindings] : Input::DEFAULT_INPUT_MAPPING.keyboard) {
		for (const auto& binding : bindings) {
			inverse[binding.id] = action;
		}
	}
	return inverse;
}();

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
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<KeyboardInput*>(binding.handler);
	i32 pressId = resolvePlatformPressId(deviceId, keyCode, down);
	if (down) {
		handler->keydown(keyCode, pressId, m_currentTimeMs);
	} else {
		handler->keyup(keyCode, pressId, m_currentTimeMs);
	}
	enqueueButtonEvent(binding.assignedPlayer.value(), InputSource::Keyboard, keyCode,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadButtonEvent(const std::string& deviceId, const std::string& button,
										bool down, f32 value) {
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<GamepadInput*>(binding.handler);
	i32 pressId = resolvePlatformPressId(deviceId, button, down);
	handler->ingestButton(button, down, value, m_currentTimeMs, pressId);
	enqueueButtonEvent(binding.assignedPlayer.value(), InputSource::Gamepad, button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handleGamepadAxisEvent(const std::string& deviceId, const std::string& axis,
									f32 x, f32 y) {
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<GamepadInput*>(binding.handler);
	handler->ingestAxis2(axis, x, y, m_currentTimeMs);
	if (binding.assignedPlayer.has_value()) {
		getPlayerInput(binding.assignedPlayer.value())->recordAxis2Input(InputSource::Gamepad, axis, x, y, m_currentTimeMs);
	}
}

void Input::handlePointerButtonEvent(const std::string& deviceId, const std::string& button, bool down) {
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<PointerInput*>(binding.handler);
	i32 pressId = resolvePlatformPressId(deviceId, button, down);
	handler->ingestButton(button, down, down ? 1.0f : 0.0f, m_currentTimeMs, pressId);
	enqueueButtonEvent(binding.assignedPlayer.value(), InputSource::Pointer, button,
						down ? InputEvent::Type::Press : InputEvent::Type::Release,
						m_currentTimeMs, pressId);
}

void Input::handlePointerMoveEvent(const std::string& deviceId, f32 x, f32 y) {
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<PointerInput*>(binding.handler);
	handler->ingestAxis2("pointer_position", x, y, m_currentTimeMs);
	if (binding.assignedPlayer.has_value()) {
		auto* player = getPlayerInput(binding.assignedPlayer.value());
		player->recordAxis2Input(InputSource::Pointer, "pointer_position", x, y, m_currentTimeMs);
		const ButtonState delta = handler->getButtonState("pointer_delta");
		const Vec2 value = delta.value2d.value();
		player->recordAxis2Input(InputSource::Pointer, "pointer_delta", value.x, value.y, m_currentTimeMs);
	}
}

void Input::handlePointerWheelEvent(const std::string& deviceId, f32 value) {
	DeviceBinding& binding = m_deviceBindings.find(deviceId)->second;
	auto* handler = static_cast<PointerInput*>(binding.handler);
	handler->ingestAxis1("pointer_wheel", value, m_currentTimeMs);
	if (binding.assignedPlayer.has_value()) {
		getPlayerInput(binding.assignedPlayer.value())->recordAxis1Input(InputSource::Pointer, "pointer_wheel", value, m_currentTimeMs);
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

i32 Input::resolvePlatformPressId(const std::string& deviceId, const std::string& code, bool down) {
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
