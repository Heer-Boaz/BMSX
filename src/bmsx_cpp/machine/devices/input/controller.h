#pragma once

#include "machine/memory/memory.h"
#include "input/manager.h"
#include <array>
#include <string>
#include <vector>

namespace bmsx {

struct InputControllerActionState {
	StringId actionStringId = 0;
	StringId bindStringId = 0;
};

struct InputControllerPlayerState {
	std::vector<InputControllerActionState> actions;
};

struct InputControllerRegisterState {
	u32 player = 1;
	StringId actionStringId = 0;
	StringId bindStringId = 0;
	u32 ctrl = 0;
	StringId queryStringId = 0;
	u32 status = 0;
	u32 value = 0;
	StringId consumeStringId = 0;
};

struct InputControllerState {
	bool sampleArmed = false;
	u32 sampleSequence = 0;
	u32 lastSampleCycle = 0;
	InputControllerRegisterState registers;
	std::array<InputControllerPlayerState, PLAYERS_MAX> players;
};

class InputController {
public:
	InputController(Memory& memory, Input& input, const StringPool& strings);

	void reset();
	void cancelArmedSample();
	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

private:
	static void onRegisterWriteThunk(void* context, uint32_t addr, Value value);

	struct PlayerChipState {
		KeyboardInputMapping keyboard;
		GamepadInputMapping gamepad;
		std::vector<InputControllerActionState> actions;
		bool contextPushed = false;
	};

	Memory& m_memory;
	Input& m_input;
	const StringPool& m_strings;
	std::array<PlayerChipState, PLAYERS_MAX> m_playerStates;
	InputControllerRegisterState m_registers;
	bool m_sampleArmed = false;
	u32 m_sampleSequence = 0;
	u32 m_lastSampleCycle = 0;

	void onRegisterWrite(uint32_t addr, Value value);
	void onCtrlWrite(u32 command);
	void queryAction();
	void consumeActions();
	void commitAction();
	void resetActions();
	void clearPlayerActions(i32 playerIndex, PlayerChipState& state);
	void restorePlayerActions(i32 playerIndex, PlayerChipState& state, const std::vector<InputControllerActionState>& actions);
	void installActionMapping(PlayerChipState& state, StringId actionStringId, StringId bindStringId);
	void upsertAction(PlayerChipState& state, StringId actionStringId, StringId bindStringId);
	void writeResult(u32 status, u32 value);
	void mirrorRegisters();
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
