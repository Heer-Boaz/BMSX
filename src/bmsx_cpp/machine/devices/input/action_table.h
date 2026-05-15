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

struct InputControllerQueryResult {
	u32 statusWord = 0;
	u32 valueQ16 = 0;
};

class InputControllerActionTable {
public:
	InputControllerActionTable(Input& input, const StringPool& strings);

	void reset();
	std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT> capturePlayers() const;
	void restorePlayers(const std::array<InputControllerPlayerState, INPUT_CONTROLLER_PLAYER_COUNT>& players);
	void commitAction(i32 playerIndex, StringId actionStringId, StringId bindStringId);
	void resetActions(i32 playerIndex);
	void sampleCommittedActions(InputControllerEventFifo& eventFifo);
	void queryAction(i32 playerIndex, const std::string& queryText, InputControllerQueryResult& out) const;
	void consumeActions(i32 playerIndex, const std::string& actionNames);

private:
	struct PlayerSlot {
		KeyboardInputMapping keyboard;
		GamepadInputMapping gamepad;
		std::vector<InputControllerActionState> actions;
		bool contextPushed = false;
	};

	Input& m_input;
	const StringPool& m_strings;
	std::array<PlayerSlot, INPUT_CONTROLLER_PLAYER_COUNT> m_playerStates;

	void clearPlayerActions(i32 playerIndex, PlayerSlot& state);
	void restorePlayerActions(i32 playerIndex, PlayerSlot& state, const std::vector<InputControllerActionState>& actions);
	void installActionMapping(PlayerSlot& state, StringId actionStringId, StringId bindStringId);
	void upsertAction(PlayerSlot& state, StringId actionStringId, StringId bindStringId);
	ActionState createSnapshotActionState(const PlayerSlot& state, const std::string& actionName) const;
	const InputControllerActionState& selectQuerySnapshotAction(const PlayerSlot& state, const std::string& queryText) const;
	const InputControllerActionState& findSnapshotAction(const PlayerSlot& state, const std::string& actionName) const;
	void markSnapshotActionConsumed(PlayerSlot& state, const std::string& actionName);
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
