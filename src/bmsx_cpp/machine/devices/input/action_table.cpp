#include "machine/devices/input/action_table.h"

#include "input/action_parser.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/devices/input/event_fifo.h"

#include <cmath>
#include <optional>

namespace bmsx {
namespace {

struct SourceActionAccumulator {
	size_t count = 0;
	bool pressed = true;
	bool justPressed = false;
	bool allJustPressed = true;
	bool justReleased = false;
	bool allJustReleased = true;
	bool wasPressed = false;
	bool allWasPressed = true;
	bool wasReleased = false;
	bool consumed = false;
	std::optional<f64> pressTime;
	std::optional<f64> timestamp;
	std::optional<i32> pressId;
	f32 value = 0.0f;
	f32 valueAbs = -1.0f;
	std::optional<Vec2> value2d;
};

void addButtonToAccumulator(SourceActionAccumulator& source, const ButtonState& buttonState) {
	source.count += 1;
	source.pressed = source.pressed && buttonState.pressed;
	source.justPressed = source.justPressed || buttonState.justpressed;
	source.allJustPressed = source.allJustPressed && buttonState.justpressed;
	source.justReleased = source.justReleased || buttonState.justreleased;
	source.allJustReleased = source.allJustReleased && buttonState.justreleased;
	source.wasPressed = source.wasPressed || buttonState.waspressed;
	source.allWasPressed = source.allWasPressed && buttonState.waspressed;
	source.wasReleased = source.wasReleased || buttonState.wasreleased;
	source.consumed = source.consumed || buttonState.consumed;
	if (buttonState.presstime.has_value() && (!source.pressTime.has_value() || buttonState.presstime.value() < source.pressTime.value())) {
		source.pressTime = buttonState.presstime;
	}
	if (buttonState.timestamp.has_value() && (!source.timestamp.has_value() || buttonState.timestamp.value() > source.timestamp.value())) {
		source.timestamp = buttonState.timestamp;
	}
	if (buttonState.pressId.has_value() && (!source.pressId.has_value() || buttonState.pressId.value() > source.pressId.value())) {
		source.pressId = buttonState.pressId;
	}
	const f32 absValue = std::fabs(buttonState.value);
	if (absValue > source.valueAbs) {
		source.valueAbs = absValue;
		source.value = buttonState.value;
	}
	if (buttonState.value2d.has_value()) {
		source.value2d = buttonState.value2d;
	}
}

void mergeSourceAccumulator(ActionState& result, const SourceActionAccumulator& source) {
	if (source.count == 0u) {
		return;
	}
	result.pressed = result.pressed || source.pressed;
	result.justpressed = result.justpressed || (source.pressed && source.justPressed);
	result.justreleased = result.justreleased || (!source.pressed && source.justReleased);
	result.waspressed = result.waspressed || source.wasPressed;
	result.wasreleased = result.wasreleased || source.wasReleased;
	result.consumed = result.consumed || source.consumed;
	result.alljustpressed = result.alljustpressed || source.allJustPressed;
	result.alljustreleased = result.alljustreleased || source.allJustReleased;
	result.allwaspressed = result.allwaspressed || source.allWasPressed;
	if (source.pressTime.has_value() && (!result.presstime.has_value() || source.pressTime.value() < result.presstime.value())) {
		result.presstime = source.pressTime;
	}
	if (source.timestamp.has_value() && (!result.timestamp.has_value() || source.timestamp.value() > result.timestamp.value())) {
		result.timestamp = source.timestamp;
	}
	if (source.pressId.has_value() && (!result.pressId.has_value() || source.pressId.value() > result.pressId.value())) {
		result.pressId = source.pressId;
	}
	if (source.valueAbs > std::fabs(result.value)) {
		result.value = source.value;
	}
	if (source.value2d.has_value()) {
		result.value2d = source.value2d;
	}
}

} // namespace

InputControllerActionTable::InputControllerActionTable(Input& input, const StringPool& strings)
	: m_input(input)
	, m_strings(strings) {
	reset();
}

void InputControllerActionTable::reset() {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		resetPlayerActions(m_playerStates[static_cast<size_t>(playerIndex - 1)]);
	}
}

std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> InputControllerActionTable::capturePlayers() const {
	std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> players;
	for (size_t index = 0; index < m_playerStates.size(); index += 1) {
		players[index].actions = m_playerStates[index].actions;
	}
	return players;
}

void InputControllerActionTable::restorePlayers(const std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT>& players) {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		resetPlayerActions(m_playerStates[static_cast<size_t>(playerIndex - 1)]);
	}
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		restorePlayerActions(
			m_playerStates[static_cast<size_t>(playerIndex - 1)],
			players[static_cast<size_t>(playerIndex - 1)].actions
		);
	}
}

void InputControllerActionTable::commitAction(i32 playerIndex, StringId actionStringId, StringId bindStringId) {
	PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	installActionMapping(state, actionStringId, bindStringId);
	upsertAction(state, actionStringId, bindStringId);
}

void InputControllerActionTable::resetActions(i32 playerIndex) {
	resetPlayerActions(m_playerStates[static_cast<size_t>(playerIndex - 1)]);
}

void InputControllerActionTable::sampleButtons(InputControllerEventFifo& eventFifo) {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
		state.sampledButtonCount = 0;
		sampleLoadedBindings(*playerInput, state);
		for (InputControllerActionState& action : state.actions) {
			const ActionState actionState = createSampledActionState(state, m_strings.toString(action.actionStringId));
			action.statusWord = packInputActionStatus(actionState);
			action.valueQ16 = encodeInputActionValueQ16(actionState);
			action.pressTime = buttonPressTimeOrZero(actionState);
			action.repeatCount = static_cast<u32>(actionRepeatCount(actionState));
			if ((action.statusWord & INP_EVENT_ACTION_STATUS_MASK) != 0u) {
				eventFifo.push(static_cast<u32>(playerIndex), action.actionStringId, action.statusWord, action.valueQ16, action.repeatCount);
			}
		}
	}
}

void InputControllerActionTable::queryAction(i32 playerIndex, const std::string& queryText, InputControllerQueryResult& out) const {
	const PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	const std::string* const simpleActionName = ActionDefinitionEvaluator::getSimpleActionName(queryText);
	ActionState selectedState;
	std::string selectedActionName;
	bool selectedStateSet = false;
	std::optional<f64> selectedWindow;
	const GetterFn readActionState = [this, &state, &selectedState, &selectedActionName, &selectedStateSet, &selectedWindow](
		const std::string& actionName,
		std::optional<f64> windowMs
	) {
		if (!selectedStateSet || selectedActionName != actionName || selectedWindow != windowMs) {
			selectedState = createSampledActionState(state, actionName);
			selectedActionName = actionName;
			selectedWindow = windowMs;
			selectedStateSet = true;
		}
		return selectedState;
	};
	if (simpleActionName) {
		const bool triggered = ActionDefinitionEvaluator::checkActionTriggered(queryText, readActionState);
		if (!triggered) {
			out.statusWord = 0u;
			out.valueQ16 = 0u;
			out.valueXQ16 = 0u;
			out.valueYQ16 = 0u;
			return;
		}
		out.statusWord = packInputActionStatus(selectedState);
		out.valueQ16 = encodeInputActionValueQ16(selectedState);
		out.valueXQ16 = encodeInputActionValueXQ16(selectedState);
		out.valueYQ16 = encodeInputActionValueYQ16(selectedState);
		return;
	}
	const bool triggered = ActionDefinitionEvaluator::checkActionTriggered(queryText, readActionState);
	if (!triggered) {
		out.statusWord = 0u;
		out.valueQ16 = 0u;
		out.valueXQ16 = 0u;
		out.valueYQ16 = 0u;
		return;
	}
	out.statusWord = 1u;
	out.valueQ16 = 0u;
	out.valueXQ16 = 0u;
	out.valueYQ16 = 0u;
}

void InputControllerActionTable::consumeActions(i32 playerIndex, const std::string& actionNames) {
	PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
	PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	size_t start = 0;
	for (size_t index = 0; index <= actionNames.size(); index += 1) {
		if (index != actionNames.size() && actionNames[index] != ',') {
			continue;
		}
		const std::string actionName = actionNames.substr(start, index - start);
		consumeActionButtons(*playerInput, state, actionName);
		markSnapshotActionConsumed(state, actionName);
		start = index + 1;
	}
}

void InputControllerActionTable::resetPlayerActions(PlayerSlot& state) {
	state.bindings.clear();
	loadDefaultBindings(state);
	state.actions.clear();
	state.sampledButtonCount = 0;
}

void InputControllerActionTable::restorePlayerActions(PlayerSlot& state, const std::vector<InputControllerActionState>& actions) {
	for (const InputControllerActionState& action : actions) {
		installActionMapping(state, action.actionStringId, action.bindStringId);
		state.actions.push_back(action);
	}
}

void InputControllerActionTable::installActionMapping(PlayerSlot& state, StringId actionStringId, StringId bindStringId) {
	const std::string& actionName = m_strings.toString(actionStringId);
	removeActionBindings(state, actionName);
	appendBindings(state, actionName, m_strings.toString(bindStringId));
}

void InputControllerActionTable::upsertAction(PlayerSlot& state, StringId actionStringId, StringId bindStringId) {
	for (InputControllerActionState& action : state.actions) {
		if (action.actionStringId == actionStringId) {
			action.bindStringId = bindStringId;
			action.statusWord = 0u;
			action.valueQ16 = 0u;
			action.pressTime = 0.0;
			action.repeatCount = 0u;
			return;
		}
	}
	state.actions.push_back(InputControllerActionState{ actionStringId, bindStringId });
}

void InputControllerActionTable::sampleLoadedBindings(PlayerInput& playerInput, PlayerSlot& state) {
	for (const InputControllerActionBinding& binding : state.bindings) {
		if (!findSampledButton(state, binding.source, binding.button)) {
			writeSampledButton(state, binding.source, binding.button, playerInput.getButtonState(binding.button, binding.source));
		}
	}
}

void InputControllerActionTable::writeSampledButton(PlayerSlot& state, InputSource source, const std::string& button, const ButtonState& buttonState) {
	if (state.sampledButtonCount == state.sampledButtons.size()) {
		state.sampledButtons.push_back(InputControllerSampledButtonState{ source, button, buttonState });
	} else {
		InputControllerSampledButtonState& sampled = state.sampledButtons[state.sampledButtonCount];
		sampled.source = source;
		sampled.button = button;
		sampled.state = buttonState;
	}
	state.sampledButtonCount += 1;
}

ActionState InputControllerActionTable::createSampledActionState(const PlayerSlot& state, const std::string& actionName) const {
	ActionState actionState(actionName);
	u32 sourceCount = 0u;
	sourceCount += mergeSourceActionState(actionState, state, actionName, InputSource::Keyboard);
	sourceCount += mergeSourceActionState(actionState, state, actionName, InputSource::Gamepad);
	sourceCount += mergeSourceActionState(actionState, state, actionName, InputSource::Pointer);
	if (sourceCount == 0u) {
		return actionState;
	}
	actionState.guardedjustpressed = false;
	actionState.repeatpressed = false;
	actionState.repeatcount = 0;
	return actionState;
}

u32 InputControllerActionTable::mergeSourceActionState(ActionState& result, const PlayerSlot& state, const std::string& actionName, InputSource source) const {
	SourceActionAccumulator sourceAction;
	for (const InputControllerActionBinding& binding : state.bindings) {
		if (binding.actionName != actionName || binding.source != source) {
			continue;
		}
		const InputControllerSampledButtonState* const sampled = findSampledButton(state, source, binding.button);
		if (!sampled) {
			return 0u;
		}
		addButtonToAccumulator(sourceAction, sampled->state);
	}
	if (sourceAction.count == 0u) {
		return 0u;
	}
	mergeSourceAccumulator(result, sourceAction);
	return 1u;
}

const InputControllerSampledButtonState* InputControllerActionTable::findSampledButton(const PlayerSlot& state, InputSource source, const std::string& button) const {
	for (size_t index = 0; index < state.sampledButtonCount; index += 1) {
		const InputControllerSampledButtonState& sampled = state.sampledButtons[index];
		if (sampled.source == source && sampled.button == button) {
			return &sampled;
		}
	}
	return nullptr;
}

InputControllerSampledButtonState* InputControllerActionTable::findSampledButton(PlayerSlot& state, InputSource source, const std::string& button) {
	for (size_t index = 0; index < state.sampledButtonCount; index += 1) {
		InputControllerSampledButtonState& sampled = state.sampledButtons[index];
		if (sampled.source == source && sampled.button == button) {
			return &sampled;
		}
	}
	return nullptr;
}

void InputControllerActionTable::consumeActionButtons(PlayerInput& playerInput, PlayerSlot& state, const std::string& actionName) {
	for (const InputControllerActionBinding& binding : state.bindings) {
		if (binding.actionName != actionName) {
			continue;
		}
		InputControllerSampledButtonState* const sampled = findSampledButton(state, binding.source, binding.button);
		if (sampled && sampled->state.pressed && !sampled->state.consumed) {
			playerInput.consumeRawButton(binding.button, binding.source);
			sampled->state.consumed = true;
		}
	}
}

void InputControllerActionTable::markSnapshotActionConsumed(PlayerSlot& state, const std::string& actionName) {
	for (InputControllerActionState& action : state.actions) {
		if (m_strings.toString(action.actionStringId) == actionName) {
			action.statusWord |= INP_STATUS_CONSUMED;
			return;
		}
	}
}

void InputControllerActionTable::appendBindings(PlayerSlot& state, const std::string& actionName, const std::string& bindingsText) const {
	size_t start = 0;
	for (size_t index = 0; index <= bindingsText.size(); index += 1) {
		if (index != bindingsText.size() && bindingsText[index] != ',') {
			continue;
		}
		appendTokenBindings(state, actionName, bindingsText.substr(start, index - start));
		start = index + 1;
	}
}

void InputControllerActionTable::appendTokenBindings(PlayerSlot& state, const std::string& actionName, const std::string& binding) const {
	if (binding.size() > 2u && binding[1] == ':') {
		const std::string button = binding.substr(2);
		switch (binding[0]) {
			case 'k':
				addBinding(state, actionName, InputSource::Keyboard, button);
				return;
			case 'g':
				addBinding(state, actionName, InputSource::Gamepad, button);
				return;
			case 'p':
				addBinding(state, actionName, InputSource::Pointer, button);
				return;
		}
	}
	if (isKeyboardButtonToken(binding)) {
		addBinding(state, actionName, InputSource::Keyboard, binding);
		return;
	}
	const auto& defaultPointer = Input::DEFAULT_INPUT_MAPPING.pointer;
	const auto pointerIt = defaultPointer.find(binding);
	if (pointerIt != defaultPointer.end()) {
		for (const PointerBinding& defaultBinding : pointerIt->second) {
			addBinding(state, actionName, InputSource::Pointer, defaultBinding.id);
		}
		return;
	}
	const auto& defaultKeyboard = Input::DEFAULT_INPUT_MAPPING.keyboard;
	const auto keyboardIt = defaultKeyboard.find(binding);
	const auto& defaultGamepad = Input::DEFAULT_INPUT_MAPPING.gamepad;
	const auto gamepadIt = defaultGamepad.find(binding);
	if (keyboardIt != defaultKeyboard.end() || gamepadIt != defaultGamepad.end()) {
		if (keyboardIt != defaultKeyboard.end()) {
			for (const KeyboardBinding& defaultBinding : keyboardIt->second) {
				addBinding(state, actionName, InputSource::Keyboard, defaultBinding.id);
			}
		}
		if (gamepadIt != defaultGamepad.end()) {
			for (const GamepadBinding& defaultBinding : gamepadIt->second) {
				addBinding(state, actionName, InputSource::Gamepad, defaultBinding.id);
			}
		}
		return;
	}
	addBinding(state, actionName, InputSource::Keyboard, binding);
}

bool InputControllerActionTable::isKeyboardButtonToken(const std::string& binding) const {
	return binding.rfind("Key", 0) == 0
		|| binding.rfind("Digit", 0) == 0
		|| binding.rfind("Arrow", 0) == 0
		|| binding.rfind("Shift", 0) == 0
		|| binding.rfind("Ctrl", 0) == 0
		|| binding.rfind("Control", 0) == 0
		|| binding.rfind("Alt", 0) == 0
		|| binding.rfind("Meta", 0) == 0
		|| binding == "Enter"
		|| binding == "Backspace"
		|| binding == "Escape"
		|| binding == "Space";
}

void InputControllerActionTable::loadDefaultBindings(PlayerSlot& state) const {
	for (const auto& [actionName, bindings] : Input::DEFAULT_INPUT_MAPPING.keyboard) {
		for (const KeyboardBinding& binding : bindings) {
			addBinding(state, actionName, InputSource::Keyboard, binding.id);
		}
	}
	for (const auto& [actionName, bindings] : Input::DEFAULT_INPUT_MAPPING.gamepad) {
		for (const GamepadBinding& binding : bindings) {
			addBinding(state, actionName, InputSource::Gamepad, binding.id);
		}
	}
	for (const auto& [actionName, bindings] : Input::DEFAULT_INPUT_MAPPING.pointer) {
		for (const PointerBinding& binding : bindings) {
			addBinding(state, actionName, InputSource::Pointer, binding.id);
		}
	}
}

void InputControllerActionTable::removeActionBindings(PlayerSlot& state, const std::string& actionName) {
	size_t write = 0;
	for (size_t read = 0; read < state.bindings.size(); read += 1) {
		InputControllerActionBinding& binding = state.bindings[read];
		if (binding.actionName != actionName) {
			state.bindings[write] = binding;
			write += 1;
		}
	}
	state.bindings.resize(write);
}

void InputControllerActionTable::addBinding(PlayerSlot& state, const std::string& actionName, InputSource source, const std::string& button) const {
	state.bindings.push_back(InputControllerActionBinding{ actionName, source, button });
}

} // namespace bmsx
