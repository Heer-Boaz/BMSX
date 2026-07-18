#pragma once
#include "machine/memory/memory.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/output_port.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/save_state.h"

namespace bmsx {
class SystemController;

class InputController {
public:
	InputController(Memory& memory, InputControllerInputSource& input, SystemController& system);
	void reset();
	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);
	void cancelSampleArm();
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

private:
	void writeControl(u32 addr, Value value);

	Memory& m_memory;
	InputControllerInputSource& m_input;
	SystemController& m_system;
	InputControllerRegisterFile m_registers;
	bool m_sampleArmed = false;
	u32 m_sampleSequence = 0;
	u32 m_lastSampleCycle = 0;
	bool m_supervisorRequestLineWasHigh = false;
	InputControllerSnapshot m_snapshot;
	InputControllerOutputPort m_outputPort;
};
} // namespace bmsx
