#pragma once

#include "input/models.h"
#include "machine/cpu/string_pool.h"
#include "machine/devices/input/contracts.h"

#include <array>
#include <string>
#include <vector>

namespace bmsx {

class Input;
class InputControllerEventFifo;
class PlayerInput;

struct InputControllerActionState {
	StringId actionStringId = 0;
	StringId bindStringId = 0;
	u32 statusWord = 0;
	u32 valueQ16 = 0;
	f64 pressTime = 0.0;
	u32 repeatCount = 0;
};

struct InputControllerPlayerState {
	std::vector<InputControllerActionState> actions;
};

struct InputControllerSampledButtonState {
	InputSource source = InputSource::Keyboard;
	std::string button;
	ButtonState state;
};

struct InputControllerQueryResult {
	u32 statusWord = 0;
	u32 valueQ16 = 0;
	u32 valueXQ16 = 0;
	u32 valueYQ16 = 0;
};

class InputControllerActionTable {
public:
	InputControllerActionTable(Input& input, const StringPool& strings);

	void reset();
	std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> capturePlayers() const;
	void restorePlayers(const std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT>& players);
	void commitAction(i32 playerIndex, StringId actionStringId, StringId bindStringId);
	void resetActions(i32 playerIndex);
	void sampleButtons(InputControllerEventFifo& eventFifo);
	void queryAction(i32 playerIndex, const std::string& queryText, InputControllerQueryResult& out) const;
	void consumeActions(i32 playerIndex, const std::string& actionNames);

private:
	struct InputControllerActionBinding {
		std::string actionName;
		InputSource source = InputSource::Keyboard;
		std::string button;
	};

	struct PlayerSlot {
		std::vector<InputControllerActionBinding> bindings;
		std::vector<InputControllerActionState> actions;
		std::vector<InputControllerSampledButtonState> sampledButtons;
		size_t sampledButtonCount = 0;
	};

	Input& m_input;
	const StringPool& m_strings;
	std::array<PlayerSlot, INPUT_CONTROLLER_PLAYER_COUNT> m_playerStates;

	void resetPlayerActions(PlayerSlot& state);
	void restorePlayerActions(PlayerSlot& state, const std::vector<InputControllerActionState>& actions);
	void installActionMapping(PlayerSlot& state, StringId actionStringId, StringId bindStringId);
	void upsertAction(PlayerSlot& state, StringId actionStringId, StringId bindStringId);
	void sampleLoadedBindings(PlayerInput& playerInput, PlayerSlot& state);
	void writeSampledButton(PlayerSlot& state, InputSource source, const std::string& button, const ButtonState& buttonState);
	ActionState createSampledActionState(const PlayerSlot& state, const std::string& actionName) const;
	u32 mergeSourceActionState(ActionState& result, const PlayerSlot& state, const std::string& actionName, InputSource source) const;
	const InputControllerSampledButtonState* findSampledButton(const PlayerSlot& state, InputSource source, const std::string& button) const;
	InputControllerSampledButtonState* findSampledButton(PlayerSlot& state, InputSource source, const std::string& button);
	void consumeActionButtons(PlayerInput& playerInput, PlayerSlot& state, const std::string& actionName);
	void markSnapshotActionConsumed(PlayerSlot& state, const std::string& actionName);
	void appendBindings(PlayerSlot& state, const std::string& actionName, const std::string& bindingsText) const;
	void appendTokenBindings(PlayerSlot& state, const std::string& actionName, const std::string& binding) const;
	bool isKeyboardButtonToken(const std::string& binding) const;
	void loadDefaultBindings(PlayerSlot& state) const;
	void removeActionBindings(PlayerSlot& state, const std::string& actionName);
	void addBinding(PlayerSlot& state, const std::string& actionName, InputSource source, const std::string& button) const;
};

} // namespace bmsx
