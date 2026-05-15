#include "machine/devices/input/action_table.h"

#include "input/action_parser.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/devices/input/event_fifo.h"

#include <optional>

namespace bmsx {
namespace {

constexpr const char* INP_CONTEXT_ID = "inp_chip";
const InputControllerActionState EMPTY_ACTION_SNAPSHOT{};
const InputControllerActionState COMPLEX_QUERY_ACTION_SNAPSHOT{0u, 0u, 1u, 0u, 0.0, 0u};

} // namespace

InputControllerActionTable::InputControllerActionTable(Input& input, const StringPool& strings)
	: m_input(input)
	, m_strings(strings) {
}

void InputControllerActionTable::reset() {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		clearPlayerActions(playerIndex, m_playerStates[static_cast<size_t>(playerIndex - 1)]);
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
		clearPlayerActions(playerIndex, m_playerStates[static_cast<size_t>(playerIndex - 1)]);
	}
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		restorePlayerActions(
			playerIndex,
			m_playerStates[static_cast<size_t>(playerIndex - 1)],
			players[static_cast<size_t>(playerIndex - 1)].actions
		);
	}
}

void InputControllerActionTable::commitAction(i32 playerIndex, StringId actionStringId, StringId bindStringId) {
	PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	installActionMapping(state, actionStringId, bindStringId);
	upsertAction(state, actionStringId, bindStringId);
	PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
	playerInput->pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
	state.contextPushed = true;
}

void InputControllerActionTable::resetActions(i32 playerIndex) {
	PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	clearPlayerActions(playerIndex, state);
}

void InputControllerActionTable::sampleCommittedActions(InputControllerEventFifo& eventFifo) {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		PlayerSlot& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
		for (InputControllerActionState& action : state.actions) {
			const ActionState actionState = playerInput->getActionState(m_strings.toString(action.actionStringId));
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
	const bool triggered = ActionDefinitionEvaluator::checkActionTriggered(queryText,
		[this, &state](const std::string& actionName, std::optional<f64>) {
			return createSnapshotActionState(state, actionName);
		});
	if (!triggered) {
		out.statusWord = 0u;
		out.valueQ16 = 0u;
		return;
	}
	const InputControllerActionState& selectedAction = selectQuerySnapshotAction(state, queryText);
	out.statusWord = selectedAction.statusWord;
	out.valueQ16 = selectedAction.valueQ16;
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
		playerInput->consumeAction(actionName);
		markSnapshotActionConsumed(state, actionName);
		start = index + 1;
	}
}

void InputControllerActionTable::clearPlayerActions(i32 playerIndex, PlayerSlot& state) {
	if (state.contextPushed) {
		m_input.getPlayerInput(playerIndex)->clearContext(INP_CONTEXT_ID);
	}
	state.keyboard.clear();
	state.gamepad.clear();
	state.actions.clear();
	state.contextPushed = false;
}

void InputControllerActionTable::restorePlayerActions(i32 playerIndex, PlayerSlot& state, const std::vector<InputControllerActionState>& actions) {
	for (const InputControllerActionState& action : actions) {
		installActionMapping(state, action.actionStringId, action.bindStringId);
		state.actions.push_back(action);
	}
	if (!state.actions.empty()) {
		m_input.getPlayerInput(playerIndex)->pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
		state.contextPushed = true;
	}
}

void InputControllerActionTable::installActionMapping(PlayerSlot& state, StringId actionStringId, StringId bindStringId) {
	const std::string& actionName = m_strings.toString(actionStringId);
	const std::string& bindingsText = m_strings.toString(bindStringId);
	std::vector<KeyboardBinding> keyboardBindings;
	std::vector<GamepadBinding> gamepadBindings;
	appendBindings(bindingsText, keyboardBindings, gamepadBindings);
	state.keyboard[actionName] = std::move(keyboardBindings);
	state.gamepad[actionName] = std::move(gamepadBindings);
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

ActionState InputControllerActionTable::createSnapshotActionState(const PlayerSlot& state, const std::string& actionName) const {
	const InputControllerActionState& action = findSnapshotAction(state, actionName);
	return createInputActionSnapshot(actionName, action.statusWord, action.valueQ16, action.pressTime, action.repeatCount);
}

const InputControllerActionState& InputControllerActionTable::selectQuerySnapshotAction(const PlayerSlot& state, const std::string& queryText) const {
	const std::string* const actionName = ActionDefinitionEvaluator::getSimpleActionName(queryText);
	if (!actionName) {
		return COMPLEX_QUERY_ACTION_SNAPSHOT;
	}
	return findSnapshotAction(state, *actionName);
}

const InputControllerActionState& InputControllerActionTable::findSnapshotAction(const PlayerSlot& state, const std::string& actionName) const {
	for (const InputControllerActionState& action : state.actions) {
		if (m_strings.toString(action.actionStringId) == actionName) {
			return action;
		}
	}
	return EMPTY_ACTION_SNAPSHOT;
}

void InputControllerActionTable::markSnapshotActionConsumed(PlayerSlot& state, const std::string& actionName) {
	for (InputControllerActionState& action : state.actions) {
		if (m_strings.toString(action.actionStringId) == actionName) {
			action.statusWord |= INP_STATUS_CONSUMED;
			return;
		}
	}
}

void InputControllerActionTable::appendBindings(
	const std::string& bindingsText,
	std::vector<KeyboardBinding>& keyboardBindings,
	std::vector<GamepadBinding>& gamepadBindings
) const {
	const auto& defaultKeyboard = Input::DEFAULT_INPUT_MAPPING.keyboard;
	size_t start = 0;
	for (size_t index = 0; index <= bindingsText.size(); index += 1) {
		if (index != bindingsText.size() && bindingsText[index] != ',') {
			continue;
		}
		const std::string binding = bindingsText.substr(start, index - start);
		const auto keyboardIt = defaultKeyboard.find(binding);
		if (keyboardIt != defaultKeyboard.end()) {
			const std::vector<KeyboardBinding>& defaultBindings = keyboardIt->second;
			keyboardBindings.insert(keyboardBindings.end(), defaultBindings.begin(), defaultBindings.end());
		} else {
			keyboardBindings.push_back(KeyboardBinding{ binding, std::nullopt });
		}
		gamepadBindings.push_back(GamepadBinding{ binding, std::nullopt });
		start = index + 1;
	}
}

} // namespace bmsx
