/*
 * playerinput.cpp - Per-player input handling implementation
 *
 * Mirrors TypeScript input/playerinput.ts
 */

#include "playerinput.h"
#include "actionparser.h"
#include "core/engine_core.h"
#include "../machine/runtime/runtime.h"
#include "common/clamp.h"
#include <algorithm>
#include <cmath>

namespace bmsx {

/* ============================================================================
 * Constructor / Destructor
 * ============================================================================ */

PlayerInput::PlayerInput(i32 playerIndex)
	: m_playerIndex(playerIndex)
{
	reset();
}

PlayerInput::~PlayerInput() = default;

/* ============================================================================
 * Input handlers
 * ============================================================================ */

InputHandler* PlayerInput::getHandler(InputSource source) const {
	return m_handlers[sourceIndex(source)];
}

void PlayerInput::setHandler(InputSource source, InputHandler* handler) {
	m_handlers[sourceIndex(source)] = handler;
}

void PlayerInput::clearHandler(InputSource source) {
	m_handlers[sourceIndex(source)] = nullptr;
}

void PlayerInput::assignGamepad(InputHandler* gamepad) {
	auto* existing = m_handlers[sourceIndex(InputSource::Gamepad)];
	if (existing && existing != gamepad) {
		existing->reset();
	}
	m_handlers[sourceIndex(InputSource::Gamepad)] = gamepad;
}

void PlayerInput::clearGamepad(InputHandler* handler) {
	if (m_handlers[sourceIndex(InputSource::Gamepad)] != handler) return;
	m_handlers[sourceIndex(InputSource::Gamepad)] = nullptr;
	handler->reset();
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

void PlayerInput::setInputMap(const InputMap& map) {
	m_inputMap = map;
	trackInputMapBindings(map);
}

/* ============================================================================
 * Context stacking
 * ============================================================================ */

void PlayerInput::pushContext(const std::string& id, i32 priority, const InputMap& map) {
	trackInputMapBindings(map);
	MappingContext ctx(id, priority, true);
	ctx.keyboard = map.keyboard;
	ctx.gamepad = map.gamepad;
	ctx.pointer = map.pointer;
	m_contexts.push(ctx);
}

void PlayerInput::popContext(const std::string& id) {
	m_contexts.pop(id);
}

void PlayerInput::enableContext(const std::string& id, bool enabled) {
	m_contexts.enable(id, enabled);
}

void PlayerInput::trackButton(InputSource source, const std::string& button) {
	m_trackedButtons[sourceIndex(source)].insert(button);
}

void PlayerInput::trackInputMapBindings(const InputMap& map) {
	for (const auto& [action, bindings] : map.keyboard) {
		(void)action;
		for (const auto& binding : bindings) {
			trackButton(InputSource::Keyboard, binding.id);
		}
	}
	for (const auto& [action, bindings] : map.gamepad) {
		(void)action;
		for (const auto& binding : bindings) {
			trackButton(InputSource::Gamepad, binding.id);
		}
	}
	for (const auto& [action, bindings] : map.pointer) {
		(void)action;
		for (const auto& binding : bindings) {
			trackButton(InputSource::Pointer, binding.id);
		}
	}
}

/* ============================================================================
 * Action state
 * ============================================================================ */

ActionState PlayerInput::getActionState(const std::string& action, std::optional<f64> windowFrames) {
	// Result state - aggregate from all sources
	ActionState result(action);
	bool anyPressed = false;
	bool anyJustPressed = false;
	bool anyJustReleased = false;
	bool anyWasPressed = false;
	bool anyWasReleased = false;
	bool anyConsumed = false;
	bool allJustPressed = true;
	bool allJustReleased = true;
	i32 bindingCount = 0;
	f64 latestPressedAt = 0.0;
	f64 latestTimestamp = 0.0;
	std::optional<i32> latestPressId;
	std::optional<i32> bufferedPressId;

	const auto updateBufferedIds = [&](InputSource source, const std::string& id) {
		auto pressId = stateManager(source).getLatestUnconsumedPressId(id);
		if (pressId.has_value() && (!bufferedPressId.has_value() || pressId.value() > bufferedPressId.value())) {
			bufferedPressId = pressId;
		}
	};
	
	// Check keyboard bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Keyboard)];
		if (handler) {
			std::vector<KeyboardBinding> bindings;
			// Get from input map
			auto it = m_inputMap.keyboard.find(action);
			if (it != m_inputMap.keyboard.end()) {
				bindings = it->second;
			}
			// Merge with context stack
			auto contextBindings = m_contexts.getKeyboardBindings(action);
			for (const auto& b : contextBindings) {
				bool found = false;
				for (const auto& existing : bindings) {
					if (existing.id == b.id) { found = true; break; }
				}
				if (!found) bindings.push_back(b);
			}
			
			for (const auto& binding : bindings) {
				ButtonState state = getSimButtonState(
					binding.id,
					InputSource::Keyboard,
					windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
				);
				
				if (state.pressed) anyPressed = true;
				if (state.justpressed) anyJustPressed = true;
				if (state.justreleased) anyJustReleased = true;
				if (state.waspressed) anyWasPressed = true;
				if (state.wasreleased) anyWasReleased = true;
				if (state.consumed) anyConsumed = true;
				
				if (!state.justpressed) allJustPressed = false;
				if (!state.justreleased) allJustReleased = false;
				
				if (state.pressedAtMs.has_value() && state.pressedAtMs.value() > latestPressedAt) {
					latestPressedAt = state.pressedAtMs.value();
				}
				if (state.timestamp.has_value() && state.timestamp.value() > latestTimestamp) {
					latestTimestamp = state.timestamp.value();
					latestPressId = state.pressId;
				}
				updateBufferedIds(InputSource::Keyboard, binding.id);
				
				bindingCount++;
			}
		}
	}
	
	// Check gamepad bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Gamepad)];
		if (handler) {
			std::vector<GamepadBinding> bindings;
			auto it = m_inputMap.gamepad.find(action);
			if (it != m_inputMap.gamepad.end()) {
				bindings = it->second;
			}
			auto contextBindings = m_contexts.getGamepadBindings(action);
			for (const auto& b : contextBindings) {
				bool found = false;
				for (const auto& existing : bindings) {
					if (existing.id == b.id) { found = true; break; }
				}
				if (!found) bindings.push_back(b);
			}
			
			for (const auto& binding : bindings) {
				ButtonState state = getSimButtonState(
					binding.id,
					InputSource::Gamepad,
					windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
				);
				
				if (state.pressed) anyPressed = true;
				if (state.justpressed) anyJustPressed = true;
				if (state.justreleased) anyJustReleased = true;
				if (state.waspressed) anyWasPressed = true;
				if (state.wasreleased) anyWasReleased = true;
				if (state.consumed) anyConsumed = true;
				
				if (!state.justpressed) allJustPressed = false;
				if (!state.justreleased) allJustReleased = false;
				
				if (state.pressedAtMs.has_value() && state.pressedAtMs.value() > latestPressedAt) {
					latestPressedAt = state.pressedAtMs.value();
				}
				if (state.timestamp.has_value() && state.timestamp.value() > latestTimestamp) {
					latestTimestamp = state.timestamp.value();
					latestPressId = state.pressId;
				}
				updateBufferedIds(InputSource::Gamepad, binding.id);
				
				bindingCount++;
			}
		}
	}
	
	// Check pointer bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Pointer)];
		if (handler) {
			std::vector<PointerBinding> bindings;
			auto it = m_inputMap.pointer.find(action);
			if (it != m_inputMap.pointer.end()) {
				bindings = it->second;
			}
			auto contextBindings = m_contexts.getPointerBindings(action);
			for (const auto& b : contextBindings) {
				bool found = false;
				for (const auto& existing : bindings) {
					if (existing.id == b.id) { found = true; break; }
				}
				if (!found) bindings.push_back(b);
			}
			
			for (const auto& binding : bindings) {
				ButtonState state = getSimButtonState(
					binding.id,
					InputSource::Pointer,
					windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
				);
				
				if (state.pressed) anyPressed = true;
				if (state.justpressed) anyJustPressed = true;
				if (state.justreleased) anyJustReleased = true;
				if (state.waspressed) anyWasPressed = true;
				if (state.wasreleased) anyWasReleased = true;
				if (state.consumed) anyConsumed = true;
				
				if (!state.justpressed) allJustPressed = false;
				if (!state.justreleased) allJustReleased = false;
				
				if (state.pressedAtMs.has_value() && state.pressedAtMs.value() > latestPressedAt) {
					latestPressedAt = state.pressedAtMs.value();
				}
				if (state.timestamp.has_value() && state.timestamp.value() > latestTimestamp) {
					latestTimestamp = state.timestamp.value();
					latestPressId = state.pressId;
				}
				updateBufferedIds(InputSource::Pointer, binding.id);
				
				bindingCount++;
			}
		}
	}
	
	// If no bindings, return empty state
	if (bindingCount == 0) {
		return result;
	}
	
	// Parity with TS: don't treat as just released while any binding is still pressed
	if (anyPressed) {
		anyJustReleased = false;
	}

	// Aggregate results
	result.pressed = anyPressed;
	// Keep jp/jr sourced directly from the button-level simframe buffer.
	// Re-surfacing edges at action level lets host-side reads steal a future simframe edge during slowdown.
	if (anyJustPressed && bufferedPressId.has_value() && (!latestPressId.has_value() || bufferedPressId.value() > latestPressId.value())) {
		latestPressId = bufferedPressId;
	}

	result.justpressed = anyJustPressed;
	result.justreleased = anyJustReleased && !anyPressed;
	result.waspressed = anyWasPressed;
	result.wasreleased = anyWasReleased;
	result.alljustpressed = allJustPressed && anyJustPressed;
	result.alljustreleased = allJustReleased && anyJustReleased;
	result.allwaspressed = anyWasPressed;  // Simplified from TS
	result.consumed = anyConsumed;
	
	if (latestPressedAt > 0.0) {
		result.pressedAtMs = latestPressedAt;
	}
	if (latestTimestamp > 0.0) {
		result.timestamp = latestTimestamp;
	}
	result.pressId = latestPressId;
	
	// Calculate press time
	if (result.pressed && result.pressedAtMs.has_value() && m_lastPollTimestampMs.has_value()) {
		result.presstime = m_lastPollTimestampMs.value() - result.pressedAtMs.value();
	}
	
	// Evaluate guard and repeat
	result.guardedjustpressed = evaluateActionGuard(action, result);
	auto repeat = evaluateActionRepeat(action, result, simFrame());
	result.repeatpressed = repeat.triggered;
	result.repeatcount = repeat.count;

	return result;
}

std::vector<ActionState> PlayerInput::getPressedActions(const PressedActionsQuery* query) {
	std::vector<ActionState> pressedActions;
	std::set<std::string> checkedActions;
	
	// Collect all action names from input map
	for (const auto& [action, _] : m_inputMap.keyboard) {
		if (checkedActions.find(action) == checkedActions.end()) {
			auto state = getActionState(action);
			if (state.pressed) {
				pressedActions.push_back(state);
			}
			checkedActions.insert(action);
		}
	}
	for (const auto& [action, _] : m_inputMap.gamepad) {
		if (checkedActions.find(action) == checkedActions.end()) {
			auto state = getActionState(action);
			if (state.pressed) {
				pressedActions.push_back(state);
			}
			checkedActions.insert(action);
		}
	}
	for (const auto& [action, _] : m_inputMap.pointer) {
		if (checkedActions.find(action) == checkedActions.end()) {
			auto state = getActionState(action);
			if (state.pressed) {
				pressedActions.push_back(state);
			}
			checkedActions.insert(action);
		}
	}
	
	// Filter by priority if query provided
	if (query && !query->actionsByPriority.empty()) {
		std::vector<ActionState> priorityActions;
		for (const auto& priorityAction : query->actionsByPriority) {
			auto it = std::find_if(pressedActions.begin(), pressedActions.end(),
				[&priorityAction](const ActionState& s) { return s.action == priorityAction; });
			if (it != pressedActions.end()) {
				priorityActions.push_back(*it);
			}
		}
		return priorityActions;
	}
	
	return pressedActions;
}

bool PlayerInput::checkActionTriggered(const std::string& actionDef) {
	return ActionDefinitionEvaluator::checkActionTriggered(actionDef,
		[this](const std::string& name, std::optional<f64> win) {
			return getActionState(name, win);
		});
}

/* ============================================================================
 * Button state
 * ============================================================================ */

ButtonState PlayerInput::getButtonState(const std::string& button, InputSource source) {
	return getSimButtonState(button, source);
}

ButtonState PlayerInput::getRawButtonState(const std::string& button, InputSource source) {
	auto* handler = m_handlers[sourceIndex(source)];
	return handler ? handler->getButtonState(button) : ButtonState{};
}

ActionState PlayerInput::getButtonRepeatState(const std::string& button, InputSource source) {
	ButtonState state = getRawButtonState(button, source);
	std::string repeatKey = std::to_string(static_cast<int>(source)) + ":" + button;
	ActionState actionState(repeatKey, state);
	auto repeat = evaluateRawActionRepeat(repeatKey, state, m_frameCounter);
	actionState.repeatcount = repeat.count;
	actionState.repeatpressed = repeat.triggered;
	return actionState;
}

ButtonState PlayerInput::getKeyState(const std::string& key, KeyModifier modifiers) {
	auto state = getSimButtonState(key, InputSource::Keyboard);
	
	// If no modifiers required, return as is
	if (modifiers == KeyModifier::None) return state;
	
	// Check current modifier states
	auto modState = getModifiersState();
	
	// Verify required modifiers are active
	if ((hasModifier(modifiers, KeyModifier::Shift) && !modState.shift) ||
		(hasModifier(modifiers, KeyModifier::Ctrl) && !modState.ctrl) ||
		(hasModifier(modifiers, KeyModifier::Alt) && !modState.alt) ||
		(hasModifier(modifiers, KeyModifier::Meta) && !modState.meta)) {
		return ButtonState{};  // Required modifier not active
	}
	
	return state;
}

ButtonState PlayerInput::getSimButtonState(const std::string& button, InputSource source, std::optional<i32> windowFrames) {
	return stateManager(source).getButtonState(button, windowFrames);
}

/* ============================================================================
 * Modifiers
 * ============================================================================ */

PlayerInput::ModifierState PlayerInput::getModifiersState() {
	auto* keyboard = m_handlers[sourceIndex(InputSource::Keyboard)];
	if (!keyboard) return {};
	
	ModifierState state;
	state.ctrl = keyboard->getButtonState("ControlLeft").pressed ||
					keyboard->getButtonState("ControlRight").pressed;
	state.alt = keyboard->getButtonState("AltLeft").pressed ||
				keyboard->getButtonState("AltRight").pressed;
	state.shift = keyboard->getButtonState("ShiftLeft").pressed ||
					keyboard->getButtonState("ShiftRight").pressed;
	state.meta = keyboard->getButtonState("MetaLeft").pressed ||
					keyboard->getButtonState("MetaRight").pressed;
	return state;
}

KeyModifier PlayerInput::getModifiersMask() {
	auto state = getModifiersState();
	KeyModifier mask = KeyModifier::None;
	if (state.shift) mask |= KeyModifier::Shift;
	if (state.ctrl) mask |= KeyModifier::Ctrl;
	if (state.alt) mask |= KeyModifier::Alt;
	if (state.meta) mask |= KeyModifier::Meta;
	return mask;
}

PlayerInput::ModifierState PlayerInput::modifiersFromMask(KeyModifier mask) {
	return {
		hasModifier(mask, KeyModifier::Shift),
		hasModifier(mask, KeyModifier::Ctrl),
		hasModifier(mask, KeyModifier::Alt),
		hasModifier(mask, KeyModifier::Meta)
	};
}

/* ============================================================================
 * Consume / Reset
 * ============================================================================ */

void PlayerInput::consumeAction(const std::string& action) {
	// Consume keyboard bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Keyboard)];
		if (handler) {
			auto it = m_inputMap.keyboard.find(action);
			if (it != m_inputMap.keyboard.end()) {
				for (const auto& binding : it->second) {
					auto state = getButtonState(binding.id, InputSource::Keyboard);
					if (state.pressed && !state.consumed) {
						consumeGameplayButton(binding.id, InputSource::Keyboard);
					}
				}
			}
		}
	}
	
	// Consume gamepad bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Gamepad)];
		if (handler) {
			auto it = m_inputMap.gamepad.find(action);
			if (it != m_inputMap.gamepad.end()) {
				for (const auto& binding : it->second) {
					auto state = getButtonState(binding.id, InputSource::Gamepad);
					if (state.pressed && !state.consumed) {
						consumeGameplayButton(binding.id, InputSource::Gamepad);
					}
				}
			}
		}
	}
	
	// Consume pointer bindings
	{
		auto* handler = m_handlers[sourceIndex(InputSource::Pointer)];
		if (handler) {
			auto it = m_inputMap.pointer.find(action);
			if (it != m_inputMap.pointer.end()) {
				for (const auto& binding : it->second) {
					auto state = getButtonState(binding.id, InputSource::Pointer);
					if (state.pressed && !state.consumed) {
						consumeGameplayButton(binding.id, InputSource::Pointer);
					}
				}
			}
		}
	}
}

void PlayerInput::consumeAction(const ActionState& action) {
	consumeAction(action.action);
}

void PlayerInput::consumeButton(const std::string& button, InputSource source) {
	consumeRawButton(button, source);
}

void PlayerInput::consumeRawButton(const std::string& button, InputSource source) {
	auto* handler = m_handlers[sourceIndex(source)];
	if (handler) {
		handler->consumeButton(button);
	}
}

void PlayerInput::consumeGameplayButton(const std::string& button, InputSource source) {
	auto state = getButtonState(button, source);
	stateManager(source).consumeBufferedEvent(button, state.pressId);
}

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void PlayerInput::pollInput(f64 currentTimeMs) {
	m_frameCounter++;
	m_lastPollTimestampMs = currentTimeMs;
	
	// Poll all handlers (they read their internal state from device input)
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (m_handlers[i]) {
			m_handlers[i]->pollInput();
		}
	}
}

void PlayerInput::recordButtonEvent(InputSource source, const std::string& button, InputEvent evt) {
	trackButton(source, button);
	stateManager(source).addInputEvent(std::move(evt));
}

void PlayerInput::recordAxis1Input(InputSource source, const std::string& button, f32 value, f64 timestamp) {
	trackButton(source, button);
	stateManager(source).recordAxis1Sample(button, value, timestamp);
}

void PlayerInput::recordAxis2Input(InputSource source, const std::string& button, f32 x, f32 y, f64 timestamp) {
	trackButton(source, button);
	stateManager(source).recordAxis2Sample(button, x, y, timestamp);
}

void PlayerInput::beginFrame(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		const InputSource source = INPUT_SOURCES[i];
		auto& manager = stateManager(source);
		manager.beginFrame(currentTimeMs);
		auto* handler = m_handlers[i];
		for (const auto& button : m_trackedButtons[i]) {
			manager.latchButtonState(button, handler ? handler->getButtonState(button) : ButtonState{}, currentTimeMs);
		}
	}
}

void PlayerInput::update(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		stateManager(INPUT_SOURCES[i]).update(currentTimeMs);
	}
}

/* ============================================================================
 * Reset
 * ============================================================================ */

void PlayerInput::reset(const std::vector<std::string>* except) {
	clearEdgeState();
	
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (m_handlers[i]) {
			m_handlers[i]->reset(except);
		}
	}
	
	m_actionGuardRecords.clear();
	m_simActionRepeatRecords.clear();
	m_rawActionRepeatRecords.clear();
	m_lastPollTimestampMs.reset();
	m_frameCounter = 0;
}

void PlayerInput::clearEdgeState() {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		stateManager(INPUT_SOURCES[i]).resetEdgeState();
	}
	m_actionGuardRecords.clear();
	m_simActionRepeatRecords.clear();
}

/* ============================================================================
 * Guard and Repeat helpers
 * ============================================================================ */

bool PlayerInput::evaluateActionGuard(const std::string& action, const ActionState& state,
										std::optional<f64> windowOverride) {
	if (!state.justpressed) return false;
	
	const i64 frameId = simFrame();
	const i64 guardFrames = normalizeGuardWindow(windowOverride);
	
	auto it = m_actionGuardRecords.find(action);
	auto pressId = state.pressId;
	
	if (it != m_actionGuardRecords.end()) {
		const auto& existing = it->second;
		if (existing.lastPressId.has_value() && pressId.has_value() &&
			existing.lastPressId.value() == pressId.value()) {
			return existing.lastResultAccepted;
		}
		if (existing.lastObservedFrame == frameId && existing.lastWindowFrames == guardFrames) {
			return existing.lastResultAccepted;
		}
	}
	
	i64 previousAcceptedFrame = (it != m_actionGuardRecords.end())
		? it->second.lastAcceptedFrame : -1;
	
	bool accepted = true;
	if (previousAcceptedFrame >= 0) {
		const i64 delta = frameId - previousAcceptedFrame;
		if (delta <= guardFrames) {
			accepted = false;
		}
	}
	
	ActionGuardRecord record;
	record.lastAcceptedFrame = accepted ? frameId : previousAcceptedFrame;
	record.lastObservedFrame = frameId;
	record.lastResultAccepted = accepted;
	record.lastWindowFrames = guardFrames;
	record.lastPressId = pressId;
	m_actionGuardRecords[action] = record;
	
	return accepted;
}

PlayerInput::RepeatResult PlayerInput::evaluateActionRepeat(const std::string& action,
																const ActionState& state,
																i64 frameId) {
	auto& repeat = ensureSimRepeatState(action);
	
	if (repeat.lastFrameEvaluated == frameId) {
		return {repeat.lastResult, repeat.repeatCount};
	}
	
	bool result = false;
	bool pressed = state.pressed;
	bool justpressed = state.justpressed;
	
	if (justpressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartFrame = frameId;
		repeat.lastRepeatFrame = frameId;
	} else if (!pressed) {
		repeat.active = false;
		repeat.repeatCount = 0;
		repeat.pressStartFrame = -1;
		repeat.lastRepeatFrame = -1;
	} else {
		if (!repeat.active) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartFrame = frameId;
			repeat.lastRepeatFrame = frameId;
		}
		if (repeat.pressStartFrame < 0) {
			repeat.pressStartFrame = frameId;
		}
		
		i64 nextFrame = (repeat.repeatCount == 0)
			? repeat.pressStartFrame + INITIAL_REPEAT_DELAY_FRAMES
			: repeat.lastRepeatFrame + REPEAT_INTERVAL_FRAMES;
		
		if (frameId >= nextFrame) {
			repeat.repeatCount++;
			repeat.lastRepeatFrame = nextFrame;
			result = true;
		}
	}
	
	repeat.lastFrameEvaluated = frameId;
	repeat.lastResult = result;
	
	return {result, repeat.repeatCount};
}

i64 PlayerInput::normalizeGuardWindow(std::optional<f64> windowOverride) {
	const f64 guardMs = windowOverride.has_value() && windowOverride.value() >= 0.0
		? clamp(windowOverride.value(), ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS)
		: ACTION_GUARD_MIN_MS;
	return std::max<i64>(1, static_cast<i64>(std::ceil(guardMs / Runtime::instance().timing.frameDurationMs)));
}

PlayerInput::RepeatResult PlayerInput::evaluateRawActionRepeat(const std::string& action,
																const ButtonState& state,
																i64 frameId) {
	auto& repeat = ensureRawRepeatState(action);
	if (repeat.lastFrameEvaluated == frameId) {
		return { repeat.lastResult, repeat.repeatCount };
	}

	bool result = false;
	const bool pressed = state.pressed;
	const bool justpressed = state.justpressed;
	const f64 now = m_lastPollTimestampMs.value_or(0.0);
	const f64 startMs = state.pressedAtMs.value_or(state.timestamp.value_or(now));
	const f64 frameMs = Runtime::instance().timing.frameDurationMs;
	const f64 initialDelayMs = INITIAL_REPEAT_DELAY_FRAMES * frameMs;
	const f64 repeatIntervalMs = REPEAT_INTERVAL_FRAMES * frameMs;

	if (justpressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartMs = startMs;
		repeat.lastRepeatAtMs = startMs;
	} else if (!pressed) {
		repeat.active = false;
		repeat.repeatCount = 0;
		repeat.pressStartMs = -1.0;
		repeat.lastRepeatAtMs = -1.0;
	} else {
		if (!repeat.active) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = startMs;
			repeat.lastRepeatAtMs = startMs;
		}
		if (repeat.pressStartMs < 0.0) {
			repeat.pressStartMs = startMs;
		}

		const f64 nextAt = (repeat.repeatCount == 0)
			? repeat.pressStartMs + initialDelayMs
			: repeat.lastRepeatAtMs + repeatIntervalMs;
		if (now >= nextAt) {
			repeat.repeatCount++;
			repeat.lastRepeatAtMs = nextAt;
			result = true;
		}
	}

	repeat.lastFrameEvaluated = frameId;
	repeat.lastResult = result;
	return { result, repeat.repeatCount };
}

SimActionRepeatRecord& PlayerInput::ensureSimRepeatState(const std::string& action) {
	auto it = m_simActionRepeatRecords.find(action);
	if (it == m_simActionRepeatRecords.end()) {
		SimActionRepeatRecord record;
		record.active = false;
		record.repeatCount = 0;
		record.pressStartFrame = -1;
		record.lastFrameEvaluated = -1;
		record.lastResult = false;
		record.lastRepeatFrame = -1;
		m_simActionRepeatRecords[action] = record;
		return m_simActionRepeatRecords[action];
	}
	return it->second;
}

RawActionRepeatRecord& PlayerInput::ensureRawRepeatState(const std::string& action) {
	auto it = m_rawActionRepeatRecords.find(action);
	if (it == m_rawActionRepeatRecords.end()) {
		RawActionRepeatRecord record;
		record.active = false;
		record.repeatCount = 0;
		record.pressStartMs = -1.0;
		record.lastFrameEvaluated = -1;
		record.lastResult = false;
		record.lastRepeatAtMs = -1.0;
		m_rawActionRepeatRecords[action] = record;
		return m_rawActionRepeatRecords[action];
	}
	return it->second;
}

} // namespace bmsx
