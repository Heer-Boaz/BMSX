#pragma once

#include "machine/memory/memory.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/save_state.h"
#include "input/manager.h"
#include "input/models.h"
#include <array>
#include <string>
#include <vector>

namespace bmsx {

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
	static Value onEventRegisterReadThunk(void* context, uint32_t addr);
	static void onEventCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static Value onOutputRegisterReadThunk(void* context, uint32_t addr);
	static void onOutputCtrlWriteThunk(void* context, uint32_t addr, Value value);

	struct PlayerChipState {
		KeyboardInputMapping keyboard;
		GamepadInputMapping gamepad;
		std::vector<InputControllerActionState> actions;
		bool contextPushed = false;
	};

	Memory& m_memory;
	Input& m_input;
	const StringPool& m_strings;
	std::array<PlayerChipState, INPUT_CONTROLLER_PLAYER_COUNT> m_playerStates;
	InputControllerRegisterState m_registers;
	bool m_sampleArmed = false;
	u32 m_sampleSequence = 0;
	u32 m_lastSampleCycle = 0;
	InputControllerEventFifo m_eventFifo;

	void onRegisterWrite(uint32_t addr, Value value);
	void onCtrlWrite(u32 command);
	Value onEventRegisterRead(uint32_t addr) const;
	void onEventCtrlWrite(u32 command);
	Value onOutputRegisterRead(uint32_t addr) const;
	void onOutputCtrlWrite(u32 command);
	void queryAction();
	void consumeActions();
	void commitAction();
	void resetActions();
	void clearPlayerActions(i32 playerIndex, PlayerChipState& state);
	void restorePlayerActions(i32 playerIndex, PlayerChipState& state, const std::vector<InputControllerActionState>& actions);
	void installActionMapping(PlayerChipState& state, StringId actionStringId, StringId bindStringId);
	void upsertAction(PlayerChipState& state, StringId actionStringId, StringId bindStringId);
	void sampleCommittedActions();
	u32 readOutputStatus() const;
	void applyOutputEffect();
	ActionState createSnapshotActionState(const PlayerChipState& state, const std::string& actionName) const;
	const InputControllerActionState& selectQuerySnapshotAction(const PlayerChipState& state, const std::string& queryText) const;
	const InputControllerActionState& findSnapshotAction(const PlayerChipState& state, const std::string& actionName) const;
	void markSnapshotActionConsumed(PlayerChipState& state, const std::string& actionName);
	void writeResult(u32 status, u32 value);
	void mirrorRegisters();
	void appendBindings(const std::string& bindingsText, std::vector<KeyboardBinding>& keyboardBindings, std::vector<GamepadBinding>& gamepadBindings) const;
};

} // namespace bmsx
