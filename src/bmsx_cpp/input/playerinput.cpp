/*
 * playerinput.cpp - Per-player input handling implementation
 *
 * Mirrors TypeScript input/playerinput.ts
 */

#include "playerinput.h"
#include "actionparser.h"
#include "../core/engine_core.h"
#include "../utils/clamp.h"
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
}

/* ============================================================================
 * Context stacking
 * ============================================================================ */

void PlayerInput::pushContext(const std::string& id, i32 priority, const InputMap& map) {
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

/* ============================================================================
 * Action state
 * ============================================================================ */

ActionState PlayerInput::getActionState(const std::string& action, std::optional<f64> windowFrames) {
	// Result state - aggregate from all sources
	ActionState result(action);
	std::optional<f64> windowMs;
	if (windowFrames.has_value()) {
		windowMs = windowFrames.value() * EngineCore::instance().deltaTime() * 1000.0;
	}
	//  else {
	// 	// Parity with TS: If no window provided, use default retention window
	// 	windowMs = 150.0 * EngineCore::instance().deltaTime() * 1000.0;
	// }
	
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
	std::optional<i32> bufferedReleaseId;

	const auto updateBufferedIds = [&](const std::string& id) {
		auto pressId = m_stateManager.getLatestUnconsumedPressId(id);
		if (pressId.has_value() && (!bufferedPressId.has_value() || pressId.value() > bufferedPressId.value())) {
			bufferedPressId = pressId;
		}
		auto releaseId = m_stateManager.getLatestUnconsumedReleaseId(id);
		if (releaseId.has_value() && (!bufferedReleaseId.has_value() || releaseId.value() > bufferedReleaseId.value())) {
			bufferedReleaseId = releaseId;
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
				ButtonState state = windowMs.has_value()
					? m_stateManager.getButtonState(binding.id, windowMs)
					: handler->getButtonState(binding.id);
				
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
				updateBufferedIds(binding.id);
				
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
				ButtonState state = windowMs.has_value()
					? m_stateManager.getButtonState(binding.id, windowMs)
					: handler->getButtonState(binding.id);
				
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
				updateBufferedIds(binding.id);
				
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
				ButtonState state = windowMs.has_value()
					? m_stateManager.getButtonState(binding.id, windowMs)
					: handler->getButtonState(binding.id);
				
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
				updateBufferedIds(binding.id);
				
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
	auto lastPressIt = m_actionPressRecords.find(action);
	const i32 lastPressId = lastPressIt == m_actionPressRecords.end() ? -1 : lastPressIt->second;
	if (!anyJustPressed && bufferedPressId.has_value() && bufferedPressId.value() != lastPressId) {
		anyJustPressed = true;
	}
	
	// Parity with TS: Prefer bufferPressId over latestPressId (bufferPressId ?? latestPressId)
	if (anyJustPressed) {
		std::optional<i32> recordId = bufferedPressId.has_value() ? bufferedPressId : latestPressId;
		if (recordId.has_value()) {
			m_actionPressRecords[action] = recordId.value();
		}
	}

	auto lastReleaseIt = m_actionReleaseRecords.find(action);
	const i32 lastReleaseId = lastReleaseIt == m_actionReleaseRecords.end() ? -1 : lastReleaseIt->second;
	if (!anyJustReleased && bufferedReleaseId.has_value() && bufferedReleaseId.value() != lastReleaseId) {
		anyJustReleased = true;
	}
	if (anyJustReleased && bufferedReleaseId.has_value() && bufferedReleaseId.value() != lastReleaseId) {
		m_actionReleaseRecords[action] = bufferedReleaseId.value();
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
	auto repeat = evaluateActionRepeat(action, result);
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
	auto* handler = m_handlers[sourceIndex(source)];
	if (!handler) return ButtonState{};
	return handler->getButtonState(button);
}

ButtonState PlayerInput::getButtonRepeatState(const std::string& button, InputSource source) {
	auto state = getButtonState(button, source);
	std::string repeatKey = std::to_string(static_cast<int>(source)) + ":" + button;
	ActionState actionState(repeatKey, state);
	auto repeat = evaluateActionRepeat(repeatKey, actionState);
	actionState.repeatcount = repeat.count;
	actionState.repeatpressed = repeat.triggered;
	return actionState;
}

ButtonState PlayerInput::getKeyState(const std::string& key, KeyModifier modifiers) {
	auto state = getButtonState(key, InputSource::Keyboard);
	
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
					auto state = handler->getButtonState(binding.id);
					if (state.pressed && !state.consumed) {
						handler->consumeButton(binding.id);
						m_stateManager.consumeBufferedEvent(binding.id, state.pressId);
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
					auto state = handler->getButtonState(binding.id);
					if (state.pressed && !state.consumed) {
						handler->consumeButton(binding.id);
						m_stateManager.consumeBufferedEvent(binding.id, state.pressId);
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
					auto state = handler->getButtonState(binding.id);
					if (state.pressed && !state.consumed) {
						handler->consumeButton(binding.id);
						m_stateManager.consumeBufferedEvent(binding.id, state.pressId);
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
	auto* handler = m_handlers[sourceIndex(source)];
	if (!handler) return;
	auto state = handler->getButtonState(button);
	handler->consumeButton(button);
	m_stateManager.consumeBufferedEvent(button, state.pressId);
}

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void PlayerInput::pollInput(f64 currentTimeMs) {
	m_frameCounter++;
	
	// Update guard window based on frame timing
	if (m_lastPollTimestampMs.has_value()) {
		f64 delta = currentTimeMs - m_lastPollTimestampMs.value();
		m_guardWindowMs = clamp(delta, ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
	}
	m_lastPollTimestampMs = currentTimeMs;
	
	// Poll all handlers (they read their internal state from device input)
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (m_handlers[i]) {
			m_handlers[i]->pollInput();
		}
	}
}


void PlayerInput::beginFrame(f64 currentTimeMs) {
	m_stateManager.beginFrame(currentTimeMs);
}

void PlayerInput::update(f64 currentTimeMs) {
	m_stateManager.update(currentTimeMs);
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
	m_actionRepeatRecords.clear();
	m_actionPressRecords.clear();
	m_actionReleaseRecords.clear();
	m_lastPollTimestampMs.reset();
	m_guardWindowMs = ACTION_GUARD_MIN_MS;
	m_frameCounter = 0;
}

void PlayerInput::clearEdgeState() {
	m_stateManager.resetEdgeState();
}

/* ============================================================================
 * Guard and Repeat helpers
 * ============================================================================ */

bool PlayerInput::evaluateActionGuard(const std::string& action, const ActionState& state,
										std::optional<f64> windowOverride) {
	if (!state.justpressed) return false;
	
	f64 timestamp = resolveActionTimestamp(state);
	f64 guardMs = normalizeGuardWindow(windowOverride);
	
	auto it = m_actionGuardRecords.find(action);
	auto pressId = state.pressId;
	
	// Check existing record
	if (it != m_actionGuardRecords.end()) {
		const auto& existing = it->second;
		
		// Same pressId already passed guard this frame
		if (existing.lastPressId.has_value() && pressId.has_value() &&
			existing.lastPressId.value() == pressId.value()) {
			return existing.lastResultAccepted;
		}
		
		// Same timestamp/window already evaluated
		if (existing.lastObservedTimestamp == timestamp && existing.lastWindowMs == guardMs) {
			return existing.lastResultAccepted;
		}
	}
	
	f64 previousAcceptedAt = (it != m_actionGuardRecords.end()) 
		? it->second.lastAcceptedAtMs : 0.0;
	
	bool accepted = true;
	if (previousAcceptedAt > 0.0) {
		f64 delta = timestamp - previousAcceptedAt;
		if (std::isfinite(delta) && delta <= guardMs) {
			accepted = false;
		}
	}
	
	// Update record
	ActionGuardRecord record;
	record.lastAcceptedAtMs = accepted ? timestamp : previousAcceptedAt;
	record.lastObservedTimestamp = timestamp;
	record.lastResultAccepted = accepted;
	record.lastWindowMs = guardMs;
	record.lastPressId = pressId;
	m_actionGuardRecords[action] = record;
	
	return accepted;
}

PlayerInput::RepeatResult PlayerInput::evaluateActionRepeat(const std::string& action, 
																const ActionState& state) {
	auto& repeat = ensureRepeatState(action);
	
	if (repeat.lastFrameEvaluated == m_frameCounter) {
		return {repeat.lastResult, repeat.repeatCount};
	}
	
	bool result = false;
	bool pressed = state.pressed;
	bool justpressed = state.justpressed;
	f64 now = m_lastPollTimestampMs.value_or(0.0);
	f64 startMs = state.pressedAtMs.value_or(state.timestamp.value_or(now));
	
	if (justpressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartMs = startMs;
		repeat.lastRepeatAtMs = startMs;
		result = true;
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
		
		f64 nextAt = (repeat.repeatCount == 0)
			? repeat.pressStartMs + INITIAL_REPEAT_DELAY_MS
			: repeat.lastRepeatAtMs + REPEAT_INTERVAL_MS;
		
		if (now >= nextAt) {
			repeat.repeatCount++;
			repeat.lastRepeatAtMs = nextAt;
			result = true;
		}
	}
	
	repeat.lastFrameEvaluated = m_frameCounter;
	repeat.lastResult = result;
	
	return {result, repeat.repeatCount};
}

f64 PlayerInput::normalizeGuardWindow(std::optional<f64> windowOverride) {
	if (windowOverride.has_value() && windowOverride.value() >= 0.0) {
		return clamp(windowOverride.value(), ACTION_GUARD_MIN_MS, ACTION_GUARD_MAX_MS);
	}
	return m_guardWindowMs;
}

f64 PlayerInput::resolveActionTimestamp(const ActionState& state) {
	if (state.timestamp.has_value()) return state.timestamp.value();
	if (state.pressedAtMs.has_value()) return state.pressedAtMs.value();
	if (m_lastPollTimestampMs.has_value()) return m_lastPollTimestampMs.value();
	return 0.0;  // Would use platform clock in full implementation
}

ActionRepeatRecord& PlayerInput::ensureRepeatState(const std::string& action) {
	auto it = m_actionRepeatRecords.find(action);
	if (it == m_actionRepeatRecords.end()) {
		ActionRepeatRecord record;
		record.active = false;
		record.repeatCount = 0;
		record.pressStartMs = -1.0;
		record.lastFrameEvaluated = -1;
		record.lastResult = false;
		record.lastRepeatAtMs = -1.0;
		m_actionRepeatRecords[action] = record;
		return m_actionRepeatRecords[action];
	}
	return it->second;
}

} // namespace bmsx
