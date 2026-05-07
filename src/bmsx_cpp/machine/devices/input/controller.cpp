#include "machine/devices/input/controller.h"
#include "input/player.h"

namespace bmsx {
namespace {

constexpr const char* INP_CONTEXT_ID = "inp_chip";

} // namespace

InputController::InputController(Memory& memory, Input& input, const StringPool& strings)
	: m_memory(memory)
	, m_input(input)
	, m_strings(strings) {
	m_memory.mapIoWrite(IO_INP_CTRL, this, &InputController::onCtrlWriteThunk);
	m_memory.mapIoWrite(IO_INP_QUERY, this, &InputController::onQueryWriteThunk);
	m_memory.mapIoWrite(IO_INP_CONSUME, this, &InputController::onConsumeWriteThunk);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	static_cast<InputController*>(context)->onCtrlWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onQueryWriteThunk(void* context, uint32_t, Value) {
	static_cast<InputController*>(context)->onQueryWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onConsumeWriteThunk(void* context, uint32_t, Value) {
	static_cast<InputController*>(context)->onConsumeWrite();
}

void InputController::reset() {
	sampleArmed = false;
	for (i32 playerIndex = 1; playerIndex <= PLAYERS_MAX; playerIndex += 1) {
		PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
		clearPlayerActions(playerIndex, state);
	}
	m_memory.writeValue(IO_INP_PLAYER, valueNumber(1.0));
	m_memory.writeIoValue(IO_INP_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_INP_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::onCtrlWrite() {
	switch (m_memory.readIoU32(IO_INP_CTRL)) {
		case INP_CTRL_COMMIT:
			commitAction();
			return;
		case INP_CTRL_ARM:
			sampleArmed = true;
			return;
		case INP_CTRL_RESET:
			resetActions();
			return;
	}
}

void InputController::onVblankEdge() {
	if (!sampleArmed) {
		return;
	}
	m_input.beginFrame();
	sampleArmed = false;
}

InputControllerState InputController::captureState() const {
	InputControllerState state;
	state.sampleArmed = sampleArmed;
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	sampleArmed = state.sampleArmed;
}

void InputController::onQueryWrite() {
	const Value queryValue = m_memory.readValue(IO_INP_QUERY);
	const std::string& queryText = m_strings.toString(asStringId(queryValue));
	PlayerInput* const playerInput = m_input.getPlayerInput(static_cast<i32>(m_memory.readIoU32(IO_INP_PLAYER)));
	const bool triggered = playerInput->checkActionTriggered(queryText);
	m_memory.writeValue(IO_INP_STATUS, valueNumber(triggered ? 1.0 : 0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::onConsumeWrite() {
	const std::string& actionNames = m_strings.toString(asStringId(m_memory.readValue(IO_INP_CONSUME)));
	PlayerInput* const playerInput = m_input.getPlayerInput(static_cast<i32>(m_memory.readIoU32(IO_INP_PLAYER)));
	size_t start = 0;
	for (size_t index = 0; index <= actionNames.size(); index += 1) {
		if (index != actionNames.size() && actionNames[index] != ',') {
			continue;
		}
		playerInput->consumeAction(actionNames.substr(start, index - start));
		start = index + 1;
	}
}

void InputController::commitAction() {
	const i32 playerIndex = static_cast<i32>(m_memory.readIoU32(IO_INP_PLAYER));
	PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	const std::string& actionName = m_strings.toString(asStringId(m_memory.readValue(IO_INP_ACTION)));
	const std::string& bindingsText = m_strings.toString(asStringId(m_memory.readValue(IO_INP_BIND)));
	std::vector<KeyboardBinding> keyboardBindings;
	std::vector<GamepadBinding> gamepadBindings;
	appendBindings(bindingsText, keyboardBindings, gamepadBindings);
	state.keyboard[actionName] = std::move(keyboardBindings);
	state.gamepad[actionName] = std::move(gamepadBindings);
	PlayerInput* const playerInput = m_input.getPlayerInput(playerIndex);
	if (state.contextPushed) {
		playerInput->popContext(INP_CONTEXT_ID);
	}
	playerInput->pushContext(INP_CONTEXT_ID, state.keyboard, state.gamepad, {});
	state.contextPushed = true;
}

void InputController::resetActions() {
	const i32 playerIndex = static_cast<i32>(m_memory.readIoU32(IO_INP_PLAYER));
	PlayerChipState& state = m_playerStates[static_cast<size_t>(playerIndex - 1)];
	clearPlayerActions(playerIndex, state);
	m_memory.writeValue(IO_INP_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_INP_VALUE, valueNumber(0.0));
}

void InputController::clearPlayerActions(i32 playerIndex, PlayerChipState& state) {
	if (state.contextPushed) {
		m_input.getPlayerInput(playerIndex)->popContext(INP_CONTEXT_ID);
	}
	state.keyboard.clear();
	state.gamepad.clear();
	state.contextPushed = false;
}

void InputController::appendBindings(
	const std::string& bindingsText,
	std::vector<KeyboardBinding>& keyboardBindings,
	std::vector<GamepadBinding>& gamepadBindings
) const {
	const auto& defaultKeyboard = *Input::DEFAULT_INPUT_MAPPING.keyboard;
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
		}
		gamepadBindings.push_back(GamepadBinding{ binding, std::nullopt });
		start = index + 1;
	}
}

} // namespace bmsx
