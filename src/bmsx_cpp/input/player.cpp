/*
 * player.cpp - Per-player input handling implementation
 */

#include "player.h"
#include "action_parser.h"
#include "common/clamp.h"
#include <algorithm>
#include <cmath>
#include <variant>

namespace bmsx {
namespace {

struct ActionAggregation {
	bool anyPressed = false;
	bool anyJustPressed = false;
	bool anyJustReleased = false;
	bool anyWasPressed = false;
	bool anyWasReleased = false;
	bool anyConsumed = false;
	bool allJustPressed = true;
	bool allJustReleased = true;
	bool allWasPressed = true;
	i32 bindingCount = 0;
	f64 latestPressedAt = 0.0;
	f64 latestTimestamp = 0.0;
	std::optional<f64> leastPressTime;
	std::optional<i32> latestPressId;
	std::optional<i32> bufferedPressId;
	f32 best1DValue = 0.0f;
	f32 best1DAbs = -1.0f;
	std::optional<Vec2> best2DValue;
	f32 best2DAbs = -1.0f;
};

void addActionBindingState(ActionAggregation& aggregation, const ButtonState& state) {
	aggregation.anyPressed = aggregation.anyPressed || state.pressed;
	aggregation.anyJustPressed = aggregation.anyJustPressed || state.justpressed;
	aggregation.anyJustReleased = aggregation.anyJustReleased || state.justreleased;
	aggregation.anyWasPressed = aggregation.anyWasPressed || state.waspressed;
	aggregation.anyWasReleased = aggregation.anyWasReleased || state.wasreleased;
	aggregation.anyConsumed = aggregation.anyConsumed || state.consumed;
	aggregation.allJustPressed = aggregation.allJustPressed && state.justpressed;
	aggregation.allJustReleased = aggregation.allJustReleased && state.justreleased;
	aggregation.allWasPressed = aggregation.allWasPressed && state.waspressed;
	if (state.presstime.has_value() && (!aggregation.leastPressTime.has_value() || state.presstime.value() < aggregation.leastPressTime.value())) {
		aggregation.leastPressTime = state.presstime;
	}
	if (state.pressedAtMs.has_value() && state.pressedAtMs.value() > aggregation.latestPressedAt) {
		aggregation.latestPressedAt = state.pressedAtMs.value();
	}
	if (state.pressId.has_value() && (state.justpressed || !aggregation.latestPressId.has_value() || (state.timestamp.has_value() && state.timestamp.value() >= aggregation.latestTimestamp))) {
		aggregation.latestPressId = state.pressId;
	}
	if (state.timestamp.has_value() && state.timestamp.value() > aggregation.latestTimestamp) {
		aggregation.latestTimestamp = state.timestamp.value();
	}
	const f32 valueAbs = std::abs(state.value);
	if (valueAbs > aggregation.best1DAbs) {
		aggregation.best1DAbs = valueAbs;
		aggregation.best1DValue = state.value;
	}
	if (state.value2d.has_value()) {
		const f32 magnitude = std::hypot(state.value2d->x, state.value2d->y);
		if (magnitude > aggregation.best2DAbs) {
			aggregation.best2DAbs = magnitude;
			aggregation.best2DValue = state.value2d;
		}
	}
	aggregation.bindingCount++;
}

} // namespace

/* ============================================================================
 * Constructor / Destructor
 * ============================================================================ */

PlayerInput::PlayerInput(i32 playerIndex)
	: playerIndex(playerIndex)
{
	reset();
}

PlayerInput::~PlayerInput() = default;

/* ============================================================================
 * Input handlers
 * ============================================================================ */

void PlayerInput::assignGamepadToPlayer(InputHandler* gamepad) {
	auto* existing = inputHandlers[sourceIndex(InputSource::Gamepad)];
	if (existing && existing != gamepad) {
		existing->reset();
	}
	inputHandlers[sourceIndex(InputSource::Gamepad)] = gamepad;
}

void PlayerInput::clearGamepad(InputHandler* handler) {
	if (inputHandlers[sourceIndex(InputSource::Gamepad)] != handler) return;
	inputHandlers[sourceIndex(InputSource::Gamepad)] = nullptr;
	handler->reset();
}

/* ============================================================================
 * Input mapping
 * ============================================================================ */

void PlayerInput::setInputMap(const InputMap& map) {
	inputMap = map;
	trackInputMapBindings(map);
	MappingContext base("base", 0, true);
	base.keyboard = inputMap.keyboard;
	base.gamepad = inputMap.gamepad;
	base.pointer = inputMap.pointer;
	m_contexts = ContextStack();
	m_contexts.push(base);
}

/* ============================================================================
 * Context stacking
 * ============================================================================ */

void PlayerInput::pushContext(const std::string& id, const KeyboardInputMapping& keyboard, const GamepadInputMapping& gamepad, const PointerInputMapping& pointer, i32 priority, bool enabled) {
	trackInputMapBindings(InputMap{keyboard, gamepad, pointer});
	MappingContext ctx(id, priority, enabled);
	ctx.keyboard = keyboard;
	ctx.gamepad = gamepad;
	ctx.pointer = pointer;
	m_contexts.push(ctx);
}

void PlayerInput::popContext(const std::string& id) {
	m_contexts.pop(id);
}

void PlayerInput::enableContext(const std::string& id, bool enabled) {
	m_contexts.enable(id, enabled);
}

void PlayerInput::setContextPriority(const std::string& id, i32 priority) {
	m_contexts.setPriority(id, priority);
}

bool PlayerInput::supportsVibrationEffect() const {
	for (InputHandler* handler : inputHandlers) {
		if (handler && handler->supportsVibrationEffect()) {
			return true;
		}
	}
	return false;
}

void PlayerInput::applyVibrationEffect(const VibrationParams& params) {
	for (InputHandler* handler : inputHandlers) {
		if (handler && handler->supportsVibrationEffect()) {
			handler->applyVibrationEffect(params);
		}
	}
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
	ActionAggregation aggregation;

	const auto updateBufferedIds = [&](InputSource source, const std::string& id) {
		auto pressId = getStateManager(source).getLatestUnconsumedPressId(id);
		if (pressId.has_value() && (!aggregation.bufferedPressId.has_value() || pressId.value() > aggregation.bufferedPressId.value())) {
			aggregation.bufferedPressId = pressId;
		}
	};

	{
		const auto bindings = m_contexts.getBindings(action, InputSource::Keyboard);
		for (const auto& binding : bindings) {
			const auto& keyboardBinding = std::get<KeyboardBinding>(binding);
			ButtonState state = getSimButtonState(
				keyboardBinding.id,
				InputSource::Keyboard,
				windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
			);

			addActionBindingState(aggregation, state);
			updateBufferedIds(InputSource::Keyboard, keyboardBinding.id);
		}
	}

	{
		const auto bindings = m_contexts.getBindings(action, InputSource::Gamepad);
		for (const auto& binding : bindings) {
			const auto& gamepadBinding = std::get<GamepadBinding>(binding);
			ButtonState state = getSimButtonState(
				gamepadBinding.id,
				InputSource::Gamepad,
				windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
			);

			addActionBindingState(aggregation, state);
			updateBufferedIds(InputSource::Gamepad, gamepadBinding.id);
		}
	}

	{
		const auto bindings = m_contexts.getBindings(action, InputSource::Pointer);
		for (const auto& binding : bindings) {
			const auto& pointerBinding = std::get<PointerBinding>(binding);
			ButtonState state = getSimButtonState(
				pointerBinding.id,
				InputSource::Pointer,
				windowFrames.has_value() ? std::optional<i32>(static_cast<i32>(windowFrames.value())) : std::nullopt
			);

			addActionBindingState(aggregation, state);
			updateBufferedIds(InputSource::Pointer, pointerBinding.id);
		}
	}

	// If no bindings, return empty state
	if (aggregation.bindingCount == 0) {
		return result;
	}

	// Parity with TS: don't treat as just released while any binding is still pressed
	if (aggregation.anyPressed) {
		aggregation.anyJustReleased = false;
	}

	// Aggregate results
	result.pressed = aggregation.anyPressed;
	// Keep jp/jr sourced directly from the button-level simframe buffer.
	// Re-surfacing edges at action level lets host-side reads steal a future simframe edge during slowdown.
	if (aggregation.anyJustPressed && aggregation.bufferedPressId.has_value() && (!aggregation.latestPressId.has_value() || aggregation.bufferedPressId.value() > aggregation.latestPressId.value())) {
		aggregation.latestPressId = aggregation.bufferedPressId;
	}

	result.justpressed = aggregation.anyJustPressed;
	result.justreleased = aggregation.anyJustReleased && !aggregation.anyPressed;
	result.waspressed = aggregation.anyWasPressed;
	result.wasreleased = aggregation.anyWasReleased;
	result.alljustpressed = aggregation.allJustPressed && aggregation.anyJustPressed;
	result.alljustreleased = aggregation.allJustReleased && aggregation.anyJustReleased;
	result.allwaspressed = aggregation.allWasPressed && aggregation.anyWasPressed;
	result.consumed = aggregation.anyConsumed;

	if (aggregation.latestPressedAt > 0.0) {
		result.pressedAtMs = aggregation.latestPressedAt;
	}
	if (aggregation.latestTimestamp > 0.0) {
		result.timestamp = aggregation.latestTimestamp;
	}
	result.pressId = aggregation.latestPressId;

	if (aggregation.leastPressTime.has_value()) {
		result.presstime = aggregation.leastPressTime;
	}
	if (aggregation.best1DAbs >= 0.0f) {
		result.value = aggregation.best1DValue;
	}
	if (aggregation.best2DValue.has_value()) {
		result.value2d = aggregation.best2DValue;
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

	const auto considerAction = [&](const std::string& action) {
		if (checkedActions.find(action) != checkedActions.end()) {
			return;
		}
		checkedActions.insert(action);
		if (query && !query->filter.empty() && std::find(query->filter.begin(), query->filter.end(), action) == query->filter.end()) {
			return;
		}
		const ActionState actionState = getActionState(action);
		const bool justPressedMatches = !(query && query->justPressed.has_value() && query->justPressed.value()) || actionState.justpressed;
		bool consumedMatches = true;
		if (query && query->consumed.has_value()) {
			consumedMatches = query->consumed.value() ? actionState.consumed : !actionState.consumed;
		}
		const bool pressedMatches = query && query->pressed.has_value()
			? (query->pressed.value() ? actionState.pressed : !actionState.pressed)
			: actionState.pressed;
		const f64 pressTime = actionState.presstime.has_value() ? actionState.presstime.value() : 0.0;
		const f64 threshold = query && query->pressTime.has_value() ? query->pressTime.value() : 0.0;
		if (pressedMatches && justPressedMatches && consumedMatches && pressTime >= threshold) {
			pressedActions.push_back(actionState);
		}
	};

	for (const auto& [action, _] : inputMap.keyboard) {
		(void)_;
		considerAction(action);
	}
	for (const auto& [action, _] : inputMap.gamepad) {
		(void)_;
		considerAction(action);
	}
	for (const auto& [action, _] : inputMap.pointer) {
		(void)_;
		considerAction(action);
	}

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
	auto* handler = inputHandlers[sourceIndex(source)];
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
	return getStateManager(source).getButtonState(button, windowFrames);
}

/* ============================================================================
 * Modifiers
 * ============================================================================ */

PlayerInput::ModifierState PlayerInput::getModifiersState() {
	auto* keyboard = inputHandlers[sourceIndex(InputSource::Keyboard)];
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
		auto* handler = inputHandlers[sourceIndex(InputSource::Keyboard)];
		if (handler) {
			auto it = inputMap.keyboard.find(action);
			if (it != inputMap.keyboard.end()) {
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
		auto* handler = inputHandlers[sourceIndex(InputSource::Gamepad)];
		if (handler) {
			auto it = inputMap.gamepad.find(action);
			if (it != inputMap.gamepad.end()) {
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
		auto* handler = inputHandlers[sourceIndex(InputSource::Pointer)];
		if (handler) {
			auto it = inputMap.pointer.find(action);
			if (it != inputMap.pointer.end()) {
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
	auto* handler = inputHandlers[sourceIndex(source)];
	if (handler) {
		handler->consumeButton(button);
	}
}

void PlayerInput::consumeGameplayButton(const std::string& button, InputSource source) {
	auto state = getButtonState(button, source);
	getStateManager(source).consumeBufferedEvent(button, state.pressId);
}

/* ============================================================================
 * Frame lifecycle
 * ============================================================================ */

void PlayerInput::pollInput(f64 currentTimeMs) {
	m_frameCounter++;
	m_lastPollTimestampMs = currentTimeMs;

	// Poll all handlers (they read their internal state from device input)
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (inputHandlers[i]) {
			inputHandlers[i]->pollInput();
		}
	}
}

void PlayerInput::recordButtonEvent(InputSource source, const std::string& button, InputEvent evt) {
	trackButton(source, button);
	getStateManager(source).addInputEvent(std::move(evt));
}

void PlayerInput::recordAxis1Input(InputSource source, const std::string& button, f32 value, f64 timestamp) {
	trackButton(source, button);
	getStateManager(source).recordAxis1Sample(button, value, timestamp);
}

void PlayerInput::recordAxis2Input(InputSource source, const std::string& button, f32 x, f32 y, f64 timestamp) {
	trackButton(source, button);
	getStateManager(source).recordAxis2Sample(button, x, y, timestamp);
}

void PlayerInput::beginFrame(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		const InputSource source = INPUT_SOURCES[i];
		auto& manager = getStateManager(source);
		manager.beginFrame(currentTimeMs);
		auto* handler = inputHandlers[i];
		for (const auto& button : m_trackedButtons[i]) {
			manager.latchButtonState(button, handler ? handler->getButtonState(button) : ButtonState{}, currentTimeMs);
		}
	}
}

void PlayerInput::update(f64 currentTimeMs) {
	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		getStateManager(INPUT_SOURCES[i]).update(currentTimeMs);
	}
}

/* ============================================================================
 * Reset
 * ============================================================================ */

void PlayerInput::reset(const std::vector<std::string>* except) {
	clearEdgeState();

	for (size_t i = 0; i < INPUT_SOURCE_COUNT; i++) {
		if (inputHandlers[i]) {
			inputHandlers[i]->reset(except);
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
		getStateManager(INPUT_SOURCES[i]).resetEdgeState();
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

	if (state.justpressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartFrame = frameId;
		repeat.lastRepeatFrame = frameId;
	} else if (!state.pressed) {
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
	return std::max<i64>(1, static_cast<i64>(std::ceil(guardMs / m_frameDurationMs)));
}

PlayerInput::RepeatResult PlayerInput::evaluateRawActionRepeat(const std::string& action,
																const ButtonState& state,
																i64 frameId) {
	auto& repeat = ensureRawRepeatState(action);
	if (repeat.lastFrameEvaluated == frameId) {
		return { repeat.lastResult, repeat.repeatCount };
	}

		bool result = false;
		const f64 now = m_lastPollTimestampMs.value();
		const f64 startMs = buttonPressedAtOr(state, now);
		const f64 frameMs = m_frameDurationMs;
		const f64 initialDelayMs = INITIAL_REPEAT_DELAY_FRAMES * frameMs;
		const f64 repeatIntervalMs = REPEAT_INTERVAL_FRAMES * frameMs;

		if (state.justpressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.pressStartMs = startMs;
			repeat.lastRepeatAtMs = startMs;
		} else if (!state.pressed) {
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
		return m_simActionRepeatRecords.try_emplace(action).first->second;
	}

	RawActionRepeatRecord& PlayerInput::ensureRawRepeatState(const std::string& action) {
		return m_rawActionRepeatRecords.try_emplace(action).first->second;
	}

} // namespace bmsx
